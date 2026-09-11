# 3D Configurator — how it works

Upload a `.glb`. The app reads the file itself — its node hierarchy, its sub-nodes, its
materials and its embedded textures — and builds the configurator from what it finds.
No naming convention is required and nothing about any particular model is hardcoded.

```bash
npm install
npm run dev
```

Then open the dev server and either upload a `.glb` or use one of the bundled models.

---

## The flow

1. **Load a model.** Drag a `.glb` onto the upload card, or pick *Modern kitchen
   (client model)* / *Sample house*. Progress is shown while it downloads and parses.
2. **Browse what is in the file.** The left sidebar lists every node and sub-node,
   with a search box (matches part names *and* material names) and two filters. The
   *Materials & Textures* tab is the full inventory: every material with its PBR
   values and the parts using it, plus previews of the textures embedded in the file.
3. **Select a part.** Click it in the 3D view or in the tree. The camera flies to it
   and an animated box marks it. Any mouse input cancels the flight, so the camera
   never fights you. `O` returns to the overview, `Esc` clears the selection.
4. **Change its colour or material.** The right panel shows the finishes that apply to
   that part, a free colour picker, and the option to copy any material the `.glb`
   already contains onto the part. Upload the finish schedule with **Upload
   schedule…** in the top bar, the button in the sidebar's *Material schedule*
   section, or by dropping the file on the 3D view.
5. **Save.** *Save changes* stores a snapshot **plus the configuration behind it**.
   Saving under a name you have used before adds a version alongside the previous one.
6. **Review.** The *Saved Captures* tab shows every saved image, what was applied,
   the running total, and can re-apply a saved configuration to the loaded model or
   download the PNG.

---

## The material schedule

Catalogued finishes — colours, textures, human-readable part names, and codes and
prices where the document has them — come from a schedule you upload. **Excel
(`.xlsx`) is the expected format**; CSV and JSON are also accepted. Three bundled
samples target `modern_kitchen.glb`:

| File | What it shows |
| --- | --- |
| `public/material-libraries/configurator-parameters.xlsx` | The client format: one row per part, 42 parts, 187 options |
| `public/material-libraries/modern-kitchen-schedule.json` | The richest form: codes, prices, tiling, roughness/metalness |
| `public/material-libraries/modern-kitchen-schedule.csv` | The flat form, one option per row |

All three feed the same validation and matching code, so a part behaves identically
whichever format described it.

### Excel format (`.xlsx`)

One row per part. Column headings are matched case-insensitively and several aliases
are accepted, so `Node`, `Node Name` or `Mesh` all work in place of `Unique Name`:

| Unique Name | Display Name | Colours | Textures |
| --- | --- | --- | --- |
| `kitchen_floor` | Floor | | `countertops_marble.jpg, flooring_tile.jpg, mosaico.jpg` |
| `kitchen_walls` | Walls | `#F4F1EC, #BCA88F, #A8B39C, #2E3440, #B4694E` | |
| `island_counter` | Island — Countertop | `#E8DFC8, #1B1B1E, #9C9A95` | `countertops_marble.jpg, cabinets_wood.jpg` |
| `Cube.003` | Refrigerator | `#4A4D50, #17181A` | `appliance_polished_metal.jpg` |

- **Unique Name** — the node name in the `.glb`. Required.
- **Display Name** — what the part is called in the UI. Optional; without it the tree
  shows the raw name (`Cube003`).
- **Colours** — a list of hex codes. Commas, semicolons and line breaks inside the
  cell all separate entries. Each becomes a solid-colour option.
- **Textures** — a list of image filenames. A bare filename resolves against
  `/textures/`, so `mosaico.jpg` means `public/textures/mosaico.jpg`; a value
  containing `/` is used as given, which allows an absolute URL.
- **Tiling** *(optional)* — `2x2` or `4`, applied to that row's textures. Without it a
  texture maps once across the surface.

Each row yields up to two option groups, "Colours" and "Textures", mirroring the two
columns. There is no place for prices or codes in this layout, so options from a
workbook carry none — and the UI shows no price rather than implying "Included".

**Multiple worksheets.** Every sheet is read. The one with the most usable rows becomes
active, and a **Worksheet** dropdown appears so you can switch — a real workbook often
keeps a draft sheet beside the final one (the bundled sample has exactly that: Sheet1
with 3 parts, Sheet2 with 42), and silently picking the wrong one would be worse than
saying which was chosen.

**Textures are checked on load.** Every image the schedule names is probed once, and
any that are missing from `public/textures/` are reported immediately instead of
failing later when someone clicks the option.

`.xls` (the old binary format) is rejected with a message asking for `.xlsx`. Reading
needs no third-party library — an `.xlsx` is a ZIP of XML, and the browser inflates it
natively.

### JSON format

Use this when a schedule needs codes, prices, per-option tiling or PBR values — none
of which the workbook layout has room for.

```jsonc
{
  "name": "Modern Kitchen — Material & Colour Schedule",
  "version": "1.0",

  // Optional: human names for parts the file calls "Cube.003".
  "nodeLabels": { "Cube.003": "Refrigerator", "kitchen_floor": "Floor" },

  "groups": [
    {
      "id": "CT",
      "label": "Countertops",
      "category": "Stone & Surfaces",
      "description": "Shown under the group heading.",

      // Where this group applies. Node names win; material names are the fallback
      // that makes a schedule work against a file whose nodes are auto-named.
      "match": {
        "nodes": ["island_counter", "main_counter", "upper_cabinets*"],
        "materials": ["marble slab"],
        "excludeNodes": ["main_counter_backsplash"]
      },

      "options": [
        {
          "code": "CT-01",                 // colour / material code
          "name": "Carrara Marble",
          "finish": "Polished",            // free text, shown under the name
          "color": "#EDEAE4",              // hex; omit if the option is texture-only
          "texture": "/textures/countertops_marble.jpg",
          "textureRepeat": [2, 2],         // tiling; also accepts "2x2"
          "keepTexture": false,            // see below
          "roughness": 0.22,
          "metalness": 0,
          "opacity": 1,                    // < 1 makes the surface transparent
          "price": 0,
          "default": true,
          "notes": "Shown in italics under the option."
        }
      ]
    }
  ]
}
```

### CSV format

One option per row, grouped by the `group` column. Multiple node or material targets
go in one cell separated by `;`. Column names are matched case-insensitively and
several aliases are accepted (`colour`/`hex`/`color_code`, `option`/`name`,
`metallic`/`metalness`, `tiling`/`repeat`, …).

```csv
group,category,nodes,materials,code,option,color,roughness,metalness,texture,repeat,price,default
Countertops,Stone,island_counter;main_counter,,CT-01,Carrara Marble,,0.22,0,/textures/countertops_marble.jpg,2x2,0,true
Countertops,Stone,island_counter;main_counter,,CT-03,Midnight Black Granite,#1B1B1E,0.24,0,,,3100,false
```

### Matching rules

Selecting a part collects every group that applies to it, best match first:

| Priority | Matched because | Shown as |
| --- | --- | --- |
| Highest | The part's own name is in `match.nodes` | *matches this part's name* |
| Middle | An **ancestor**'s name is in `match.nodes` | *inherited from "…"* |
| Lowest | The part uses a material named in `match.materials` | *applies to material "…"* |

Name comparison ignores case, spaces, dots, dashes and underscores, and `*` is a
wildcard. This matters: Blender writes `Cube.003`, the glTF loader sanitises it to
`Cube003`, and a schedule written against either — or typed as `cube 003` — matches.

### `keepTexture`

An option with no `texture` is a solid finish, so any texture already on the surface is
removed; otherwise "Matte Charcoal Paint" over a wood-grain cabinet would come out as
dark wood. Set `keepTexture: true` for options that mean "recolour the existing grain"
(the sample schedule's *Stained Walnut* does exactly that).

### Validation

A schedule is never trusted blindly. Bad rows are reported individually and the
salvageable groups still load, so one typo does not cost you the whole document.
Alongside that, the sidebar reports how well the schedule fits the model that is
actually loaded: groups matched, parts covered, which groups matched **nothing** (and
the patterns they looked for), and a clickable list of parts with no catalogued finish.
A schedule that silently matches nothing is the most likely real-world failure, and it
looks like a broken app rather than a wrong document unless the app says so.

---

## Design notes

**Material isolation.** In a real export one material is shared by many parts: in the
sample kitchen `marble slab` is on the floor *and* both counters, and `cabinets wood`
is on the island, lower and upper cabinets. Editing materials in place would mean
recolouring the floor silently recolours the counters. So the first time a part is
edited its materials are cloned and the originals kept for *Reset*.

**Scope.** Sub-nodes are real parts, so "change this part" is ambiguous. The default,
*This part*, covers the part's own geometry plus any sub-parts that have no finishes of
their own — choosing a stone for the island countertop does not repaint the island
cabinets or the tap, but it does cover anonymous sub-geometry nothing else can reach.
*+ all sub-parts* is the deliberate override, and the panel says how many surfaces each
choice touches. A sub-part counts as separately configurable only when the schedule
targets it by its own **name**; matching merely through a shared material is not
enough, or a part's own primitive meshes would count as independent and the default
scope would apply to nothing.

**Camera framing** is measured, not guessed. Rays test how far the camera can retreat
before passing through geometry, which is what keeps it inside a room instead of
outside looking at the back of a wall. A bounding-box centre is not always visible —
the island tap runs from its spout down through the counter into the cabinet, so its
box centre is inside solid joinery — so several aim points up the part's height are
tried and the first with a clear line of sight wins. Flat parts get an angle from their
position: low slab = floor, look down; high slab = ceiling, look up. A part spanning
most of the model has no "outside" to stand in, so it reuses the opening viewpoint,
re-aimed. The opening shot itself is chosen by measurement: if any horizontal direction
from inside the model leads to open space the file is a room or an object and is shot
from that open side at eye level; if every direction is blocked the viewpoint is inside
a closed building, which reads best from outside.

**Emissive surfaces.** A light strip ships with a black base colour and a coloured
emissive, so tinting `.color` would do nothing visible. Those materials are recoloured
through `.emissive` instead — which is why *Lighting Colour* actually changes the light.

**Legacy support.** The earlier `{category}_{zone}` convention (`cabinets_kitchen`,
`flooring_hardwood`) still works: its catalogue ships as a built-in schedule that is
applied automatically when a loaded model matches it. That is why *Sample house* gets
14 groups and 54 options with nothing to upload.

---

## Layout of the code

| Path | Role |
| --- | --- |
| `src/utils/nodeGraph.js` | Flattens the loaded scene into an addressable node graph; material/texture inventory; scope resolution |
| `src/utils/readWorkbook.js` | Dependency-free `.xlsx` reader (ZIP + worksheet XML) |
| `src/utils/materialLibrary.js` | Schedule parsing (Excel + CSV + JSON), validation, node matching, coverage analysis |
| `src/utils/materialApply.js` | Applying finishes with per-part material isolation |
| `src/utils/cameraFraming.js` | Occlusion-aware camera framing |
| `src/utils/captureStore.js` | IndexedDB store for saved captures and their configurations |
| `src/components/SceneViewer.jsx` | Canvas, lighting, animated fly-to, selection marker, picking |
| `src/components/NodeTree.jsx` | Model contents browser |
| `src/components/FinishPanel.jsx` | Finishes for the selected part |
| `src/components/LibraryPanel.jsx` | Schedule loading, validation report, coverage |
| `src/components/InspectorPanel.jsx` | Materials & textures inventory |
| `src/components/SavedCaptures.jsx` | Saved images and re-apply |
| `src/data/zoneSpec.js`, `src/data/builtinLibrary.js` | The legacy zone catalogue, as a built-in schedule |
| `src/scripts/generateHouseModel.mjs` | Generates `public/models/sample-house.glb` (`npm run generate:model`) |

In development, `window.__configuratorScene` and `window.__three` are exposed for
poking at the live scene from the console. Both are stripped from production builds.

---

## Known limits

- `.gltf` uploads are rejected with an explanation: a `.gltf` keeps its buffers and
  images in sibling files that a browser file picker cannot reach, so it would load as
  an empty scene. Export `.glb`.
- Saved Captures live in this browser's IndexedDB. They are per-browser and per-profile,
  and private windows or blocked site data prevent saving; the tab says so rather than
  failing silently.
- Textures referenced by a schedule are fetched by URL, so they must be served by the
  app (`public/textures/…`) or come from a reachable origin.
- Prices are a running total of the applied options, and only appear when the schedule
  actually carries prices. There is no quantity or area take-off — a finish costs what
  the schedule says regardless of how much of it is used.
- A workbook's texture cells name files but cannot carry them. The images must be in
  `public/textures/`; the app reports any it cannot find when the schedule loads.
