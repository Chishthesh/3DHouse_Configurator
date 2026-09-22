// Minimal .xlsx reader.
//
// An .xlsx file is a ZIP of XML parts, and the browser can already inflate raw
// DEFLATE streams natively, so reading one needs no third-party library: unzip the
// archive, pull the shared string table, and walk each worksheet's cells into rows.
// That keeps a ~400 KB spreadsheet dependency out of the bundle for what is, in the
// end, a table of text.
//
// Scope is deliberately narrow — text, numbers, shared strings and inline strings,
// which is all a finish schedule contains. Anything it cannot read fails loudly with
// an explanation rather than silently returning empty rows.

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read the ZIP central directory and inflate every entry we are asked for. */
async function unzip(arrayBuffer, wanted) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  let eocd = -1;
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('this file is not a valid .xlsx archive');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) throw new Error('ZIP64 workbooks are not supported — re-save the file in Excel');

  const decoder = new TextDecoder();
  const out = new Map();

  for (let n = 0; n < entryCount; n++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (wanted(name)) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) out.set(name, raw);
      else if (method === 8) out.set(name, await inflateRaw(raw));
      else throw new Error(`unsupported compression in "${name}" — re-save the file in Excel`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

const XML_ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
function unescapeXml(text) {
  return text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g, (whole, code) => {
    if (code[0] === '#') {
      const point = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return XML_ENTITIES[code] ?? whole;
  });
}

/** "A" -> 0, "B" -> 1, "AA" -> 26 */
function columnIndex(ref) {
  let index = 0;
  for (let i = 0; i < ref.length; i++) index = index * 26 + (ref.charCodeAt(i) - 64);
  return index - 1;
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    // A single cell value can be split across several runs (<r><t>..</t></r>) when
    // parts of it are formatted differently; they concatenate into one string.
    const runs = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1]));
    strings.push(runs.join(''));
  }
  return strings;
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];

      let value = '';
      if (type === 's') {
        const index = Number(/<v>(\d+)<\/v>/.exec(body)?.[1]);
        value = sharedStrings[index] ?? '';
      } else if (type === 'inlineStr' || type === 'str') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join('');
        if (!value) value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      } else {
        value = unescapeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }

      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = String(value).trim();
    }
    rows.push(cells);
  }
  return rows;
}

/**
 * Read every worksheet in a workbook.
 *
 * Returns `{ sheets: [{ name, rows }] }` where `rows` is an array of string arrays,
 * in sheet order. Empty trailing cells are not padded, so callers should treat a
 * missing index as an empty cell.
 */
export async function readWorkbook(arrayBuffer) {
  const parts = await unzip(
    arrayBuffer,
    (name) =>
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );

  const workbookXml = parts.get('xl/workbook.xml');
  if (!workbookXml) throw new Error('no workbook found inside the file — is it really an .xlsx?');

  const decoder = new TextDecoder();
  const sharedStrings = parts.has('xl/sharedStrings.xml')
    ? parseSharedStrings(decoder.decode(parts.get('xl/sharedStrings.xml')))
    : [];

  // Sheet display names live in workbook.xml and point at a relationship id; the
  // relationship then names the actual worksheet part.
  const relsXml = parts.has('xl/_rels/workbook.xml.rels') ? decoder.decode(parts.get('xl/_rels/workbook.xml.rels')) : '';
  const targetById = new Map();
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g)) {
    targetById.set(rel[1], rel[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''));
  }

  const sheets = [];
  const workbookText = decoder.decode(workbookXml);
  for (const sheet of workbookText.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attributes = sheet[1];
    const name = unescapeXml(/\bname="([^"]*)"/.exec(attributes)?.[1] ?? `Sheet${sheets.length + 1}`);
    const relId = /\br:id="([^"]*)"/.exec(attributes)?.[1];
    const target = relId ? targetById.get(relId) : null;
    const key = target ? `xl/${target}` : null;
    const part = key && parts.has(key) ? parts.get(key) : null;
    if (!part) continue;
    sheets.push({ name, rows: parseSheet(decoder.decode(part), sharedStrings) });
  }

  if (sheets.length === 0) throw new Error('the workbook contains no readable worksheets');
  return { sheets };
}

export function workbookSupported() {
  return typeof DecompressionStream !== 'undefined';
}
