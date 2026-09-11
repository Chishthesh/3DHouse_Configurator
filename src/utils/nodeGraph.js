// Model-driven scene inspection.
//
// Everything in this file is derived from whatever .glb was actually loaded: the node
// hierarchy (nodes AND sub-nodes), the materials each node uses, and the textures
// those materials reference. Nothing is keyed off a naming convention, so an arbitrary
// vendor export (Blender's "Cube.003" names included) is fully browsable.
import * as THREE from 'three';

// Blender/DCC default object names carry no meaning for an end user. We still list
// these nodes (they're real parts of the file), but flag them so the UI can offer a
// "hide auto-named parts" filter and so an uploaded material schedule can supply a
// human label for them via its `nodeLabels` map.
// The trailing group repeats because the glTF loader appends its own suffix when it
// splits a multi-material mesh: Blender's "Cube.003" arrives as "Cube003", and its
// three primitives become "Cube003_1", "Cube003_2", "Cube003_3".
const AUTO_NAME_RE =
  /^(cube|circle|cylinder|plane|sphere|icosphere|ico_?sphere|cone|torus|empty|object|mesh|node|group|curve|beziercurve|text|grid|suzanne|vert|line|point)([\s._-]*\d+)*$/i;

export function isAutoName(name) {
  return !name || AUTO_NAME_RE.test(name.trim());
}

export function prettifyName(raw) {
  if (!raw) return 'Unnamed part';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Case/separator-insensitive key used for every name comparison in the app (node
// patterns in an uploaded schedule, material names, node label overrides). Blender
// writes "Cube.003" but the glTF loader sanitizes it to "Cube003" when it builds the
// three.js scene, so both must collapse to the same key or an uploaded document
// written against the .blend would silently match nothing.
export function normalizeKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9*]+/g, '');
}

function safeBox(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return null;
  return box;
}

function materialsOf(mesh) {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
}

function triangleCount(mesh) {
  const geo = mesh.geometry;
  if (!geo) return 0;
  if (geo.index) return geo.index.count / 3;
  const pos = geo.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

/**
 * Flatten the loaded scene into an addressable node graph.
 *
 * Returns:
 *   nodes      - flat array in depth-first order, each with parentId/childIds so the
 *                UI can render a collapsible tree without re-walking three.js objects
 *   byId       - id -> node record lookup
 *   roots      - ids of the top-level nodes
 *   materials  - one record per distinct material instance, with the nodes using it
 *   textures   - one record per distinct texture instance, with the materials using it
 */
export function buildNodeGraph(root) {
  const nodes = [];
  const byId = new Map();
  const roots = [];
  const materialRecords = new Map(); // material.uuid -> record
  const textureRecords = new Map(); // texture.uuid -> record

  function registerMaterial(mat, slot, nodeId) {
    if (!mat) return null;
    let rec = materialRecords.get(mat.uuid);
    if (!rec) {
      rec = {
        id: mat.uuid,
        material: mat,
        name: mat.name || 'Unnamed material',
        type: mat.type,
        // Captured before any edit, so "Reset" and the inventory both show the
        // as-authored values rather than whatever the user last picked.
        original: {
          color: mat.color ? `#${mat.color.getHexString()}` : null,
          roughness: typeof mat.roughness === 'number' ? mat.roughness : null,
          metalness: typeof mat.metalness === 'number' ? mat.metalness : null,
          opacity: mat.opacity,
          transparent: mat.transparent,
          emissive: mat.emissive ? `#${mat.emissive.getHexString()}` : null,
        },
        maps: [],
        nodeIds: new Set(),
        meshCount: 0,
      };
      const MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'];
      for (const key of MAP_SLOTS) {
        const tex = mat[key];
        if (!tex) continue;
        rec.maps.push({ slot: key, textureId: tex.uuid, name: tex.name || tex.image?.name || `${key} texture` });
        let trec = textureRecords.get(tex.uuid);
        if (!trec) {
          trec = {
            id: tex.uuid,
            texture: tex,
            name: tex.name || tex.image?.name || 'Embedded texture',
            width: tex.image?.width ?? null,
            height: tex.image?.height ?? null,
            slots: new Set(),
            materialNames: new Set(),
          };
          textureRecords.set(tex.uuid, trec);
        }
        trec.slots.add(key);
        trec.materialNames.add(rec.name);
      }
      materialRecords.set(mat.uuid, rec);
    }
    rec.nodeIds.add(nodeId);
    if (slot === 0) rec.meshCount += 1;
    return rec;
  }

  function walk(obj, parentId, depth, pathParts) {
    // Skip helper objects we inject ourselves (selection box, cube cameras).
    if (obj.userData?.__configuratorHelper) return null;

    const name = obj.name || '';
    const path = [...pathParts, name || obj.type];
    const id = obj.uuid;
    const record = {
      id,
      name,
      rawType: obj.type,
      displayName: name ? prettifyName(name) : `${obj.type} (unnamed)`,
      autoNamed: isAutoName(name),
      path: path.join(' / '),
      pathParts: path,
      depth,
      parentId,
      childIds: [],
      object: obj,
      isMesh: !!obj.isMesh,
      ownMeshCount: obj.isMesh ? 1 : 0,
      meshCount: 0,
      triangles: 0,
      materialIds: [],
      materialNames: [],
      box: null,
    };

    nodes.push(record);
    byId.set(id, record);
    if (parentId === null) roots.push(id);
    else byId.get(parentId).childIds.push(id);

    // Aggregates (mesh count, triangles, materials, bounding box) are accumulated
    // from the node's own geometry plus its children's already-computed aggregates.
    // Re-traversing each subtree per node instead would make graph construction
    // quadratic, which a 200+ node vendor export feels immediately.
    const seenMat = new Set();
    if (obj.isMesh) {
      record.meshCount += 1;
      record.triangles += triangleCount(obj);
      materialsOf(obj).forEach((mat, slot) => {
        const rec = registerMaterial(mat, slot, id);
        if (rec && !seenMat.has(rec.id)) {
          seenMat.add(rec.id);
          record.materialIds.push(rec.id);
          record.materialNames.push(rec.name);
        }
      });
      const own = safeBox(obj);
      if (own) record.box = own;
    }

    for (const child of obj.children) {
      const childRecord = walk(child, id, depth + 1, path);
      if (!childRecord) continue;
      record.meshCount += childRecord.meshCount;
      record.triangles += childRecord.triangles;
      for (let i = 0; i < childRecord.materialIds.length; i++) {
        const matId = childRecord.materialIds[i];
        if (seenMat.has(matId)) continue;
        seenMat.add(matId);
        record.materialIds.push(matId);
        record.materialNames.push(childRecord.materialNames[i]);
        materialRecords.get(matId)?.nodeIds.add(id);
      }
      if (childRecord.box) {
        if (record.box) record.box.union(childRecord.box);
        else record.box = childRecord.box.clone();
      }
    }

    return record;
  }

  if (root) {
    for (const child of root.children) walk(child, null, 0, []);
  }

  const materials = [...materialRecords.values()].map((m) => ({
    ...m,
    nodeIds: [...m.nodeIds],
    nodeNames: [...m.nodeIds].map((id) => byId.get(id)?.name).filter(Boolean),
  }));
  const textures = [...textureRecords.values()].map((t) => ({
    ...t,
    slots: [...t.slots],
    materialNames: [...t.materialNames],
  }));

  return {
    nodes,
    byId,
    roots,
    materials,
    textures,
    stats: {
      nodeCount: nodes.length,
      meshCount: nodes.filter((n) => n.isMesh).length,
      materialCount: materials.length,
      textureCount: textures.length,
      triangles: Math.round(nodes.filter((n) => n.depth === 0).reduce((s, n) => s + n.triangles, 0)),
    },
  };
}

// Ancestors nearest-first, then the node itself last — used for the breadcrumb and for
// resolving which material group in an uploaded schedule applies to a selection.
export function ancestorChain(graph, nodeId) {
  const chain = [];
  let cur = graph.byId.get(nodeId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? graph.byId.get(cur.parentId) : null;
  }
  return chain;
}

export function selectableNodeFor(graph, object) {
  let o = object;
  while (o) {
    if (graph.byId.has(o.uuid)) return graph.byId.get(o.uuid);
    o = o.parent;
  }
  return null;
}

// Which meshes a change to this node should touch.
//
//   'smart' (default) - the node's own geometry, plus any sub-parts that have no
//                       finishes of their own. This is the intuitive reading of
//                       "change this part": choosing a stone for the island
//                       countertop should not also apply it to the island cabinets
//                       and the tap, which are separately configurable in their own
//                       right — but it should cover anonymous sub-geometry that
//                       nothing else can reach.
//   'subtree'         - literally everything under the node, sub-parts included.
//                       Useful for a deliberate "make this whole unit one colour".
//
// `hasOwnFinishes(nodeId)` reports whether a node is separately configurable; when it
// is not supplied, 'smart' behaves like 'subtree'.
export function meshesForScope(graph, nodeRecord, scope = 'smart', hasOwnFinishes = null) {
  const all = [];
  nodeRecord.object.traverse((o) => {
    if (o.isMesh && !o.userData?.__configuratorHelper) all.push(o);
  });
  if (scope === 'subtree' || !hasOwnFinishes || !graph) return all;

  return all.filter((mesh) => {
    // Walk up from the mesh to the selected node; if some node in between is itself
    // configurable, that node owns this mesh, not the selection.
    let cur = graph.byId.get(mesh.uuid);
    while (cur && cur.id !== nodeRecord.id) {
      if (hasOwnFinishes(cur.id)) return false;
      cur = cur.parentId ? graph.byId.get(cur.parentId) : null;
    }
    return true;
  });
}

// PNG data URL of a texture's pixels, for the Materials & Textures inventory. Textures
// inside a .glb are embedded image data with no URL of their own, so the only way to
// preview them is to draw the decoded image to a canvas.
export function textureThumbnail(texture, maxSize = 96) {
  try {
    const img = texture.image;
    if (!img) return null;
    const w = img.width || img.videoWidth;
    const h = img.height || img.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, maxSize / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (err) {
    // Tainted canvas / undecoded ImageBitmap — a missing thumbnail is not an error
    // worth breaking the inventory over.
    return null;
  }
}
