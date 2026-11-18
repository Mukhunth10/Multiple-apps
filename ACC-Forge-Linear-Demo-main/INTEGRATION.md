# Integrating ACC-Forge-Linear-Demo into an existing app

Instructions for an agent (or developer) adding this feature to a React web app that
already loads 2D sheets in the APS Viewer and already has its own storage. It covers
only what this demo contains.

## 1. What the feature is

- Draw a polyline measurement on a 2D sheet, styled with subject, thickness and colour.
- The sheet's scale is read automatically (Auto) or calibrated by hand (Manual).
- Each run is a trackable linear asset, optionally cut into fixed-length pieces.
- Each asset moves through a status ladder; percent complete is derived from it.
- A run can be edited afterwards: move ends and elbows, delete elbows, continue from an end.

Nothing is persisted. State goes in as props, and every change comes out through a callback.

## 2. Prerequisites in the host app

- React 19 and TypeScript.
- The APS Viewer SDK 7.x loaded as a global script (the globals `Autodesk` and `THREE`).
- A viewer instance with a 2D sheet loaded through `loadDocumentNode`.
- `lucide-react` (icons, used by `ui/` only).

The feature loads the `Autodesk.Edit2D` extension itself. It does not load or need
`Autodesk.Measure`.

## 3. What to copy

| Folder / file | Copy? | Depends on |
|---|---|---|
| `src/divide/` | yes | nothing |
| `src/measure/` | yes | nothing |
| `src/tracking/` | yes | `divide`, `measure` |
| `src/viewer/edit2d-surface.ts`, `sheet-scale.ts`, `gaps.ts`, `aps-globals.d.ts`, `index.ts` | yes | nothing |
| `src/viewer/load.ts` | no: demo only (CDN script, token callback, sheet list). The host keeps its own | |
| `src/ui/TrackingWorkspace.tsx`, `MeasurePanel.tsx`, `AssetsPanel.tsx`, `DivideOptionsPanel.tsx` | yes, unless you build your own UI on the surface API (section 7) | all of the above |
| `src/ui/styles.css` | the `.mt-*` rules only. The `.app-*` rules and `:root` variables belong to the demo shell; restyle with your theme | |
| `src/ui/App.tsx`, `src/main.tsx` | no: the demo host | |
| `src/index.ts` | yes: the public entry point | |

`aps-globals.d.ts` declares `Autodesk` and `THREE` loosely. If the host already uses
`@types/forge-viewer`, delete it.

## 4. Wiring steps

### 4.1 Attach the surface after a sheet loads

```ts
import { attachEdit2D, type MeasureSurface } from './measure-tracking';

let surface: MeasureSurface | null = null;

async function onSheetLoaded(viewer: any /* your GuiViewer3D */) {
  surface?.dispose();                  // one surface per loaded sheet
  surface = await attachEdit2D(viewer);
}
```

Call it after `loadDocumentNode` resolves AND the geometry is loaded (`model.isLoadDone()`
or `GEOMETRY_LOADED_EVENT`). The surface reads the sheet's viewports and paper size on
attach, so attaching too early gives a sheet with no scale. On every sheet switch:
`dispose()`, load the new sheet, attach again.

### 4.2 Identify the sheet

Assets are anchored to `(sheet, page)`. The demo uses the viewable node:

```ts
const sheet = node.guid();
const page = Number(node.data?.page) || 1;
```

Use the same identity everywhere you store measurements and assets.

### 4.3 Render the workspace

```tsx
<TrackingWorkspace
  surface={surface}
  sheet={sheet}
  page={page}
  measurements={measurements}   // ALL runs the assets refer to, every sheet
  scales={scales}               // SheetScale[]: the scale choice per sheet
  assets={assets}               // Asset[]
  options={options}             // DivideOptions, start from DEFAULT_OPTIONS
  onMeasurementCreated={(m) => save(m)}
  onMeasurementChanged={(m) => replaceById(m)}
  onMeasurementDeleted={(id) => removeById(id)}
  onScaleChanged={(s) => upsertBy(['sheet', 'page'], s)}
  onAssetChanged={(a) => upsertBy(['key'], a)}
  onOptionsChanged={(o) => saveOptions(o)}
/>
```

Rules for the callbacks:

- **`onAssetChanged` fires in bursts.** The workspace reconciles assets whenever
  measurements, scales or options change, and emits one call per new or changed asset.
  Upsert by `asset.key`. Use functional state updates (`setAssets(as => ...)`), because
  several calls arrive in the same tick.
- **Pass every measurement, not only the current sheet's.** An asset whose measurement is
  missing from `measurements` becomes unplaced. The workspace filters to the current
  sheet itself.
- **`onMeasurementChanged` fires repeatedly during an edit:** after every vertex move,
  delete or continuation, and once more when editing ends. Replace by `id`.
- **Deleting a run** (`onMeasurementDeleted`) never deletes its assets; they become unplaced.

## 5. What to store

All types are exported from `src/index.ts`.

| Type | Key | Fields |
|---|---|---|
| `Measurement` | `id` | `sheet`, `page`, `number` (run number per sheet), `subject`, `thickness` (points on paper), `color` (hex), `points` (raw clicked points, sheet units), `viewportScale` (or null) |
| `SheetScale` | `(sheet, page)` | `mode` (`'auto'` or `'manual'`), `manual` (`{ unit, unitsPerSheetUnit }` or null) |
| `Asset` | `key` | `sheet`, `page`, `measurementId`, `occurrenceKey`, `pieceIndex`, `stage`, `placed`, `fromM`, `toM` |
| `DivideOptions` | one per project | `divisionSize` (null = undivided), `divisionUnit`, `ladder` (`{ name, color }[]`), `gapWidth` (points) |

Store `viewportScale` on the measurement as given: it is the scale captured when the run
was drawn, so other sheets never need their viewports loaded.

## 6. Rules the code relies on (do not change them)

- **Length comes from the raw clicked points**, times the run's scale. Never store a
  derived length.
- **Scale resolution** (`resolveScale`): in Auto, a run uses its own `viewportScale`; if it
  has none, the sheet's manual calibration. In Manual, always the manual calibration. No
  scale means the run cannot be divided and the UI shows "no scale".
- **Asset identity** is `(sheet, page, measurementId, occurrenceKey)`, and `asset.key` is
  built from it (`assetKey`). Never key anything by an Edit2D shape id: those are
  re-created on every redraw.
- **Occurrence keys:** `run` for an undivided run, `run:0`, `run:1`, ... for pieces, by
  index along the run.
- **Re-division** (changing the division size) keeps the index keys, so `run:0` covers a
  new span, surplus indices become unplaced, and missing ones are created.
  `planRedivide` returns those counts for the confirmation dialog; with
  `carryProgress`, new and re-cut pieces take the stage of the old piece they overlap most.
- **Unplaced assets are never deleted.** The Assets panel hides unplaced assets with no
  progress; they stay in the data.
- **Percent complete is derived** from the stage's position in the ladder
  (`percentComplete`), never stored. `stage` is `-1` for not started.
- **Remainder rule:** a leftover shorter than half the division size joins the last piece
  (31 m at 3 m is ten pieces with a 4 m tail). A piece spanning a corner keeps the corner.
  Pieces always add up to the run.
- **Run naming:** a run's assets are grouped under `Run <number>: <subject>`. A piece shows
  only its own index (`#1`, `#2`, ...).
- **Thickness and gap are in points on the paper**, so both zoom with the drawing. The gap
  is display only and never affects keys or lengths.

## 7. The surface API (if you build your own UI)

`attachEdit2D(viewer)` returns a `MeasureSurface`:

| Method | What it does |
|---|---|
| `beginDraw(style, { onDrawn, onExit })` | Draw mode. Stays on for any number of runs. `onDrawn({ points, viewportScale })` per finished run |
| `setDrawStyle(style)` / `endDraw()` / `isDrawing()` | |
| `beginEdit(points, style, { onChange, onExit })` | Edit one run. `onChange(points)` on every change |
| `endEdit()` | Finishes the edit; emits the final points |
| `viewportScales()` | The sheet's viewports that publish a scale (empty for a plain PDF) |
| `setShapes(shapes)` | Replace everything drawn. One `SurfaceShape` per placed asset, `id` = asset key |
| `setSelection(ids)` / `onSelectionChanged(cb)` | Selection, by your ids |
| `locate(ids)` | Zoom to those shapes |
| `dispose()` | Detach; call before loading another sheet |

Pure helpers to build shapes and tracking state: `runPieces`, `reconcile`, `planRedivide`,
`groupAssets`, `assetKey`, `createMeasurement`, `calibrate`, `resolveScale`,
`measuredLength`, `formatLength`.

## 8. Viewer behaviour the surface handles (keep these when porting)

Each was found on a real sheet; removing one brings its bug back.

- **Drawing finishes only on double-click or Enter.** Edit2D also finishes on the `C` key
  and on a click on the start vertex; both are switched off.
- **No Edit2D tool is active outside draw or edit mode**, so the cursor and clicks
  stay the viewer's own.
- **Colours are squared before they reach Edit2D.** Edit2D displays each channel as its
  square root (`#e5484d` would render as `#f2878c`).
- **Flat line ends** (`lineCap = 'butt'`), so a cut between pieces reads as a clean gap.
- **Hover and selection tint** follow the viewer's own 2D shader maths: selection blends
  toward the viewer's 2D selection colour (read from `viewer.impl.matman()`, so
  `set2dSelectionColor` applies), hover blends 25% toward yellow. Edit2D also draws a
  highlighted line 1.5 times thicker. `viewer.impl.matman()` is an internal API.
- **Auto scale** reads `model.getData().viewports` and converts with
  `model.pageToModel(p1, p2, viewportId)`, as `Autodesk.Measure` does. Revit sheets
  often load as vector PDFs and still carry viewports; viewport 0 is the paper and is
  skipped. A run takes the viewport its first snapped click lands in; a sheet with one
  scaled viewport needs no snap.
- **Paper units** come from `page_dimensions` (a PDF's world space is the page; an F2D
  sheet's is `logical_width` across `page_width`).
- **Edit mode uses Edit2D's own vertex tool**, restricted so only ends and elbows move:
  - Presses go only to its vertex dragger; segment handles are disabled
    (`edgeMoveTool.setAllGizmosEnabled(false)`).
  - The move cursor shows only over a vertex.
  - The tool is activated BEFORE the run is selected, or it builds no vertex handles.
  - Delete and Backspace are always consumed, or Edit2D's own shortcut deletes the whole run.
  - A run keeps at least two points.
- **Continuing a run:** double-clicking an end hands the run to Edit2D's polyline tool with
  its points pre-loaded. The switch back to edit mode is deferred until Edit2D's
  `POLYGON_ADDED` handler has returned.

## 9. Known limits

- On a sheet with several scaled viewports, a run whose clicks never snap to drawing
  geometry gets no viewport scale ("no scale"). Use Manual, or redraw snapping one point.
- Marquee selection is Shift+drag; Ctrl+click adds to the selection.
- Hover and selection highlighting work on the feature's own shapes (Edit2D). The
  viewer's built-in `viewer.select` and hover apply only to the sheet's own elements.

## 10. Console markers

| Marker | Tells you |
|---|---|
| `[Scale] N viewports, M with a scale` | What Auto found on attach |
| `[Scale] run drawn {snappedViewport, used}` | Which viewport a new run took its scale from |
| `[Paper] ...` | Paper size and sheet units per paper mm |
| `[Draw] on / off` | Draw mode changes and the active tool |
| `[Edit] continuing run` / `[Edit] run continued` | A continuation started / finished |
