// Material schedule ("material list document") parsing + node matching.
//
// The end user supplies a document that maps parts of the model to the finishes and
// colour codes that are actually orderable for them. The configurator reads it, and
// when a node is selected it offers only the options that document says apply there.
//
// Two formats are accepted so the document can come from either a developer or a
// spreadsheet export:
//
//   JSON  - the expressive form (see public/material-libraries/*.json)
//   CSV   - one option per row, grouped by the `group` column; what you get when
//           somebody saves an Excel finish schedule as CSV
//
// Matching is deliberately forgiving about names: "Cube.003" in Blender, "Cube003"
// after the glTF loader sanitizes it, and "cube 003" typed by hand all resolve to the
// same node, because a schedule written against the .blend must not silently match
// nothing against the .glb.
import { normalizeKey } from './nodeGraph.js';
import { readWorkbook, workbookSupported } from './readWorkbook.js';

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function patternToTester(pattern) {
  const key = normalizeKey(pattern);
  if (!key) return () => false;
  if (key.includes('*')) {
    const re = new RegExp(`^${key.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return (name) => re.test(normalizeKey(name));
  }
  return (name) => normalizeKey(name) === key;
}

function compilePatterns(list) {
  return (Array.isArray(list) ? list : list ? [list] : []).map((p) => ({ raw: String(p), test: patternToTester(p) }));
}

function num(value, fallback, { min = 0, max = 1 } = {}) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeOption(raw, ctx, errors, warnings) {
  const name = String(raw.name ?? raw.option ?? raw.label ?? '').trim();
  if (!name) {
    errors.push(`${ctx}: option is missing a name.`);
    return null;
  }
  const colorRaw = raw.color ?? raw.hex ?? raw.colour ?? raw.color_code;
  let color = colorRaw == null ? null : String(colorRaw).trim();
  if (color && !color.startsWith('#')) color = `#${color}`;
  if (color && !HEX_RE.test(color)) {
    errors.push(`${ctx} / "${name}": "${colorRaw}" is not a valid hex colour (expected #RRGGBB).`);
    return null;
  }
  const texture = raw.texture ?? raw.map ?? raw.image ?? null;
  if (!color && !texture) {
    errors.push(`${ctx} / "${name}": needs at least a colour or a texture.`);
    return null;
  }

  let repeat = raw.textureRepeat ?? raw.repeat ?? null;
  if (typeof repeat === 'string') repeat = repeat.split(/[x,\s]+/).filter(Boolean).map(Number);
  if (typeof repeat === 'number') repeat = [repeat, repeat];
  if (Array.isArray(repeat)) {
    repeat = [num(repeat[0], 1, { min: 0.01, max: 512 }), num(repeat[1] ?? repeat[0], 1, { min: 0.01, max: 512 })];
  } else {
    repeat = null;
  }

  // A document with no price column is different from one quoting zero. "Included"
  // is a commercial statement, so it is only shown when the document actually said 0.
  const rawPrice = raw.price ?? raw.cost;
  const hasPrice = rawPrice != null && String(rawPrice).trim() !== '';
  const price = hasPrice ? Number.parseFloat(rawPrice) : null;
  if (hasPrice && !Number.isFinite(price)) {
    warnings.push(`${ctx} / "${name}": price "${rawPrice}" is not a number — treated as 0.`);
  }

  return {
    code: raw.code ? String(raw.code).trim() : null,
    name,
    color: color || null,
    roughness: raw.roughness == null ? null : num(raw.roughness, 0.5),
    metalness: raw.metalness == null ? null : num(raw.metalness, 0),
    opacity: raw.opacity == null ? null : num(raw.opacity, 1),
    texture: texture ? String(texture) : null,
    textureRepeat: repeat,
    // When an option specifies no texture, the finish is a solid colour and any
    // texture already on the surface is removed. `keepTexture: true` opts out — used
    // for "recolour the existing grain" style options.
    keepTexture: raw.keepTexture === true || String(raw.keepTexture ?? '').toLowerCase() === 'true',
    price: hasPrice ? (Number.isFinite(price) ? price : 0) : null,
    isDefault: raw.default === true || String(raw.default ?? '').toLowerCase() === 'true',
    notes: raw.notes ? String(raw.notes) : null,
    finish: raw.finish ? String(raw.finish) : null,
  };
}

function normalizeGroup(raw, index, errors, warnings) {
  const label = String(raw.label ?? raw.group ?? raw.name ?? '').trim();
  const ctx = label || `group #${index + 1}`;
  const match = isPlainObject(raw.match) ? raw.match : { nodes: raw.nodes, materials: raw.materials };
  const nodePatterns = compilePatterns(match.nodes ?? match.node);
  const materialPatterns = compilePatterns(match.materials ?? match.material);
  const excludePatterns = compilePatterns(match.excludeNodes ?? match.exclude);

  if (nodePatterns.length === 0 && materialPatterns.length === 0) {
    errors.push(`${ctx}: needs match.nodes and/or match.materials so the configurator knows where it applies.`);
    return null;
  }

  const options = [];
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const seenNames = new Set();
  for (const rawOpt of rawOptions) {
    const opt = normalizeOption(rawOpt, ctx, errors, warnings);
    if (!opt) continue;
    const key = opt.name.toLowerCase();
    if (seenNames.has(key)) {
      warnings.push(`${ctx}: duplicate option "${opt.name}" — only the first is kept.`);
      continue;
    }
    seenNames.add(key);
    options.push(opt);
  }
  if (options.length === 0) {
    errors.push(`${ctx}: has no usable options.`);
    return null;
  }
  if (!options.some((o) => o.isDefault)) options[0].isDefault = true;

  return {
    id: raw.id ? String(raw.id) : `group-${index}`,
    label: label || `Group ${index + 1}`,
    category: raw.category ? String(raw.category) : 'Finishes',
    description: raw.description ? String(raw.description) : null,
    nodePatterns,
    materialPatterns,
    excludePatterns,
    options,
  };
}

// --- CSV -------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const CSV_ALIASES = {
  group: 'group',
  group_name: 'group',
  area: 'group',
  category: 'category',
  nodes: 'nodes',
  node: 'nodes',
  node_name: 'nodes',
  materials: 'materials',
  material: 'materials',
  material_name: 'materials',
  code: 'code',
  material_code: 'code',
  option: 'name',
  option_name: 'name',
  name: 'name',
  finish: 'finish',
  color: 'color',
  colour: 'color',
  hex: 'color',
  color_code: 'color',
  roughness: 'roughness',
  metalness: 'metalness',
  metallic: 'metalness',
  texture: 'texture',
  texture_map: 'texture',
  repeat: 'repeat',
  tiling: 'repeat',
  price: 'price',
  cost: 'price',
  default: 'default',
  is_default: 'default',
  notes: 'notes',
  keep_texture: 'keepTexture',
  keeptexture: 'keepTexture',
};

function csvToLibraryShape(text, errors) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    errors.push('CSV has no data rows.');
    return null;
  }
  const header = rows[0].map((h) => CSV_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? null);
  if (!header.includes('group')) {
    errors.push('CSV is missing a "group" column (the area/group each option belongs to).');
    return null;
  }
  if (!header.includes('name') && !header.includes('code')) {
    errors.push('CSV is missing an "option" (or "name") column.');
    return null;
  }
  const groups = new Map();
  rows.slice(1).forEach((cells, i) => {
    const rec = {};
    header.forEach((key, ci) => {
      if (key) rec[key] = cells[ci]?.trim() ?? '';
    });
    const groupName = rec.group;
    if (!groupName) {
      errors.push(`CSV row ${i + 2}: empty "group" column.`);
      return;
    }
    if (!groups.has(groupName)) {
      groups.set(groupName, {
        label: groupName,
        category: rec.category || 'Finishes',
        match: { nodes: [], materials: [] },
        options: [],
      });
    }
    const g = groups.get(groupName);
    // Node/material targets may be repeated on every row or given once on the first —
    // both are common when a schedule is maintained in a spreadsheet.
    (rec.nodes || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean).forEach((n) => {
      if (!g.match.nodes.includes(n)) g.match.nodes.push(n);
    });
    (rec.materials || '').split(/[;|]/).map((s) => s.trim()).filter(Boolean).forEach((n) => {
      if (!g.match.materials.includes(n)) g.match.materials.push(n);
    });
    g.options.push({ ...rec, name: rec.name || rec.code });
  });
  return { name: 'Imported CSV schedule', groups: [...groups.values()] };
}

// --- Excel workbook ---------------------------------------------------------------
//
// The workbook form is one row per part, which is how a finish schedule is actually
// kept in practice:
//
//   Unique Name | Display Name              | Colours                      | Textures
//   ------------+---------------------------+------------------------------+------------------------
//   kitchen_floor | Floor                   | #F4F1EC, #BCA88F             | flooring_tile.jpg
//   island_counter| Island — Countertop     | #E8DFC8, #1B1B1E             | countertops_marble.jpg
//
// "Unique Name" is the node name in the .glb, "Display Name" becomes the part's label
// in the UI, and the two list columns become the finishes offered for that part.

const WORKBOOK_COLUMNS = {
  node: ['unique name', 'uniquename', 'unique_name', 'node', 'node name', 'nodename', 'mesh', 'mesh name', 'part', 'part id', 'object', 'object name'],
  label: ['display name', 'displayname', 'display', 'label', 'friendly name', 'name'],
  colours: ['colours', 'colors', 'colour', 'color', 'colour codes', 'color codes', 'color code', 'colour code', 'hex', 'hex codes'],
  textures: ['textures', 'texture', 'texture files', 'material', 'materials', 'maps'],
  tiling: ['tiling', 'repeat', 'texture repeat', 'scale'],
};

function matchHeader(cell) {
  const key = String(cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  // Longest alias first so "unique name" is not stolen by the "name" alias of the
  // display-name column.
  const entries = Object.entries(WORKBOOK_COLUMNS).flatMap(([field, aliases]) => aliases.map((a) => [field, a]));
  entries.sort((a, b) => b[1].length - a[1].length);
  for (const [field, alias] of entries) if (key === alias) return field;
  return null;
}

/** Locate the header row and which column holds which field. */
function findWorkbookHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const mapping = {};
    let hits = 0;
    rows[r].forEach((cell, c) => {
      const field = matchHeader(cell);
      if (field && mapping[field] === undefined) {
        mapping[field] = c;
        hits += 1;
      }
    });
    // A node column plus at least one finish column is the minimum useful header.
    if (mapping.node !== undefined && hits >= 2) return { headerRow: r, mapping };
  }
  return null;
}

/** Split a list cell: commas, semicolons and in-cell line breaks all separate. */
function splitListCell(value) {
  return String(value ?? '')
    .split(/[,;\r\n|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function prettifyTextureName(file) {
  return file
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert one worksheet into a document shape.
 *
 * Each row becomes up to two single-node groups — "Colours" and "Textures" — mirroring
 * the two list columns, so the finish panel shows them as separate sections.
 */
function sheetToLibraryShape(sheet, filename, errors, warnings) {
  const found = findWorkbookHeader(sheet.rows);
  if (!found) {
    errors.push(
      `Sheet "${sheet.name}": no header row found. Expected a row with a "Unique Name" column plus "Colours" and/or "Textures".`
    );
    return null;
  }
  const { headerRow, mapping } = found;
  if (mapping.colours === undefined && mapping.textures === undefined) {
    errors.push(`Sheet "${sheet.name}": found a "Unique Name" column but neither "Colours" nor "Textures".`);
    return null;
  }

  const nodeLabels = {};
  const groups = [];
  let rowsWithFinishes = 0;

  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const nodeName = (row[mapping.node] ?? '').trim();
    if (!nodeName) continue;
    const excelRow = r + 1; // 1-based, matching what the user sees in Excel
    const label = mapping.label !== undefined ? (row[mapping.label] ?? '').trim() : '';
    if (label) nodeLabels[nodeName] = label;
    const partName = label || nodeName;

    let tiling = null;
    if (mapping.tiling !== undefined) {
      const raw = (row[mapping.tiling] ?? '').trim();
      if (raw) tiling = raw;
    }

    // Colours
    const colourOptions = [];
    if (mapping.colours !== undefined) {
      for (const token of splitListCell(row[mapping.colours])) {
        let hex = token.startsWith('#') ? token : `#${token}`;
        if (!HEX_RE.test(hex)) {
          warnings.push(
            `Sheet "${sheet.name}" row ${excelRow} (${partName}): "${token}" in Colours is not a hex colour — skipped.`
          );
          continue;
        }
        hex = hex.toUpperCase();
        if (colourOptions.some((o) => o.color === hex)) continue;
        // The workbook carries no product names, so the hex is the name. Deliberately
        // no invented descriptor ("brass" vs "orange" is a judgement call this code
        // has no business making) — the swatch and the exact code say everything.
        colourOptions.push({ name: hex, color: hex });
      }
    }

    // Textures — bare filenames resolve against the app's texture folder, which is
    // where the client's texture library is served from.
    const textureOptions = [];
    if (mapping.textures !== undefined) {
      for (const token of splitListCell(row[mapping.textures])) {
        const isPath = /^(https?:)?\//i.test(token) || token.includes('/');
        const url = isPath ? token : `/textures/${token}`;
        if (textureOptions.some((o) => o.texture === url)) continue;
        textureOptions.push({
          name: prettifyTextureName(token.split('/').pop()),
          texture: url,
          ...(tiling ? { repeat: tiling } : {}),
        });
      }
    }

    if (colourOptions.length === 0 && textureOptions.length === 0) {
      // Only worth flagging when the row had something in a finish column that we
      // could not use; a genuinely blank row is just a part with no choices offered.
      const hadContent = (row[mapping.colours] ?? '').trim() || (row[mapping.textures] ?? '').trim();
      if (hadContent) {
        warnings.push(`Sheet "${sheet.name}" row ${excelRow} (${partName}): no usable colours or textures.`);
      }
      continue;
    }
    rowsWithFinishes += 1;

    if (textureOptions.length > 0) {
      groups.push({
        id: `xls-tex-${normalizeKey(nodeName)}`,
        label: 'Textures',
        category: 'From the uploaded workbook',
        match: { nodes: [nodeName] },
        options: textureOptions,
      });
    }
    if (colourOptions.length > 0) {
      groups.push({
        id: `xls-col-${normalizeKey(nodeName)}`,
        label: 'Colours',
        category: 'From the uploaded workbook',
        match: { nodes: [nodeName] },
        options: colourOptions,
      });
    }
  }

  if (groups.length === 0) {
    errors.push(`Sheet "${sheet.name}": no rows had a usable colour or texture.`);
    return null;
  }

  return {
    shape: {
      name: `${filename.replace(/\.[^.]+$/, '')} — ${sheet.name}`,
      description: `Read from worksheet "${sheet.name}".`,
      nodeLabels,
      groups,
    },
    rowsWithFinishes,
  };
}

/**
 * Parse an .xlsx workbook into a library.
 *
 * Every worksheet is read. The one with the most usable rows becomes the active
 * schedule, and the rest are returned so the UI can offer a sheet picker — a real
 * workbook often carries a draft sheet next to the final one (the sample file has
 * exactly that), and silently picking the wrong one would be worse than asking.
 */
export async function parseMaterialWorkbook(arrayBuffer, filename = '', preferredSheet = null) {
  const errors = [];
  const warnings = [];

  if (!workbookSupported()) {
    errors.push('This browser cannot read .xlsx files. Save the schedule as .csv and upload that instead.');
    return { library: null, errors, warnings, sheets: [], activeSheet: null };
  }

  let workbook;
  try {
    workbook = await readWorkbook(arrayBuffer);
  } catch (err) {
    errors.push(`Could not read the workbook: ${err.message}`);
    return { library: null, errors, warnings, sheets: [], activeSheet: null };
  }

  // Parse every sheet first so the picker can report what each one holds. Problems
  // in a sheet we do not end up using must not be shown as errors for the one we do.
  const candidates = workbook.sheets.map((sheet) => {
    const sheetErrors = [];
    const sheetWarnings = [];
    const result = sheetToLibraryShape(sheet, filename, sheetErrors, sheetWarnings);
    return {
      name: sheet.name,
      shape: result?.shape ?? null,
      rowsWithFinishes: result?.rowsWithFinishes ?? 0,
      errors: sheetErrors,
      warnings: sheetWarnings,
    };
  });

  const usable = candidates.filter((c) => c.shape);
  if (usable.length === 0) {
    errors.push(...candidates.flatMap((c) => c.errors));
    if (errors.length === 0) errors.push('No worksheet in this workbook contained a readable finish schedule.');
    return {
      library: null,
      errors,
      warnings,
      sheets: candidates.map((c) => ({ name: c.name, usable: false, rowsWithFinishes: 0 })),
      activeSheet: null,
    };
  }

  const chosen =
    (preferredSheet && usable.find((c) => c.name === preferredSheet)) ||
    usable.reduce((best, c) => (c.rowsWithFinishes > best.rowsWithFinishes ? c : best), usable[0]);

  warnings.push(...chosen.warnings);
  const skipped = usable.filter((c) => c.name !== chosen.name);
  if (skipped.length > 0) {
    warnings.push(
      `Workbook has ${usable.length} sheets with finishes; using "${chosen.name}" (${chosen.rowsWithFinishes} parts). Not used: ${skipped
        .map((s) => `"${s.name}" (${s.rowsWithFinishes})`)
        .join(', ')}.`
    );
  }

  const result = finalizeShape(chosen.shape, filename, errors, warnings);
  return {
    ...result,
    sheets: candidates.map((c) => ({ name: c.name, usable: !!c.shape, rowsWithFinishes: c.rowsWithFinishes })),
    activeSheet: chosen.name,
  };
}

// --- Public API ------------------------------------------------------------------

/**
 * Parse a schedule document. Never throws: a malformed file comes back with
 * `library: null` and a list of human-readable errors for the UI to display.
 */
export function parseMaterialLibrary(text, filename = '') {
  const errors = [];
  const warnings = [];
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    errors.push('The file is empty.');
    return { library: null, errors, warnings };
  }

  // Trust the extension when there is one, and only sniff the content otherwise —
  // guessing "CSV" for an empty or malformed .json produces a baffling error about
  // missing CSV columns.
  const looksCsv = /\.csv$/i.test(filename)
    ? true
    : /\.json$/i.test(filename)
    ? false
    : !trimmed.startsWith('{') && !trimmed.startsWith('[');

  let shape = null;
  if (looksCsv) {
    shape = csvToLibraryShape(text, errors);
  } else {
    try {
      const parsed = JSON.parse(text);
      shape = Array.isArray(parsed) ? { name: filename || 'Imported schedule', groups: parsed } : parsed;
    } catch (err) {
      errors.push(`Not valid JSON: ${err.message}`);
    }
  }
  if (!shape) return { library: null, errors, warnings };
  return finalizeShape(shape, filename, errors, warnings);
}

/**
 * Turn a raw document shape into a validated library. Shared by every input format,
 * so a schedule behaves identically whether it arrived as JSON, CSV or a workbook.
 */
function finalizeShape(shape, filename, errors, warnings) {
  const rawGroups = Array.isArray(shape.groups) ? shape.groups : Array.isArray(shape.zones) ? shape.zones : null;
  if (!rawGroups) {
    errors.push('Document has no "groups" array.');
    return { library: null, errors, warnings };
  }

  const groups = rawGroups.map((g, i) => normalizeGroup(g, i, errors, warnings)).filter(Boolean);
  if (groups.length === 0) {
    errors.push('No usable groups found — nothing could be loaded from this document.');
    return { library: null, errors, warnings };
  }

  const nodeLabels = new Map();
  if (isPlainObject(shape.nodeLabels)) {
    for (const [key, value] of Object.entries(shape.nodeLabels)) {
      nodeLabels.set(normalizeKey(key), String(value));
    }
  }

  return {
    library: {
      name: String(shape.name ?? filename ?? 'Material schedule'),
      version: shape.version ? String(shape.version) : null,
      model: shape.model ? String(shape.model) : null,
      source: filename || 'inline',
      description: shape.description ? String(shape.description) : null,
      nodeLabels,
      groups,
      optionCount: groups.reduce((s, g) => s + g.options.length, 0),
    },
    errors,
    warnings,
  };
}

/**
 * Which option groups apply to a node, best match first.
 *
 * A direct hit on the node's own name wins; an ancestor's name is next (so selecting
 * a sub-part of "main_counter" still offers the counter finishes); a match on the
 * material the node actually uses is the last resort, and is what makes a schedule
 * work at all against a file whose nodes are named "Cube.003".
 */
export function groupsForNode(library, graph, nodeRecord) {
  if (!library || !nodeRecord) return [];
  const chain = [];
  let cur = nodeRecord;
  while (cur) {
    chain.push(cur);
    cur = cur.parentId ? graph.byId.get(cur.parentId) : null;
  }

  const results = [];
  for (const group of library.groups) {
    if (chain.some((n) => group.excludePatterns.some((p) => p.test(n.name)))) continue;

    let best = null;
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];
      const hit = group.nodePatterns.find((p) => p.test(node.name));
      if (hit) {
        best = {
          score: i === 0 ? 100 : 70 - i,
          reason: i === 0 ? `matches this part's name` : `inherited from "${node.name}"`,
          via: node.name,
        };
        break;
      }
    }
    if (!best && group.materialPatterns.length > 0) {
      const hit = group.materialPatterns.find((p) => nodeRecord.materialNames.some((m) => p.test(m)));
      if (hit) {
        const matName = nodeRecord.materialNames.find((m) => hit.test(m));
        best = { score: 40, reason: `applies to material "${matName}"`, via: matName };
      }
    }
    if (best) results.push({ group, ...best });
  }
  if (results.length === 0) return results;

  // Only the nearest source wins. Every group at the same level scores the same, so
  // keeping just the best score keeps that whole level and discards the ones further
  // up the tree.
  //
  // Without this, a part inherits from every matching ancestor at once. In the sample
  // kitchen the cabinets are nested inside the countertop node, so a cabinet door
  // ended up offering the countertop's stone colours alongside its own timber ones —
  // two "Colours" headings, one of them meaningless for that surface. The badge on
  // each group still says where the surviving options came from.
  const bestScore = Math.max(...results.map((r) => r.score));
  return results.filter((r) => r.score === bestScore);
}

/**
 * How well a schedule fits the loaded model. Surfaced in the UI because a schedule
 * silently matching nothing is the single most likely real-world failure — and the
 * one that looks like "the app is broken" rather than "the document is wrong".
 */
export function analyzeCoverage(library, graph) {
  if (!library || !graph) return null;
  const groupHits = new Map(library.groups.map((g) => [g.id, 0]));
  const coveredNodeIds = new Set();

  for (const node of graph.nodes) {
    if (node.meshCount === 0) continue;
    const matches = groupsForNode(library, graph, node);
    if (matches.length > 0) coveredNodeIds.add(node.id);
    for (const m of matches) groupHits.set(m.group.id, (groupHits.get(m.group.id) ?? 0) + 1);
  }

  const geometryNodes = graph.nodes.filter((n) => n.meshCount > 0);
  return {
    unmatchedGroups: library.groups.filter((g) => (groupHits.get(g.id) ?? 0) === 0),
    matchedGroupCount: library.groups.filter((g) => (groupHits.get(g.id) ?? 0) > 0).length,
    coveredNodeCount: coveredNodeIds.size,
    geometryNodeCount: geometryNodes.length,
    uncoveredNodes: geometryNodes.filter((n) => !coveredNodeIds.has(n.id)),
    coveredNodeIds,
  };
}

