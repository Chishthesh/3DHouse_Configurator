# 3D House Configurator — Demo Notes

## 1. What it is
An interactive web app where a buyer uploads a `.glb` 3D house model, walks through it in the browser, customizes materials/colors room-by-room, and saves before/after snapshots for comparison — matching the "3D Model Specification for Home Configurator" naming convention.

## 2. Application Flow (what to click through in the demo)
1. **Upload** — Choose a `.glb` file, or click "Use sample house" to load the bundled demo model.
2. **Explore the house** — Orbit/zoom with the mouse; click room pills (Exterior, Kitchen, Living Room, Master Bedroom, Master Bathroom) to fly the camera to that room. Navigation is bounded per room so you can look around fully without drifting into the next room.
3. **Customize** — The right-hand panel automatically shows only the categories/zones relevant to the room you're standing in (e.g., Bedroom shows Flooring/Paint/Fixtures only — no Cabinets or Appliances). Pick a swatch and the material updates live on the 3D model, with price deltas shown.
4. **Click-to-select** — You can also click directly on any part of the house (a wall, a cabinet, a floor) and the panel jumps to that exact zone.
5. **Capture** — Click "Capture" to save the current view as a PNG, automatically tagged with the room + zone (e.g. `kitchen_floor`).
6. **Saved Captures** — Switch tabs to see all saved snapshots grouped together. Opening a capture restores that exact camera angle and material, lets you tweak the color again, and saves it as the next version (`kitchen_floor_1`, `kitchen_floor_2`...) shown side-by-side with the original for comparison.

## 3. Tech Stack
- **React 18** — UI shell, state management (upload, selections, tabs).
- **Three.js + React Three Fiber (`@react-three/fiber`)** — 3D rendering engine and React bindings.
- **@react-three/drei** — helper utilities (GLTF loading, OrbitControls).
- **Vite** — dev server and build tooling.
- **IndexedDB** (via a small custom store) — persists Saved Captures (images + metadata) in the browser, no backend required.
- **Node.js scripts** — generate the sample `.glb` model procedurally for the demo (see below).

## 4. How the Sample 3D Model Is Generated
- A Node script (`generateHouseModel.mjs`) builds the entire demo house procedurally using Three.js primitives (boxes, cylinders) — walls, floors, cabinets, fixtures, furniture, bathroom fittings, etc.
- Every configurable surface is placed inside a **named group node** following the spec's `{category}_{zone}` convention (e.g. `flooring_hardwood`, `cabinets_kitchen`, `wall-tiles_bathroom`). Non-configurable parts (roof, windows, structure) use the `structure_` prefix.
- **Procedural textures** (wood grain, tile+grout, stone speckle, brushed metal, siding lines) are generated as raw pixel data and encoded into real PNGs using a hand-built PNG encoder (Node has no canvas library available), then embedded directly into the exported `.glb` — the same file format a real 3D modeler would deliver.
- The whole scene is exported to a single binary `.glb` file via Three.js's `GLTFExporter`.

## 5. How the Uploaded `.glb` File Is Read
1. The chosen file never leaves the browser — it's wrapped in a local blob URL (`URL.createObjectURL`), so there's no server upload step at all.
2. That URL is handed to Three.js's `GLTFLoader` (via the `useGLTF` hook), which parses the binary `.glb` and rebuilds it into a normal Three.js scene graph (groups, meshes, materials) in memory.
3. Once parsed, the app walks the entire node tree once (`scene.traverse(...)`) to switch on shadows for every mesh — this is also the hook point where the whole model becomes clickable.

## 6. How "Kitchen", "Bedroom", etc. Are Extracted
Two different mechanisms are at play, and it's worth being upfront about the difference in a demo:

- **Material zones (Flooring, Cabinets, Wall Tiles, etc.) — genuinely extracted from the file, works on any compliant model.** The app never "knows" what a kitchen looks like; it only looks at **node names**. When you click a surface, or when a swatch is applied, the code walks up from that mesh through its parent nodes looking for one whose name matches the `{category}_{zone}` pattern (e.g. `cabinets_kitchen`, `flooring_tile`) — see `findZoneForObject` / `collectZoneMeshes` in `zoneResolve.js`. Whichever meshes sit under that named group get recolored together. This is exactly the mesh-naming contract from the spec document, so it works for *any* uploaded `.glb` that follows the convention, not just the bundled sample.
- **Room camera views (the Kitchen/Living Room/Bedroom/Bathroom pills) — preset, not extracted.** These fly the camera to fixed X/Y/Z coordinates and zoom/pan limits defined per room in `zoneSpec.js` (`CAMERA_PRESETS`), tuned specifically to where those rooms sit in the bundled sample house's layout. The app does not currently infer room boundaries or a "this is the kitchen" location from an arbitrary uploaded model — that's a reasonable next step (e.g. reading a `rooms.json` sidecar, or naming convention for room anchor points) but out of scope for this demo.

**Is there a "Room" term, like Category/Zone?** Yes, but it's not part of the required `.glb` naming convention the way Category/Zone are:

| | Term used | Lives in | Required by spec? |
|---|---|---|---|
| UI room pills | `Room` / `roomKey` (`exterior`, `kitchen`, `living`, `master_bedroom`, `master_bathroom`) | `CAMERA_PRESETS` in `zoneSpec.js` | No — hand-authored camera coordinates, app-side only |
| Generator's internal layout | `Room` (`ROOMS[].id` — a longer list: `kitchen`, `great_room`, `foyer`, `hallway`, `master_bedroom`, `bedroom_2`, `hall_bathroom`, `laundry`...) | `houseLayout.js`, Node-only script | No — just used to decide where to place geometry |
| Trace left in the `.glb` | Mesh name only, e.g. a mesh literally called `kitchen_floor` | Inside the `flooring_tile` group node | No — mesh names are cosmetic; the app ignores them (only the ancestor **group node** name is read) |

So "Room" is a real, consistently-used term in the code, but — unlike Category/Zone, which are a hard contract via the group-node name — a room has no formal, required identity inside the `.glb` file itself, and the two room lists above (UI's 5 vs. the generator's 10) aren't even kept in sync with each other today.

## 7. The Full Hierarchy: Category → Zone → Group Node → Mesh → Material/Options
This is the core data model that connects the UI to the `.glb` file. Two things live in **two different places**, and the naming convention is what ties them together:

- **Category, Zone label, room list, and color options** — plain JavaScript config in `zoneSpec.js`. This never touches the `.glb` file; it's the app's own "menu" of what can be sold.
- **Group Node and Mesh** — actual nodes inside the `.glb` scene graph, placed there by whoever modeled the house (our generator script, or a real 3D artist following the spec).

The **zone key is the exact string that appears in both places** — that's the entire connection:

```
CATEGORY  (UI tab, e.g. "Cabinets")
   │  zoneSpec.js: { key: 'cabinets', label: 'Cabinets' }
   │
   ▼
ZONE  (UI sub-selection, e.g. "Kitchen Cabinets")
   │  zoneSpec.js: cabinets_kitchen: { category: 'cabinets', label: 'Kitchen Cabinets',
   │                                    rooms: [...], default: {...}, options: [...] }
   │
   │  ── the key "cabinets_kitchen" is also the required GROUP NODE NAME ──
   ▼
GROUP NODE  (inside the .glb scene graph, exact name match, case-sensitive)
   │  <Group name="cabinets_kitchen">
   │
   ▼
MESHES  (any number of children, their own names don't matter)
   ├── Mesh "lower_cabinets"    → material
   ├── Mesh "upper_cabinets"    → material
   └── Mesh "island_cabinets"   → material
```

| Term | Where it lives | Example | Purpose |
|---|---|---|---|
| **Category** | `zoneSpec.js` → `CATEGORIES[]` | `cabinets` | Top-level tab in the side panel (Flooring, Cabinets, Paint...). Purely a UI grouping. |
| **Zone** | `zoneSpec.js` → `ZONES{}` key | `cabinets_kitchen` | One configurable "thing" a buyer can change. Belongs to exactly one category. Carries its `label`, which `rooms` it applies to, its `default` material, and its list of `options` (name/color/roughness/metalness/price). |
| **Group Node** | Inside the `.glb` scene graph | `Group` named `"cabinets_kitchen"` | The physical anchor. Its name must exactly equal a zone key. This is the *only* link between the config (JS) and the model (glb) — there's no ID, no metadata field, just a matching string. |
| **Mesh** | Children of a group node, inside the `.glb` | `lower_cabinets`, `upper_cabinets` | The actual geometry + material being rendered. Mesh names are free-form and ignored — only their **ancestor group's name** matters (`findZoneForObject` walks up the parent chain until it finds a name that matches a zone key). |
| **Material/Options** | Split across both: base material lives on the mesh in the `.glb`; the selectable **options** (swatches, prices) live in `zoneSpec.js` | mesh's `MeshStandardMaterial.color/roughness/metalness` | When a buyer picks an option, the app finds every mesh under the matching group node and mutates its material's `color`/`roughness`/`metalness` in place — it never swaps geometry or replaces the mesh, just repaints it. |
| **`structure_` prefix** | Group node name in the `.glb` | `structure_roof`, `structure_windows` | Explicitly **not** a zone — excluded from the category/zone lookup entirely, so these render with whatever material they shipped with and are never selectable. |

**In one sentence:** the category/zone/options are a menu defined in code, the group-node/mesh are geometry defined in the file, and a single matching name string is the only thing wiring a menu item to the 3D geometry it should repaint.

## 8. How "Capture" Images Are Generated (in the app)
1. When you click **Capture**, the app reads the live WebGL canvas pixel buffer and converts it directly to a PNG (`canvas.toDataURL('image/png')`) — a true screenshot of exactly what's on screen, materials and all.
2. The image is tagged with: room name, zone/category, the selected material, and the camera position (so it can be reopened later at the exact same angle).
3. It's stored in the browser's IndexedDB alongside a version number, so repeated edits to the same zone/room stack up as `name`, `name_1`, `name_2`... for direct before/after comparison in the Saved Captures gallery.

## 9. Mirror Reflection (bonus realism detail)
Bathroom mirrors use a **live camera trick** (`THREE.CubeCamera`) — a tiny virtual camera sits at the mirror and continuously re-renders the surrounding room onto the mirror's surface, so it reflects the real room in real time instead of just showing a flat gray/tinted material.
