// Generates a sample .glb for the configurator: a schematic single-story "Horizon"-style
// house whose scene graph follows the mesh-naming convention from
// "3D Model Specification for Home Configurator": named group nodes {category}_{zone}
// hold the configurable meshes; everything else uses the structure_ prefix.
//
// Run with: npm run generate:model

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { encodePNG } from './pngEncoder.mjs';
import {
  makePlankTexture,
  makeTileTexture,
  makeStoneSpeckleTexture,
  makeFabricNoiseTexture,
  makeBrushedMetalTexture,
  makeSidingTexture,
} from './proceduralTextures.mjs';

// Node 14 has neither Blob nor FileReader globally (both landed in Node 15.7+/18+).
// GLTFExporter's binary path uses both just to concatenate buffer chunks into one
// ArrayBuffer, so a minimal polyfill covering that single use case is sufficient here.
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class Blob {
    constructor(parts = [], opts = {}) {
      this.parts = parts.map((p) => {
        if (p instanceof ArrayBuffer) return new Uint8Array(p);
        if (ArrayBuffer.isView(p)) return new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
        return new Uint8Array(p);
      });
      this.type = opts.type ?? '';
      this.size = this.parts.reduce((sum, p) => sum + p.byteLength, 0);
    }
  };
}
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      const out = new Uint8Array(blob.size);
      let offset = 0;
      for (const part of blob.parts) {
        out.set(part, offset);
        offset += part.byteLength;
      }
      this.result = out.buffer;
      setTimeout(() => this.onloadend && this.onloadend(), 0);
    }
  };
}
// GLTFExporter embeds textures by drawing them onto a canvas and reading back PNG
// bytes. Node has neither a DOM canvas nor OffscreenCanvas, so this shim implements
// just the surface GLTFExporter touches (getContext('2d').putImageData + toBlob),
// backed by the hand-rolled PNG encoder above.
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this._data = null;
    }
    getContext() {
      const self = this;
      return {
        translate() {},
        scale() {},
        putImageData(imageData) {
          self._data = imageData.data;
        },
        drawImage() {},
      };
    }
    toBlob(callback, mimeType) {
      const png = encodePNG(this.width, this.height, this._data);
      callback(new globalThis.Blob([png], { type: mimeType || 'image/png' }));
    }
    toDataURL(mimeType) {
      const png = encodePNG(this.width, this.height, this._data);
      return `data:${mimeType || 'image/png'};base64,${Buffer.from(png).toString('base64')}`;
    }
  };
}

import { ZONES } from '../data/zoneSpec.js';
import {
  FOOTPRINT,
  WALL_HEIGHT,
  EXT_WALL_THICKNESS,
  ROOMS,
  INTERIOR_WALLS,
  FRONT_DOOR,
  WINDOWS,
} from '../data/houseLayout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, '../../public/models/sample-house.glb');

const scene = new THREE.Scene();
scene.name = 'TheHorizon_SampleHouse';

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const zoneGroups = {};
for (const key of Object.keys(ZONES)) {
  const g = new THREE.Group();
  g.name = key;
  scene.add(g);
  zoneGroups[key] = g;
}

function structureGroup(name) {
  if (structureGroup._cache?.[name]) return structureGroup._cache[name];
  structureGroup._cache = structureGroup._cache || {};
  const g = new THREE.Group();
  g.name = name;
  scene.add(g);
  structureGroup._cache[name] = g;
  return g;
}

// ---------------------------------------------------------------------------
// Material cache (one material per zone default + a handful of fixed structure looks)
// ---------------------------------------------------------------------------

// Neutral/near-white procedural textures per zone (spec: keep textures white-balanced
// so the configurator's color tint still reads correctly), with a UV repeat tuned to
// roughly "1 meter = 1 tile-ish unit" per the spec's UV guidance.
const ZONE_TEXTURE_FACTORIES = {
  flooring_hardwood: () => makePlankTexture({ size: 256, planks: 8 }),
  flooring_carpet: () => makeFabricNoiseTexture({ size: 128 }),
  flooring_tile: () => makeTileTexture({ size: 256, grid: 4 }),
  countertops_kitchen: () => makeStoneSpeckleTexture({ size: 256, base: 200 }),
  countertops_bathroom: () => makeStoneSpeckleTexture({ size: 256, base: 245 }),
  'wall-tiles_kitchen': () => makeTileTexture({ size: 256, grid: 8, base: 248, groutBase: 220 }),
  'wall-tiles_bathroom': () => makeTileTexture({ size: 256, grid: 5, base: 238 }),
  'fixtures_whole-home': () => makeBrushedMetalTexture({ size: 128 }),
  'appliances_whole-home': () => makeBrushedMetalTexture({ size: 256 }),
  'exterior_whole-home': () => makeSidingTexture({ size: 256, lines: 14 }),
};
const ZONE_TEXTURE_REPEAT = {
  flooring_hardwood: [10, 10],
  flooring_carpet: [4, 4],
  flooring_tile: [8, 8],
  countertops_kitchen: [3, 2],
  countertops_bathroom: [2, 1],
  'wall-tiles_kitchen': [5, 2],
  'wall-tiles_bathroom': [3, 3],
  'fixtures_whole-home': [1, 3],
  'appliances_whole-home': [1, 2],
  'exterior_whole-home': [1, 14],
};

const materialCache = {};
function zoneMaterial(zoneKey) {
  if (materialCache[zoneKey]) return materialCache[zoneKey];
  const d = ZONES[zoneKey].default;
  let map = null;
  const factory = ZONE_TEXTURE_FACTORIES[zoneKey];
  if (factory) {
    const tex = factory();
    map = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    const [rx, ry] = ZONE_TEXTURE_REPEAT[zoneKey] ?? [1, 1];
    map.repeat.set(rx, ry);
    map.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(d.color),
    roughness: d.roughness,
    metalness: d.metalness,
    map,
    name: `${zoneKey}__default`,
  });
  materialCache[zoneKey] = mat;
  return mat;
}

function fixedMaterial(key, opts) {
  if (materialCache[key]) return materialCache[key];
  const mat = new THREE.MeshStandardMaterial({ name: key, ...opts });
  materialCache[key] = mat;
  return mat;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

let meshCounter = 0;
function addBox(group, { cx, cy, cz, sx, sy, sz, material, name }) {
  const geo = new THREE.BoxGeometry(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(cx, cy, cz);
  mesh.name = name || `mesh_${meshCounter++}`;
  group.add(mesh);
  return mesh;
}

function addCylinder(group, { cx, cy, cz, r, r2, h, radialSegments = 16, material, name, rotX = 0, rotZ = 0 }) {
  const geo = new THREE.CylinderGeometry(r, r2 ?? r, h, radialSegments);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(cx, cy, cz);
  if (rotX) mesh.rotation.x = rotX;
  if (rotZ) mesh.rotation.z = rotZ;
  mesh.name = name || `mesh_${meshCounter++}`;
  group.add(mesh);
  return mesh;
}

function addSphere(group, { cx, cy, cz, r, scaleY = 1, material, name }) {
  const geo = new THREE.SphereGeometry(r, 10, 8);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(cx, cy, cz);
  mesh.scale.set(1, scaleY, 1);
  mesh.name = name || `mesh_${meshCounter++}`;
  group.add(mesh);
  return mesh;
}

function addPlant(group, { cx, cy, cz, potR = 0.09, potH = 0.18, leafR = 0.16, idPrefix = 'plant' }) {
  const potMat = fixedMaterial('structure_plantpot_mat', { color: 0xa5522f, roughness: 0.8, metalness: 0 });
  const leafMat = fixedMaterial('structure_plantleaf_mat', { color: 0x3f7d3a, roughness: 0.7, metalness: 0 });
  addCylinder(group, { cx, cy: cy + potH / 2, cz, r: potR, r2: potR * 0.8, h: potH, material: potMat, name: `${idPrefix}_pot` });
  addSphere(group, { cx, cy: cy + potH + leafR * 0.7, cz, r: leafR, scaleY: 1.3, material: leafMat, name: `${idPrefix}_foliage` });
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

for (const room of ROOMS) {
  const { x0, x1, z0, z1 } = room.rect;
  addBox(zoneGroups[room.floorZone], {
    cx: (x0 + x1) / 2,
    cy: -0.05,
    cz: (z0 + z1) / 2,
    sx: x1 - x0,
    sy: 0.1,
    sz: z1 - z0,
    material: zoneMaterial(room.floorZone),
    name: `${room.id}_floor`,
  });
}

// ---------------------------------------------------------------------------
// Ceiling + interior walls (paint_whole-home)
// ---------------------------------------------------------------------------

addBox(zoneGroups['paint_whole-home'], {
  cx: (FOOTPRINT.minX + FOOTPRINT.maxX) / 2,
  cy: WALL_HEIGHT + 0.05,
  cz: (FOOTPRINT.minZ + FOOTPRINT.maxZ) / 2,
  sx: FOOTPRINT.maxX - FOOTPRINT.minX,
  sy: 0.1,
  sz: FOOTPRINT.maxZ - FOOTPRINT.minZ,
  material: zoneMaterial('paint_whole-home'),
  name: 'ceiling',
});

function wallSegments(from, to, doorGap) {
  if (!doorGap) return [[from, to]];
  const [a, b] = doorGap;
  const segs = [];
  if (a - from > 0.05) segs.push([from, a]);
  if (to - b > 0.05) segs.push([b, to]);
  return segs;
}

INTERIOR_WALLS.forEach((wall, i) => {
  const segs = wallSegments(wall.from, wall.to, wall.doorGap);
  segs.forEach(([a, b], j) => {
    if (wall.axis === 'x') {
      addBox(zoneGroups['paint_whole-home'], {
        cx: (a + b) / 2,
        cy: WALL_HEIGHT / 2,
        cz: wall.at,
        sx: b - a,
        sy: WALL_HEIGHT,
        sz: 0.12,
        material: zoneMaterial('paint_whole-home'),
        name: `interior_wall_${i}_${j}`,
      });
    } else {
      addBox(zoneGroups['paint_whole-home'], {
        cx: wall.at,
        cy: WALL_HEIGHT / 2,
        cz: (a + b) / 2,
        sx: 0.12,
        sy: WALL_HEIGHT,
        sz: b - a,
        material: zoneMaterial('paint_whole-home'),
        name: `interior_wall_${i}_${j}`,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Exterior walls: three layers so the outside face (exterior_whole-home) is a
// separate mesh from the inside face (paint_whole-home), per spec.
// ---------------------------------------------------------------------------

const structureCore = structureGroup('structure_wall-cores');
const coreMat = fixedMaterial('structure_wall-core_mat', { color: 0xb9b2a4, roughness: 0.9, metalness: 0 });

function exteriorWallSide({ name, fixedAxis, fixedVal, outwardSign, runFrom, runTo, gap }) {
  const segs = wallSegments(runFrom, runTo, gap);
  const outerT = 0.05;
  const coreT = 0.1;
  const innerT = 0.05;
  const depthOf = (d) => fixedVal - outwardSign * d;

  segs.forEach(([a, b], j) => {
    const runLen = b - a;
    const runCenter = (a + b) / 2;
    const layers = [
      { d: outerT / 2, t: outerT, group: zoneGroups['exterior_whole-home'], mat: zoneMaterial('exterior_whole-home'), tag: 'outer' },
      { d: outerT + coreT / 2, t: coreT, group: structureCore, mat: coreMat, tag: 'core' },
      { d: outerT + coreT + innerT / 2, t: innerT, group: zoneGroups['paint_whole-home'], mat: zoneMaterial('paint_whole-home'), tag: 'inner' },
    ];
    layers.forEach((layer) => {
      const center = depthOf(layer.d);
      if (fixedAxis === 'z') {
        addBox(layer.group, {
          cx: runCenter,
          cy: WALL_HEIGHT / 2,
          cz: center,
          sx: runLen,
          sy: WALL_HEIGHT,
          sz: layer.t,
          material: layer.mat,
          name: `${name}_${layer.tag}_${j}`,
        });
      } else {
        addBox(layer.group, {
          cx: center,
          cy: WALL_HEIGHT / 2,
          cz: runCenter,
          sx: layer.t,
          sy: WALL_HEIGHT,
          sz: runLen,
          material: layer.mat,
          name: `${name}_${layer.tag}_${j}`,
        });
      }
    });
  });
}

exteriorWallSide({ name: 'south_wall', fixedAxis: 'z', fixedVal: FOOTPRINT.maxZ, outwardSign: 1, runFrom: FOOTPRINT.minX, runTo: FOOTPRINT.maxX, gap: [FRONT_DOOR.x0, FRONT_DOOR.x1] });
exteriorWallSide({ name: 'north_wall', fixedAxis: 'z', fixedVal: FOOTPRINT.minZ, outwardSign: -1, runFrom: FOOTPRINT.minX, runTo: FOOTPRINT.maxX, gap: null });
exteriorWallSide({ name: 'east_wall', fixedAxis: 'x', fixedVal: FOOTPRINT.maxX, outwardSign: 1, runFrom: FOOTPRINT.minZ, runTo: FOOTPRINT.maxZ, gap: null });
exteriorWallSide({ name: 'west_wall', fixedAxis: 'x', fixedVal: FOOTPRINT.minX, outwardSign: -1, runFrom: FOOTPRINT.minZ, runTo: FOOTPRINT.maxZ, gap: null });

// ---------------------------------------------------------------------------
// Roof + foundation (structure_, non-configurable)
// ---------------------------------------------------------------------------

const roofMat = fixedMaterial('structure_roof_mat', { color: 0x3a3a3c, roughness: 0.85, metalness: 0.05 });
addBox(structureGroup('structure_roof'), {
  cx: (FOOTPRINT.minX + FOOTPRINT.maxX) / 2,
  cy: WALL_HEIGHT + 0.4,
  cz: (FOOTPRINT.minZ + FOOTPRINT.maxZ) / 2,
  sx: FOOTPRINT.maxX - FOOTPRINT.minX + 1.2,
  sy: 0.5,
  sz: FOOTPRINT.maxZ - FOOTPRINT.minZ + 1.2,
  material: roofMat,
  name: 'roof_slab',
});
addBox(structureGroup('structure_roof'), {
  cx: (FOOTPRINT.minX + FOOTPRINT.maxX) / 2,
  cy: WALL_HEIGHT + 0.9,
  cz: (FOOTPRINT.minZ + FOOTPRINT.maxZ) / 2,
  sx: FOOTPRINT.maxX - FOOTPRINT.minX - 3,
  sy: 0.5,
  sz: FOOTPRINT.maxZ - FOOTPRINT.minZ - 3,
  material: roofMat,
  name: 'roof_ridge',
});

const foundationMat = fixedMaterial('structure_foundation_mat', { color: 0x9a9a92, roughness: 0.95, metalness: 0 });
addBox(structureGroup('structure_foundation'), {
  cx: (FOOTPRINT.minX + FOOTPRINT.maxX) / 2,
  cy: -0.3,
  cz: (FOOTPRINT.minZ + FOOTPRINT.maxZ) / 2,
  sx: FOOTPRINT.maxX - FOOTPRINT.minX + 0.4,
  sy: 0.3,
  sz: FOOTPRINT.maxZ - FOOTPRINT.minZ + 0.4,
  material: foundationMat,
  name: 'foundation_slab',
});

// ---------------------------------------------------------------------------
// Windows + front door (structure_, non-configurable)
// ---------------------------------------------------------------------------

const glassMat = fixedMaterial('structure_glass_mat', { color: 0x8fb7cf, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55 });
const frameMat = fixedMaterial('structure_window-frame_mat', { color: 0xf5f5f0, roughness: 0.6, metalness: 0 });

const wallOuterInfo = {
  south: { fixedAxis: 'z', fixedVal: FOOTPRINT.maxZ, outwardSign: 1 },
  north: { fixedAxis: 'z', fixedVal: FOOTPRINT.minZ, outwardSign: -1 },
  east: { fixedAxis: 'x', fixedVal: FOOTPRINT.maxX, outwardSign: 1 },
  west: { fixedAxis: 'x', fixedVal: FOOTPRINT.minX, outwardSign: -1 },
};

const windowsGroup = structureGroup('structure_windows');
WINDOWS.forEach((w, i) => {
  const info = wallOuterInfo[w.wall];
  const outerFace = info.fixedVal;
  const glassCenter = outerFace - info.outwardSign * 0.02;
  const frameCenter = outerFace - info.outwardSign * 0.06;
  const run = (w.from + w.to) / 2;
  const runLen = w.to - w.from;
  const cy = w.sill + w.height / 2;

  if (info.fixedAxis === 'z') {
    addBox(windowsGroup, { cx: run, cy, cz: frameCenter, sx: runLen + 0.15, sy: w.height + 0.15, sz: 0.06, material: frameMat, name: `window_${i}_frame` });
    addBox(windowsGroup, { cx: run, cy, cz: glassCenter, sx: runLen, sy: w.height, sz: 0.02, material: glassMat, name: `window_${i}_glass` });
  } else {
    addBox(windowsGroup, { cx: frameCenter, cy, cz: run, sx: 0.06, sy: w.height + 0.15, sz: runLen + 0.15, material: frameMat, name: `window_${i}_frame` });
    addBox(windowsGroup, { cx: glassCenter, cy, cz: run, sx: 0.02, sy: w.height, sz: runLen, material: glassMat, name: `window_${i}_glass` });
  }
});

const doorMat = fixedMaterial('structure_door_mat', { color: 0x6b4a35, roughness: 0.55, metalness: 0 });
addBox(structureGroup('structure_doors'), {
  cx: (FRONT_DOOR.x0 + FRONT_DOOR.x1) / 2,
  cy: 1.05,
  cz: FRONT_DOOR.z - 0.05,
  sx: FRONT_DOOR.x1 - FRONT_DOOR.x0 - 0.1,
  sy: 2.1,
  sz: 0.06,
  material: doorMat,
  name: 'front_door',
});

// ---------------------------------------------------------------------------
// Kitchen (x0..8, z: -6..0)
// ---------------------------------------------------------------------------

const cabKitchenMat = zoneMaterial('cabinets_kitchen');
const counterKitchenMat = zoneMaterial('countertops_kitchen');
const backsplashMat = zoneMaterial('wall-tiles_kitchen');
const applianceMat = zoneMaterial('appliances_whole-home');
const fixtureMat = zoneMaterial('fixtures_whole-home');

// Lower + upper cabinet run along the east wall (x ~ 7.6), z from -5.5 to -0.6
const runZ0 = -5.5, runZ1 = -0.6;
addBox(zoneGroups.cabinets_kitchen, { cx: 7.55, cy: 0.45, cz: (runZ0 + runZ1) / 2, sx: 0.6, sy: 0.9, sz: runZ1 - runZ0, material: cabKitchenMat, name: 'kitchen_lower_cabinets' });
addBox(zoneGroups.countertops_kitchen, { cx: 7.5, cy: 0.93, cz: (runZ0 + runZ1) / 2, sx: 0.7, sy: 0.06, sz: runZ1 - runZ0 + 0.1, material: counterKitchenMat, name: 'kitchen_counter_run' });
addBox(zoneGroups['wall-tiles_kitchen'], { cx: 7.85, cy: 1.2, cz: (runZ0 + runZ1) / 2, sx: 0.02, sy: 0.55, sz: runZ1 - runZ0, material: backsplashMat, name: 'kitchen_backsplash' });
addBox(zoneGroups.cabinets_kitchen, { cx: 7.75, cy: 1.9, cz: (runZ0 + runZ1) / 2, sx: 0.35, sy: 0.8, sz: runZ1 - runZ0, material: cabKitchenMat, name: 'kitchen_upper_cabinets' });

// Island
addBox(zoneGroups.cabinets_kitchen, { cx: 4, cy: 0.45, cz: -3, sx: 2.4, sy: 0.9, sz: 1.1, material: cabKitchenMat, name: 'kitchen_island_cabinet' });
addBox(zoneGroups.countertops_kitchen, { cx: 4, cy: 0.93, cz: -3, sx: 2.6, sy: 0.06, sz: 1.3, material: counterKitchenMat, name: 'kitchen_island_counter' });

// Appliances
addBox(zoneGroups['appliances_whole-home'], { cx: 7.35, cy: 0.9, cz: -5.2, sx: 0.75, sy: 1.8, sz: 0.7, material: applianceMat, name: 'fridge' });
addBox(zoneGroups['appliances_whole-home'], { cx: 7.35, cy: 0.45, cz: -3.0, sx: 0.65, sy: 0.9, sz: 0.65, material: applianceMat, name: 'range' });
addBox(zoneGroups['appliances_whole-home'], { cx: 6.8, cy: 1.6, cz: -3.0, sx: 0.7, sy: 0.3, sz: 0.5, material: applianceMat, name: 'range_hood' });
addBox(zoneGroups['appliances_whole-home'], { cx: 7.35, cy: 0.45, cz: -1.3, sx: 0.6, sy: 0.85, sz: 0.6, material: applianceMat, name: 'dishwasher' });

// Fixtures: faucet + pendant lights + cabinet pulls
addCylinder(zoneGroups['fixtures_whole-home'], { cx: 7.5, cy: 1.05, cz: -1.5, r: 0.02, h: 0.25, material: fixtureMat, name: 'kitchen_faucet' });
[3.3, 4.7].forEach((x, i) => {
  addCylinder(zoneGroups['fixtures_whole-home'], { cx: x, cy: 2.35, cz: -3, r: 0.06, h: 0.3, material: fixtureMat, name: `kitchen_pendant_${i}` });
});
for (let z = runZ0 + 0.5; z < runZ1; z += 0.6) {
  addBox(zoneGroups['fixtures_whole-home'], { cx: 7.36, cy: 0.6, cz: z, sx: 0.02, sy: 0.1, sz: 0.02, material: fixtureMat, name: `cabinet_pull_${z.toFixed(1)}` });
}
addCylinder(zoneGroups['fixtures_whole-home'], { cx: (FOOTPRINT.minX + 0) / 2 + 4, cy: WALL_HEIGHT - 0.15, cz: -4.5, r: 0.15, h: 0.05, material: fixtureMat, name: 'kitchen_ceiling_light' });

// ---------------------------------------------------------------------------
// Great room fireplace (structure) + ceiling light
// ---------------------------------------------------------------------------

const fireplaceMat = fixedMaterial('structure_fireplace_mat', { color: 0x6d6459, roughness: 0.9, metalness: 0 });
addBox(structureGroup('structure_fireplace'), { cx: FOOTPRINT.minX + 0.35, cy: 1.0, cz: -3, sx: 0.5, sy: 2.0, sz: 1.6, material: fireplaceMat, name: 'fireplace_surround' });
addBox(structureGroup('structure_fireplace'), { cx: FOOTPRINT.minX + 0.4, cy: 0.4, cz: -3, sx: 0.55, sy: 0.8, sz: 1.0, material: fixedMaterial('structure_firebox_mat', { color: 0x1c1c1c, roughness: 0.4, metalness: 0.2 }), name: 'firebox' });
addCylinder(zoneGroups['fixtures_whole-home'], { cx: -4, cy: WALL_HEIGHT - 0.15, cz: -3, r: 0.18, h: 0.05, material: fixtureMat, name: 'great_room_ceiling_light' });
addCylinder(zoneGroups['fixtures_whole-home'], { cx: 0, cy: WALL_HEIGHT - 0.15, cz: 2, r: 0.14, h: 0.05, material: fixtureMat, name: 'hallway_ceiling_light' });
addCylinder(zoneGroups['fixtures_whole-home'], { cx: 0, cy: WALL_HEIGHT - 0.15, cz: 5, r: 0.16, h: 0.05, material: fixtureMat, name: 'foyer_ceiling_light' });
addCylinder(zoneGroups['fixtures_whole-home'], { cx: -6.25, cy: WALL_HEIGHT - 0.15, cz: 3, r: 0.14, h: 0.05, material: fixtureMat, name: 'master_bedroom_ceiling_light' });
addCylinder(zoneGroups['fixtures_whole-home'], { cx: 5.25, cy: WALL_HEIGHT - 0.15, cz: 4.5, r: 0.14, h: 0.05, material: fixtureMat, name: 'bedroom2_ceiling_light' });

// ---------------------------------------------------------------------------
// Bathrooms (shared builder)
// ---------------------------------------------------------------------------

function buildBathroom({ id, vanityX, vanityZ0, vanityZ1, vanityAxis, tileWallX, tubX, tubZ0, tubZ1, mirrorX, mirrorZ }) {
  const cabMat = zoneMaterial('cabinets_bathroom');
  const counterMat = zoneMaterial('countertops_bathroom');
  const tileMat = zoneMaterial('wall-tiles_bathroom');
  const porcelainMat = fixedMaterial('structure_porcelain_mat', { color: 0xf5f5f5, roughness: 0.25, metalness: 0 });
  const mirrorMat = fixedMaterial('structure_mirror_mat', { color: 0xcfd8dc, roughness: 0.05, metalness: 0.4 });

  const vanityLen = vanityZ1 - vanityZ0;
  const vanityCz = (vanityZ0 + vanityZ1) / 2;
  const counterTopY = 0.83 + 0.025; // top surface of the 0.05-thick counter slab
  addBox(zoneGroups.cabinets_bathroom, { cx: vanityX, cy: 0.4, cz: vanityCz, sx: 0.55, sy: 0.8, sz: vanityLen, material: cabMat, name: `${id}_vanity_cabinet` });
  addBox(zoneGroups.countertops_bathroom, { cx: vanityX, cy: 0.83, cz: vanityCz, sx: 0.62, sy: 0.05, sz: vanityLen + 0.08, material: counterMat, name: `${id}_vanity_top` });
  addBox(zoneGroups['wall-tiles_bathroom'], { cx: tileWallX, cy: 1.35, cz: vanityCz, sx: 0.02, sy: 2.7, sz: vanityLen, material: tileMat, name: `${id}_vanity_backsplash` });
  addBox(zoneGroups['wall-tiles_bathroom'], { cx: (tubX + tileWallX) / 2, cy: 1.35, cz: tubZ0 - 0.02, sx: Math.abs(tubX - tileWallX), sy: 2.7, sz: 0.02, material: tileMat, name: `${id}_shower_wall` });

  // Vessel-style wash basin sitting on the vanity top, with an L-shaped faucet arcing over it
  const basinMat = fixedMaterial('structure_basin_mat', { color: 0xfafafa, roughness: 0.15, metalness: 0 });
  const basinCx = vanityX - 0.06;
  addCylinder(structureGroup('structure_bathroom-fixtures'), { cx: basinCx, cy: counterTopY + 0.06, cz: vanityCz, r: 0.19, r2: 0.15, h: 0.12, material: basinMat, name: `${id}_basin` });

  addBox(structureGroup('structure_bathroom-fixtures'), { cx: tubX, cy: 0.25, cz: (tubZ0 + tubZ1) / 2, sx: 0.7, sy: 0.5, sz: tubZ1 - tubZ0, material: porcelainMat, name: `${id}_tub` });
  // rotation.y is a facing hint the viewer reads when swapping this thin box for a
  // real-time reflective surface: 0 = normal faces +X (room is on the +X side of the
  // wall), PI = normal faces -X (room is on the -X side).
  const mirrorMesh = addBox(structureGroup('structure_bathroom-fixtures'), { cx: mirrorX, cy: 1.55, cz: mirrorZ, sx: 0.02, sy: 0.7, sz: vanityLen - 0.1, material: mirrorMat, name: `${id}_mirror` });
  if (tileWallX > vanityX) mirrorMesh.rotation.y = Math.PI;
  addBox(structureGroup('structure_bathroom-fixtures'), { cx: mirrorX - 0.015, cy: 1.55, cz: mirrorZ, sx: 0.03, sy: 0.76, sz: vanityLen - 0.02, material: frameMat, name: `${id}_mirror_frame` });
  addCylinder(structureGroup('structure_bathroom-fixtures'), { cx: vanityX - 0.7, cy: 0.2, cz: vanityZ0 - 0.3, r: 0.18, h: 0.38, material: porcelainMat, name: `${id}_toilet_base` });
  addBox(structureGroup('structure_bathroom-fixtures'), { cx: vanityX - 0.7, cy: 0.42, cz: vanityZ0 - 0.42, sx: 0.36, sy: 0.4, sz: 0.2, material: porcelainMat, name: `${id}_toilet_tank` });

  // Glass shower door enclosing the open end of the tub/shower run
  const showerSpan = Math.abs(tubX - tileWallX);
  const showerCenterX = (tubX + tileWallX) / 2;
  addBox(structureGroup('structure_bathroom-fixtures'), { cx: showerCenterX, cy: 1.0, cz: tubZ1 + 0.03, sx: showerSpan + 0.05, sy: 2.0, sz: 0.03, material: frameMat, name: `${id}_shower_door_frame` });
  addBox(structureGroup('structure_bathroom-fixtures'), { cx: showerCenterX, cy: 1.0, cz: tubZ1 + 0.05, sx: showerSpan - 0.06, sy: 1.9, sz: 0.012, material: glassMat, name: `${id}_shower_door_glass` });

  // Accessories: soap dispenser, folded towels, bath mat, small plant
  const soapMat = fixedMaterial('structure_soap_mat', { color: 0xffffff, roughness: 0.3, metalness: 0 });
  const towelMat = fixedMaterial('structure_towel_mat', { color: 0xffffff, roughness: 0.85, metalness: 0 });
  const bathmatMat = fixedMaterial('structure_bathmat_mat', { color: 0xdedbd0, roughness: 0.9, metalness: 0 });
  addCylinder(structureGroup('structure_bathroom-fixtures'), { cx: vanityX + 0.22, cy: 0.89, cz: vanityZ0 + 0.12, r: 0.03, h: 0.13, material: soapMat, name: `${id}_soap_dispenser` });
  for (let i = 0; i < 3; i++) {
    addBox(structureGroup('structure_bathroom-fixtures'), { cx: vanityX - 0.2, cy: 0.86 + i * 0.05, cz: vanityZ1 - 0.12, sx: 0.3, sy: 0.04, sz: 0.18, material: towelMat, name: `${id}_folded_towel_${i}` });
  }
  addBox(structureGroup('structure_bathroom-fixtures'), { cx: vanityX, cy: 0.005, cz: vanityZ0 - 0.5, sx: 0.6, sy: 0.01, sz: 0.4, material: bathmatMat, name: `${id}_bathmat` });
  addPlant(structureGroup('structure_bathroom-fixtures'), { cx: vanityX + 0.35, cy: 0, cz: vanityZ1 + 0.3, potR: 0.08, potH: 0.16, leafR: 0.13, idPrefix: `${id}_plant` });

  const faucetCx = vanityX + 0.2;
  addCylinder(zoneGroups['fixtures_whole-home'], { cx: faucetCx, cy: counterTopY + 0.14, cz: vanityCz, r: 0.015, h: 0.28, material: zoneMaterial('fixtures_whole-home'), name: `${id}_faucet` });
  addCylinder(zoneGroups['fixtures_whole-home'], { cx: (faucetCx + basinCx) / 2, cy: counterTopY + 0.27, cz: vanityCz, r: 0.013, h: Math.abs(faucetCx - basinCx), rotZ: Math.PI / 2, material: zoneMaterial('fixtures_whole-home'), name: `${id}_faucet_spout` });
  addCylinder(zoneGroups['fixtures_whole-home'], { cx: tileWallX + 0.05, cy: 1.1, cz: tubZ0 + 0.1, r: 0.015, h: 0.5, material: zoneMaterial('fixtures_whole-home'), rotX: Math.PI / 2, name: `${id}_towel_bar` });
  addCylinder(zoneGroups['fixtures_whole-home'], { cx: vanityX, cy: WALL_HEIGHT - 0.15, cz: vanityCz, r: 0.1, h: 0.05, material: zoneMaterial('fixtures_whole-home'), name: `${id}_ceiling_light` });
}

buildBathroom({
  id: 'master_bath',
  vanityX: -4.2, vanityZ0: 0.3, vanityZ1: 1.5, vanityAxis: 'z',
  tileWallX: -4.48, tubX: -3.0, tubZ0: 0.3, tubZ1: 2.7,
  mirrorX: -4.44, mirrorZ: 0.9,
});

buildBathroom({
  id: 'hall_bath',
  vanityX: 4.7, vanityZ0: 0.3, vanityZ1: 1.5, vanityAxis: 'z',
  tileWallX: 4.98, tubX: 3.3, tubZ0: 0.3, tubZ1: 2.5,
  mirrorX: 4.94, mirrorZ: 0.9,
});
addCylinder(zoneGroups['fixtures_whole-home'], { cx: -4.2, cy: WALL_HEIGHT - 0.15, cz: 4.5, r: 0.1, h: 0.05, material: zoneMaterial('fixtures_whole-home'), name: 'master_bath_extra_light' });

// ---------------------------------------------------------------------------
// Laundry (cabinets_utility) at x:5..8, z:0..3
// ---------------------------------------------------------------------------

const utilityMat = zoneMaterial('cabinets_utility');
addBox(zoneGroups.cabinets_utility, { cx: 6.5, cy: 2.0, cz: 0.35, sx: 2.6, sy: 0.6, sz: 0.35, material: utilityMat, name: 'laundry_upper_cabinets' });
const laundryApplianceMat = fixedMaterial('structure_laundry-appliance_mat', { color: 0xeaeaea, roughness: 0.4, metalness: 0.2 });
addBox(structureGroup('structure_laundry-appliances'), { cx: 5.6, cy: 0.45, cz: 0.5, sx: 0.65, sy: 0.9, sz: 0.65, material: laundryApplianceMat, name: 'washer' });
addBox(structureGroup('structure_laundry-appliances'), { cx: 6.3, cy: 0.45, cz: 0.5, sx: 0.65, sy: 0.9, sz: 0.65, material: laundryApplianceMat, name: 'dryer' });
addCylinder(zoneGroups['fixtures_whole-home'], { cx: 6.5, cy: WALL_HEIGHT - 0.15, cz: 1.5, r: 0.1, h: 0.05, material: zoneMaterial('fixtures_whole-home'), name: 'laundry_ceiling_light' });

// ---------------------------------------------------------------------------
// Furniture & staging props (structure_, non-configurable) — beds, seating, and
// accessories so rooms read as real spaces rather than empty shells.
// ---------------------------------------------------------------------------

const woodMat = fixedMaterial('structure_wood-furniture_mat', { color: 0x8a6240, roughness: 0.55, metalness: 0 });
const mattressMat = fixedMaterial('structure_mattress_mat', { color: 0xf5f2ea, roughness: 0.85, metalness: 0 });
const pillowMat = fixedMaterial('structure_pillow_mat', { color: 0xffffff, roughness: 0.85, metalness: 0 });

function addBed(group, { id, headboardX, footX, cz, width, comforterColor, rugColor }) {
  const comforterMat = fixedMaterial(`structure_comforter-${id}_mat`, { color: comforterColor, roughness: 0.85, metalness: 0 });
  const rugMat = fixedMaterial(`structure_rug-${id}_mat`, { color: rugColor, roughness: 0.9, metalness: 0 });
  const length = Math.abs(footX - headboardX);
  const dir = Math.sign(footX - headboardX);
  const frameCx = headboardX + dir * (length / 2);

  addBox(group, { cx: headboardX - dir * 0.05, cy: 0.9, cz, sx: 0.1, sy: 1.0, sz: width, material: woodMat, name: `${id}_headboard` });
  addBox(group, { cx: frameCx, cy: 0.25, cz, sx: length, sy: 0.35, sz: width - 0.05, material: woodMat, name: `${id}_frame` });
  addBox(group, { cx: frameCx, cy: 0.55, cz, sx: length, sy: 0.25, sz: width - 0.1, material: mattressMat, name: `${id}_mattress` });
  addBox(group, { cx: headboardX + dir * (length * 0.35), cy: 0.68, cz, sx: length * 0.55, sy: 0.12, sz: width - 0.1, material: comforterMat, name: `${id}_comforter` });
  addBox(group, { cx: headboardX + dir * 0.15, cy: 0.75, cz: cz - width * 0.28, sx: 0.35, sy: 0.14, sz: width * 0.32, material: pillowMat, name: `${id}_pillow_1` });
  addBox(group, { cx: headboardX + dir * 0.15, cy: 0.75, cz: cz + width * 0.28, sx: 0.35, sy: 0.14, sz: width * 0.32, material: pillowMat, name: `${id}_pillow_2` });
  addBox(group, { cx: frameCx, cy: 0.01, cz, sx: length * 0.85, sy: 0.02, sz: width + 0.6, material: rugMat, name: `${id}_rug` });

  return { frameCx, length };
}

// The nightstand body is plain furniture (non-configurable); the lamp itself is a
// light fixture and per spec belongs to the configurable fixtures_whole-home zone.
function addNightstandLamp(group, { id, cx, cz }) {
  addBox(group, { cx, cy: 0.3, cz, sx: 0.4, sy: 0.5, sz: 0.4, material: woodMat, name: `${id}_nightstand` });
  const fixtureMat = zoneMaterial('fixtures_whole-home');
  addCylinder(zoneGroups['fixtures_whole-home'], { cx, cy: 0.58, cz, r: 0.03, h: 0.16, material: fixtureMat, name: `${id}_lamp_base` });
  addCylinder(zoneGroups['fixtures_whole-home'], { cx, cy: 0.74, cz, r: 0.09, r2: 0.12, h: 0.16, material: fixtureMat, name: `${id}_lamp_shade` });
}

// Master bedroom: headboard against the west exterior wall (x = -8)
const masterBedFurniture = structureGroup('structure_furniture-master-bedroom');
addBed(masterBedFurniture, { id: 'master_bed', headboardX: -7.8, footX: -5.9, cz: 3, width: 1.7, comforterColor: 0x3b4a63, rugColor: 0xc9beae });
addNightstandLamp(masterBedFurniture, { id: 'master_nightstand_1', cx: -7.75, cz: 1.85 });
addNightstandLamp(masterBedFurniture, { id: 'master_nightstand_2', cx: -7.75, cz: 4.15 });
addBox(masterBedFurniture, { cx: -3.5, cy: 0.4, cz: 5.65, sx: 1.6, sy: 0.8, sz: 0.5, material: fixedMaterial('structure_dresser_mat', { color: 0x7a5b3f, roughness: 0.5, metalness: 0 }), name: 'master_dresser' });
addPlant(masterBedFurniture, { cx: -4.7, cy: 0, cz: 5.6, potR: 0.12, potH: 0.24, leafR: 0.22, idPrefix: 'master_bedroom_plant' });

// Bedroom 2: headboard against the east exterior wall (x = 8)
const bed2Furniture = structureGroup('structure_furniture-bedroom-2');
addBed(bed2Furniture, { id: 'bedroom2_bed', headboardX: 7.8, footX: 5.9, cz: 4.5, width: 1.6, comforterColor: 0x8a5a46, rugColor: 0xb6c0ad });
addNightstandLamp(bed2Furniture, { id: 'bedroom2_nightstand_1', cx: 7.75, cz: 3.35 });

// Great room: sofa + coffee table + TV facing the fireplace, plus a small dining set
const livingFurniture = structureGroup('structure_furniture-living');
const sofaMat = fixedMaterial('structure_sofa_mat', { color: 0x5c6672, roughness: 0.75, metalness: 0 });
const cushionMat = fixedMaterial('structure_cushion_mat', { color: 0x8a94a0, roughness: 0.8, metalness: 0 });
const rugLivingMat = fixedMaterial('structure_rug-living_mat', { color: 0xa79e8c, roughness: 0.9, metalness: 0 });
addBox(livingFurniture, { cx: -4, cy: 0.22, cz: -3, sx: 0.9, sy: 0.4, sz: 2.0, material: sofaMat, name: 'sofa_base' });
addBox(livingFurniture, { cx: -4.35, cy: 0.55, cz: -3, sx: 0.2, sy: 0.7, sz: 2.0, material: sofaMat, name: 'sofa_back' });
addBox(livingFurniture, { cx: -4, cy: 0.4, cz: -4.0, sx: 0.9, sy: 0.5, sz: 0.2, material: sofaMat, name: 'sofa_armrest_1' });
addBox(livingFurniture, { cx: -4, cy: 0.4, cz: -2.0, sx: 0.9, sy: 0.5, sz: 0.2, material: sofaMat, name: 'sofa_armrest_2' });
[-3.6, -3.0, -2.4].forEach((cz, i) => addBox(livingFurniture, { cx: -3.9, cy: 0.48, cz, sx: 0.7, sy: 0.18, sz: 0.55, material: cushionMat, name: `sofa_cushion_${i}` }));
addBox(livingFurniture, { cx: -5.3, cy: 0.22, cz: -3, sx: 0.8, sy: 0.4, sz: 0.5, material: woodMat, name: 'coffee_table' });
addBox(livingFurniture, { cx: -4.7, cy: 0.01, cz: -3, sx: 2.6, sy: 0.02, sz: 2.4, material: rugLivingMat, name: 'living_room_rug' });
addBox(livingFurniture, { cx: FOOTPRINT.minX + 0.08, cy: 2.35, cz: -3, sx: 0.06, sy: 0.65, sz: 1.2, material: fixedMaterial('structure_tv_mat', { color: 0x111114, roughness: 0.3, metalness: 0.4 }), name: 'tv' });

const diningWoodMat = fixedMaterial('structure_dining-wood_mat', { color: 0x6b4a35, roughness: 0.5, metalness: 0 });
addCylinder(livingFurniture, { cx: -1.5, cy: 0.75, cz: -5, r: 0.7, h: 0.06, material: diningWoodMat, name: 'dining_table_top' });
addCylinder(livingFurniture, { cx: -1.5, cy: 0.375, cz: -5, r: 0.08, h: 0.75, material: diningWoodMat, name: 'dining_table_leg' });
[
  { cx: -1.5, cz: -4.2, backDx: 0, backDz: 0.18 },
  { cx: -1.5, cz: -5.8, backDx: 0, backDz: -0.18 },
  { cx: -0.7, cz: -5, backDx: 0.18, backDz: 0 },
  { cx: -2.3, cz: -5, backDx: -0.18, backDz: 0 },
].forEach(({ cx, cz, backDx, backDz }, i) => {
  addBox(livingFurniture, { cx, cy: 0.45, cz, sx: 0.4, sy: 0.06, sz: 0.4, material: diningWoodMat, name: `dining_chair_seat_${i}` });
  const backSx = backDz !== 0 ? 0.4 : 0.06;
  const backSz = backDz !== 0 ? 0.06 : 0.4;
  addBox(livingFurniture, { cx: cx + backDx, cy: 0.75, cz: cz + backDz, sx: backSx, sy: 0.55, sz: backSz, material: diningWoodMat, name: `dining_chair_back_${i}` });
});

// Kitchen barstools at the island
const barstoolMat = fixedMaterial('structure_barstool_mat', { color: 0x2a2a2a, roughness: 0.4, metalness: 0.3 });
const barstoolGroup = structureGroup('structure_furniture-kitchen');
[3.3, 4.0, 4.7].forEach((cx, i) => {
  addCylinder(barstoolGroup, { cx, cy: 0.325, cz: -1.9, r: 0.025, h: 0.65, material: barstoolMat, name: `barstool_leg_${i}` });
  addCylinder(barstoolGroup, { cx, cy: 0.66, cz: -1.9, r: 0.18, h: 0.05, material: barstoolMat, name: `barstool_seat_${i}` });
});

// ---------------------------------------------------------------------------
// Baseboards (structure_) — thin trim along every interior floor/wall junction
// for a touch of realism, grouped per the spec's "what to model in detail" list.
// ---------------------------------------------------------------------------

const baseboardMat = fixedMaterial('structure_baseboard_mat', { color: 0xffffff, roughness: 0.5, metalness: 0 });
const baseboardGroup = structureGroup('structure_baseboards');
ROOMS.forEach((room) => {
  const { x0, x1, z0, z1 } = room.rect;
  addBox(baseboardGroup, { cx: (x0 + x1) / 2, cy: 0.06, cz: z0 + 0.01, sx: x1 - x0, sy: 0.12, sz: 0.02, material: baseboardMat, name: `${room.id}_baseboard_s` });
  addBox(baseboardGroup, { cx: (x0 + x1) / 2, cy: 0.06, cz: z1 - 0.01, sx: x1 - x0, sy: 0.12, sz: 0.02, material: baseboardMat, name: `${room.id}_baseboard_n` });
});

// ---------------------------------------------------------------------------
// Cleanup: remove any empty zone groups so downstream tooling only sees
// zones that actually exist in this particular model (still valid per spec —
// zones are looked up by name when present).
// ---------------------------------------------------------------------------

for (const [key, group] of Object.entries(zoneGroups)) {
  if (group.children.length === 0) {
    console.warn(`[generate] warning: zone "${key}" has no meshes`);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

let triCount = 0;
scene.traverse((obj) => {
  if (obj.isMesh) {
    const pos = obj.geometry.attributes.position;
    triCount += obj.geometry.index ? obj.geometry.index.count / 3 : pos.count / 3;
  }
});
console.log(`[generate] scene built: ${triCount} triangles`);

const exporter = new GLTFExporter();
exporter.parse(
  scene,
  (result) => {
    const buffer = Buffer.from(result);
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, buffer);
    console.log(`[generate] wrote ${OUT_PATH} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  },
  (err) => {
    console.error('[generate] export failed', err);
    process.exit(1);
  },
  { binary: true }
);
