// Generic, file-driven scene inspection — everything here is computed from whatever
// .glb actually got loaded. Nothing is hardcoded to a specific model's room names or
// coordinates, so this works the same way for our own sample house and for a
// completely different uploaded model with its own scale, layout, and language.
import * as THREE from 'three';
import { ZONES } from '../data/zoneSpec.js';

export function prettifyName(raw) {
  if (!raw) return 'Unnamed';
  return raw
    .replace(/^structure_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Recognized {category}_{zone} names get their configurator label; structure_ nodes get
// a "Structure:" prefix; anything else (e.g. a real vendor file's own room names) just
// gets its raw name cleaned up for display.
export function labelForNode(name) {
  if (ZONES[name]) return ZONES[name].label;
  if (name?.startsWith('structure_')) return `Structure: ${prettifyName(name)}`;
  return prettifyName(name);
}

function safeBox(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.x)) return null;
  return box;
}

// One entry per top-level node in the file — this is "what all are in the .glb",
// regardless of whether it follows the category_zone convention or not. Keeps the
// actual node reference too, so callers can act on it directly (fly the camera to
// it, tint it) without re-searching the scene by name.
export function discoverAreas(root) {
  if (!root) return [];
  return root.children
    .filter((child) => child.name)
    .map((child) => ({ id: child.name, label: labelForNode(child.name), node: child, box: safeBox(child) }))
    .filter((area) => area.box);
}

// Every zone group actually present in this file (by exact name match against the
// known {category}_{zone} keys), with a combined bounding box across every group node
// sharing that name anywhere in the hierarchy.
export function discoverPresentZones(root) {
  if (!root) return [];
  const boxes = new Map();
  root.traverse((obj) => {
    const key = obj.name && ZONES[obj.name] ? obj.name : null;
    if (!key) return;
    const box = safeBox(obj);
    if (!box) return;
    if (boxes.has(key)) boxes.get(key).union(box);
    else boxes.set(key, box);
  });
  return [...boxes.entries()].map(([zoneKey, box]) => ({ zoneKey, box }));
}

// Camera position/target/zoom-limits framed around a bounding box, scaled to that
// box's own size — works regardless of the model's units or coordinate origin.
export function frameForBox(box, opts = {}) {
  const { azimuth = 0.6, elevation = 0.5, distanceFactor = 1.8, minFactor = 0.08, maxFactor = 3.2, minFloor = 0.2, enablePan = false } = opts;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.25);
  const dist = radius * distanceFactor;
  const dir = new THREE.Vector3(Math.sin(azimuth), elevation, Math.cos(azimuth)).normalize();
  const position = center.clone().addScaledVector(dir, dist);
  return {
    position: position.toArray(),
    target: center.toArray(),
    minDistance: Math.max(radius * minFactor, minFloor),
    maxDistance: Math.max(radius * maxFactor, dist * 1.3),
    enablePan,
  };
}

// Whole-model overview shot, used right after any file loads. Also returns the box
// itself so the caller can e.g. rest the ground plane at the model's real floor level.
export function frameForWholeScene(root) {
  const box = safeBox(root) ?? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const frame = frameForBox(box, { azimuth: 0.7, elevation: 1.0, distanceFactor: 1.7, maxFactor: 3.5, enablePan: true });
  return { ...frame, box };
}

// --- Generic (non-catalog) tinting -----------------------------------------------
// For a node that isn't one of the 14 known {category}_{zone} groups, there's no
// curated option list to offer (no name, no price, no roughness/metalness preset) —
// just a raw color. This tints every material found under that node in place, the
// same way applyZoneOption does for real zones, but keyed off the node reference
// directly rather than a name match.

function materialsUnder(node) {
  const mats = new Map();
  node.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    list.forEach((mat) => {
      if (mat && !mats.has(mat.uuid)) mats.set(mat.uuid, mat);
    });
  });
  return [...mats.values()];
}

export function tintNode(node, colorHex) {
  materialsUnder(node).forEach((mat) => {
    if (!mat.color) return;
    if (!mat.userData.__originalColorHex) {
      mat.userData.__originalColorHex = `#${mat.color.getHexString()}`;
    }
    mat.color.set(colorHex);
    mat.needsUpdate = true;
  });
}

export function resetNodeTint(node) {
  materialsUnder(node).forEach((mat) => {
    if (mat.userData.__originalColorHex) {
      mat.color.set(mat.userData.__originalColorHex);
      mat.needsUpdate = true;
    }
  });
}
