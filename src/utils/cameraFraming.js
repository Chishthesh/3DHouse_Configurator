// Camera framing, computed from the loaded geometry only — no room names, no fixed
// coordinates, no assumption about the model's units, scale or origin.
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();

function isDescendantOf(object, ancestor) {
  let o = object;
  while (o) {
    if (o === ancestor) return true;
    o = o.parent;
  }
  return false;
}

/**
 * How far the camera can pull back along `dir` before it passes through geometry.
 *
 * This is what makes framing work in an architectural model: without it, a camera
 * placed at a "nice" distance from the floor of a room ends up outside the building,
 * looking at the back of a wall or down at the roof. Geometry belonging to the part
 * being framed is ignored, or the ray would stop on the part itself.
 */
function clearanceAlong(root, origin, dir, maxDistance, ignoreObject) {
  _ray.set(origin, dir);
  _ray.far = maxDistance;
  const hits = _ray.intersectObjects(root.children, true);
  for (const hit of hits) {
    if (hit.object.userData?.__configuratorHelper) continue;
    if (ignoreObject && isDescendantOf(hit.object, ignoreObject)) continue;
    return hit.distance;
  }
  return maxDistance;
}

/** The horizontal direction with the most space, sampled around a point. */
function widestDirection(root, origin, maxDistance) {
  let best = { dir: new THREE.Vector3(0.7, 0, 0.7).normalize(), clearance: -1 };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const clearance = clearanceAlong(root, origin, dir, maxDistance, null);
    if (clearance > best.clearance) best = { dir, clearance };
  }
  return best;
}

/**
 * Frame a bounding box.
 *
 * The viewing angle is chosen from the box's own proportions, because the same fixed
 * angle cannot suit every kind of part:
 *
 *   - a flat slab low in the model is a floor  -> look down at it
 *   - a flat slab high in the model is a ceiling -> look up at it
 *   - anything else -> a normal three-quarter view, flatter for large parts
 *
 * `towardCenter` (normally the whole model's centre) makes the shot face back into
 * the space rather than along a fixed compass direction, so a part flat against a
 * perimeter wall is viewed from the room side rather than through the wall.
 */
export function frameForBox(box, opts = {}) {
  const {
    root = null,
    ignoreObject = null,
    towardCenter = null,
    containBox = null,
    azimuth = 0.7,
    minFactor = 0.06,
    maxFactor = 4,
    minFloor = 0.15,
    enablePan = true,
  } = opts;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.2);

  // A part occupying most of the model (the floor plate, all the walls) needs a wide
  // shot, not the close walk-up framing that suits a tap or a cabinet door.
  let isLarge = false;
  if (containBox) {
    const wholeDiagonal = containBox.getSize(_v).length();
    if (wholeDiagonal > 1e-6 && size.length() / wholeDiagonal > 0.55) isLarge = true;
  }

  const horizontal = Math.max(size.x, size.z);
  const isFlat = horizontal > 1e-6 ? size.y / horizontal < 0.15 : false;
  let relativeHeight = 0.5;
  if (containBox) {
    const h = containBox.getSize(_v).y;
    if (h > 1e-6) relativeHeight = (center.y - containBox.min.y) / h;
  }

  let elevation;
  if (isFlat) elevation = relativeHeight > 0.7 ? -0.5 : 0.75; // ceiling vs. floor
  else elevation = isLarge ? 0.15 : 0.3;
  if (opts.elevation != null) elevation = opts.elevation;

  // A part that spans most of the model (the whole floor plate, every wall, the
  // ceiling) cannot be approached: there is no "outside" of it to stand in. Trying to
  // compute one lands the camera above the roof looking at the top of the ceiling, or
  // below the floor. The opening shot is already a measured, unobstructed view of the
  // whole space, so reuse that viewpoint and just re-aim it at the part — nudged
  // slightly closer so the move still reads as going somewhere.
  if (isLarge && opts.openingPosition) {
    const aim = isFlat ? center.clone() : new THREE.Vector3(center.x, box.min.y + size.y * 0.32, center.z);
    const from = new THREE.Vector3(...opts.openingPosition);
    const position = aim.clone().lerp(from, 0.86);
    const dist = position.distanceTo(aim) || radius;
    return {
      position: position.toArray(),
      target: aim.toArray(),
      minDistance: Math.max(radius * minFactor, minFloor),
      maxDistance: Math.max(radius * maxFactor, dist * 2.5),
      enablePan,
    };
  }

  // At a 45° field of view a part of radius r needs roughly 2.4r of distance to fit
  // in frame; anything much closer crops it.
  const distanceFactor = opts.distanceFactor ?? (isLarge ? 1.6 : 2.6);
  const desired = radius * distanceFactor;

  // Preferred horizontal heading: back toward the middle of the space, so a part
  // flat against a perimeter wall is viewed from the room side, not through the wall.
  const preferred = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
  if (towardCenter) {
    const outward = center.clone().sub(towardCenter);
    outward.y = 0;
    if (outward.lengthSq() > Math.max(1e-6, (radius * 0.05) ** 2)) preferred.copy(outward.normalize().negate());
  }

  // Candidate aim points, as fractions of the part's own height.
  //
  // A bounding-box centre is not always a point you can see. The island tap in the
  // sample kitchen runs from its spout down through the counter into the cabinet, so
  // its box centre sits *inside* solid joinery: aiming there and pulling the camera
  // back leaves it buried, whichever direction it retreats in. Aiming at the centre
  // of a whole wall assembly has the opposite problem — it points at mid-air well
  // above head height. So several aim points are tried and the first one with a
  // clear line of sight wins.
  let fractions;
  if (isFlat) fractions = [0.5];
  else if (isLarge) fractions = [0.32, 0.5, 0.2];
  else fractions = [0.5, 0.85, 0.95, 0.7, 0.3, 0.15];

  // Sample headings around an aim point and keep the one that both has room for the
  // camera and points as close as possible to the preferred heading.
  const evaluate = (aim) => {
    if (!root) {
      const dir = preferred.clone();
      dir.y = elevation;
      dir.normalize();
      return { dir, clearance: desired, open: true };
    }
    let bestOpen = null;
    let bestAny = null;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const horizontal = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = horizontal.clone();
      dir.y = elevation;
      dir.normalize();
      const clearance = clearanceAlong(root, aim, dir, desired, ignoreObject);
      const alignment = horizontal.dot(preferred);
      if (clearance >= desired - 1e-6 && (!bestOpen || alignment > bestOpen.alignment)) {
        bestOpen = { dir, clearance, alignment, open: true };
      }
      if (!bestAny || clearance > bestAny.clearance) bestAny = { dir, clearance, alignment, open: false };
    }
    return bestOpen ?? bestAny;
  };

  let target = null;
  let choice = null;
  for (const fraction of fractions) {
    const aim = new THREE.Vector3(center.x, box.min.y + size.y * fraction, center.z);
    const result = evaluate(aim);
    if (!choice || result.clearance > choice.clearance) {
      target = aim;
      choice = result;
    }
    if (result.open) {
      target = aim;
      choice = result;
      break;
    }
  }

  // Stop short of whatever blocks the view, but never closer than the part's own
  // extent, or the camera ends up inside the thing it is meant to be showing.
  const dist = Math.max(Math.min(desired, choice.clearance * 0.92), radius * 1.15);
  const position = target.clone().addScaledVector(choice.dir, dist);
  return {
    position: position.toArray(),
    target: target.toArray(),
    minDistance: Math.max(radius * minFactor, minFloor),
    maxDistance: Math.max(radius * maxFactor, dist * 2.5),
    enablePan,
  };
}

/**
 * The shot a file opens on.
 *
 * Two cases, decided by measurement rather than by guessing what the file "is":
 *
 *   open-sided  - at least one horizontal direction from inside the model leads out
 *                 into open space. That describes a room set, a kitchen with two
 *                 walls, or a standalone object: stand in the most open direction,
 *                 at roughly eye level, and look back across the model. A pulled-back
 *                 overhead shot of such a model shows the top of its ceiling.
 *   enclosed    - every direction is blocked, so the viewpoint is inside a solid
 *                 volume: that is a closed building, and it reads best from outside.
 */
export function frameOpeningShot(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty() || !Number.isFinite(box.min.x)) {
    box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.5);

  const eyeY = box.min.y + size.y * 0.32;
  const from = new THREE.Vector3(center.x, eyeY, center.z);
  const probeDistance = radius * 1.35;
  const widest = widestDirection(root, from, probeDistance);
  const openSided = widest.clearance >= probeDistance - 1e-6;

  const limits = {
    minDistance: Math.max(radius * 0.02, 0.05),
    maxDistance: radius * 8,
    enablePan: true,
  };

  if (!openSided) {
    // Closed volume: orbit it from outside, well clear of the shell.
    const dir = new THREE.Vector3(Math.sin(0.8), 0.42, Math.cos(0.8)).normalize();
    return {
      ...limits,
      position: center.clone().addScaledVector(dir, radius * 1.9).toArray(),
      target: center.toArray(),
      box,
      openSided,
    };
  }

  const target = new THREE.Vector3(center.x, box.min.y + size.y * 0.24, center.z);
  const dist = Math.max(widest.clearance * 0.85, radius * 0.25);
  const position = target.clone().addScaledVector(widest.dir, dist);
  position.y = target.y + dist * 0.2; // a shallow look-down, not a plan view
  return { ...limits, position: position.toArray(), target: target.toArray(), box, openSided };
}
