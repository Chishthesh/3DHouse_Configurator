// Plain-data schematic floor plan for the sample "Horizon"-style single-story house.
// Shared by the GLB generator script (Node) and the app's camera presets (browser) —
// keep this file free of three.js / DOM imports so both sides can consume it.

export const FOOTPRINT = { minX: -8, maxX: 8, minZ: -6, maxZ: 6 };
export const WALL_HEIGHT = 2.7;
export const EXT_WALL_THICKNESS = 0.2;
export const INT_WALL_THICKNESS = 0.12;

// Non-overlapping rooms that exactly tile the footprint (16m x 12m = 192 sqm).
export const ROOMS = [
  { id: 'great_room', label: 'Great Room (Living + Dining)', floorZone: 'flooring_hardwood', rect: { x0: -8, x1: 0, z0: -6, z1: 0 } },
  { id: 'kitchen', label: 'Kitchen', floorZone: 'flooring_tile', rect: { x0: 0, x1: 8, z0: -6, z1: 0 } },
  { id: 'foyer', label: 'Foyer', floorZone: 'flooring_hardwood', rect: { x0: -2.5, x1: 2.5, z0: 4, z1: 6 } },
  { id: 'hallway', label: 'Hallway', floorZone: 'flooring_hardwood', rect: { x0: -2.5, x1: 2.5, z0: 0, z1: 4 } },
  { id: 'master_bedroom', label: 'Master Bedroom', floorZone: 'flooring_carpet', rect: { x0: -8, x1: -4.5, z0: 0, z1: 6 } },
  { id: 'master_bedroom_ext', label: 'Master Bedroom (closet nook)', floorZone: 'flooring_carpet', rect: { x0: -4.5, x1: -2.5, z0: 3, z1: 6 } },
  { id: 'master_bathroom', label: 'Master Bathroom', floorZone: 'flooring_tile', rect: { x0: -4.5, x1: -2.5, z0: 0, z1: 3 } },
  { id: 'bedroom_2', label: 'Bedroom 2', floorZone: 'flooring_carpet', rect: { x0: 2.5, x1: 8, z0: 3, z1: 6 } },
  { id: 'hall_bathroom', label: 'Hall Bathroom', floorZone: 'flooring_tile', rect: { x0: 2.5, x1: 5, z0: 0, z1: 3 } },
  { id: 'laundry', label: 'Laundry', floorZone: 'flooring_tile', rect: { x0: 5, x1: 8, z0: 0, z1: 3 } },
];

function center(rect) {
  return { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 };
}

export const ROOM_CENTERS = Object.fromEntries(ROOMS.map((r) => [r.id, center(r.rect)]));

// Interior partition walls, expressed as centerline segments with a door gap.
// axis 'x' => wall runs along X at fixed z; axis 'z' => wall runs along Z at fixed x.
export const INTERIOR_WALLS = [
  // Great room / kitchen divider (open concept — no wall, per "open concept, large island")
  // Great room+kitchen / foyer+hallway divider at z=0
  { axis: 'x', at: 0, from: -8, to: -2.5 },
  { axis: 'x', at: 0, from: 2.5, to: 8, doorGap: null },
  // Hallway side walls separating from master suite / secondary wing
  { axis: 'z', at: -2.5, from: 0, to: 4, doorGap: null },
  { axis: 'z', at: 2.5, from: 0, to: 3, doorGap: [1.1, 1.9] },
  { axis: 'z', at: 2.5, from: 3, to: 6, doorGap: [4.1, 4.9] },
  { axis: 'z', at: -2.5, from: 4, to: 6, doorGap: null },
  // Foyer / hallway divider
  { axis: 'x', at: 4, from: -2.5, to: 2.5, doorGap: null },
  // Master bathroom walls (inside master suite)
  { axis: 'z', at: -4.5, from: 0, to: 3, doorGap: [0.4, 1.2] },
  { axis: 'x', at: 3, from: -4.5, to: -2.5, doorGap: null },
  // Hall bathroom / laundry divider
  { axis: 'z', at: 5, from: 0, to: 3, doorGap: null },
  { axis: 'x', at: 3, from: 2.5, to: 5, doorGap: [3.1, 3.9] },
  { axis: 'x', at: 3, from: 5, to: 8, doorGap: [6.1, 6.9] },
];

// Doorway gaps on the front exterior wall (Z = maxZ, "south" / front of house).
export const FRONT_DOOR = { x0: -1, x1: 1, z: FOOTPRINT.maxZ };

// Simple window placements: {wall: 'north'|'south'|'east'|'west', from, to, sill, height}
export const WINDOWS = [
  { wall: 'south', from: -7, to: -5.5, sill: 0.9, height: 1.4 },
  { wall: 'south', from: 2, to: 3.5, sill: 0.9, height: 1.4 },
  { wall: 'south', from: 5, to: 6.5, sill: 0.9, height: 1.4 },
  { wall: 'west', from: -4, to: -2, sill: 0.9, height: 1.4 },
  { wall: 'west', from: 1, to: 3, sill: 0.9, height: 1.4 },
  { wall: 'north', from: -6, to: -3, sill: 0.6, height: 1.8 },
  { wall: 'north', from: 3, to: 6, sill: 1.1, height: 1.2 },
  { wall: 'east', from: -4, to: -1, sill: 0.9, height: 1.4 },
];
