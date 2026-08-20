import { ZONES } from '../data/zoneSpec.js';

// glTF importers (and Blender's exporter) rename duplicate sibling node names by
// appending ".001", ".002", etc. Strip that so "flooring_hardwood.002" still
// resolves to the "flooring_hardwood" zone.
function baseName(name) {
  return name ? name.replace(/\.\d+$/, '') : name;
}

export function zoneKeyOf(name) {
  const base = baseName(name);
  return base && ZONES[base] ? base : null;
}

// Walk up from a clicked/hovered object to find the nearest ancestor (or itself)
// whose name matches a configurable zone group.
export function findZoneForObject(object) {
  let o = object;
  while (o) {
    const key = zoneKeyOf(o.name);
    if (key) return key;
    o = o.parent;
  }
  return null;
}

// Collect every mesh in the scene belonging to a given zone, regardless of how many
// separate group nodes share that zone name across the hierarchy.
export function collectZoneMeshes(root, zoneKey) {
  const meshes = [];
  root.traverse((obj) => {
    if (obj.isMesh && findZoneForObject(obj) === zoneKey) {
      meshes.push(obj);
    }
  });
  return meshes;
}

// Apply a material option (color/roughness/metalness) to every mesh in a zone.
// Mutates whatever materials are already on those meshes (shared or per-mesh) so it
// works for both our generated sample model and arbitrary uploaded GLBs.
export function applyZoneOption(root, zoneKey, option) {
  const meshes = collectZoneMeshes(root, zoneKey);
  const touched = new Set();
  meshes.forEach((mesh) => {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      if (!mat || touched.has(mat.uuid)) return;
      touched.add(mat.uuid);
      if (mat.color) mat.color.set(option.color);
      if ('roughness' in mat && typeof option.roughness === 'number') mat.roughness = option.roughness;
      if ('metalness' in mat && typeof option.metalness === 'number') mat.metalness = option.metalness;
      mat.needsUpdate = true;
    });
  });
  return meshes.length;
}
