# ACC-Forge-Linear-Demo

Draw polyline measurements on a 2D sheet in the APS Viewer, turn each into a
trackable linear asset (optionally cut into fixed-length pieces), and move those
assets through a status ladder.

To add this feature to another app, read [INTEGRATION.md](INTEGRATION.md).

## Run it

```
npm install
npm run dev
```

Open the printed URL, paste a document URN (base64) and an access token with
`viewables:read`, then press Load. The viewer loads from the Forge CDN (`7.*`).

1. **Measure** tab, Scale: **Auto** reads the scale the sheet publishes per viewport
   (Revit and CAD sheets), the way ACC's own measure tool does. **Manual** calibrates
   the sheet against a known dimension; PDFs only have this.
2. Set subject, thickness and colour, then press the ruler button (**Add linear**) above
   the Linear measurement fields. Click to add points;
   double-click or Enter finishes a run, Esc cancels it, Esc again (or the button)
   leaves draw mode. Nothing else finishes a line.
3. **Divide options** tab: set the division size and the status ladder.
4. **Assets** tab: one group per run, one row per piece. Set each piece's stage.
5. To edit a run, press its pencil in **Runs on this sheet**: drag an end or elbow,
   select an elbow and press Delete to remove it, double-click an end to continue
   the run. Esc or the tick finishes.

On the sheet: click selects, Ctrl+click adds, Shift+drag selects a rectangle,
clicking a row in the panel zooms to it.

Nothing is persisted. Reload and it is gone; storage is the host app's job.

## Modules

| Folder | What it is | Depends on |
|---|---|---|
| `src/divide/` | Pure maths: where the cuts fall on a polyline, how long each piece is | nothing |
| `src/measure/` | The measurement record (subject, thickness, colour, raw points), units, the per-sheet scale choice (auto or manual), length from raw points | nothing |
| `src/tracking/` | Assets, the ladder, divide options, reconciling assets with measurements, planning a re-division. Pure state in, state out | `divide`, `measure` |
| `src/viewer/` | The only code that touches the APS API. `load.ts` is demo wiring (CDN, token, sheet loading); `edit2d-surface.ts` attaches to any existing viewer and is the part to keep; `sheet-scale.ts` reads viewport scales; `gaps.ts` trims pieces for the gap at each cut | nothing |
| `src/ui/` | React components. `TrackingWorkspace` is the whole feature as one controlled component; `App.tsx` is the demo host | all of the above |
| `src/index.ts` | Public surface for lifting into another app | |

### Using it in an app that already has APS

Keep your own viewer setup and storage. After a 2D sheet has loaded:

```ts
const surface = await attachEdit2D(viewer);   // re-attach after every sheet switch, dispose() the old one
```

```tsx
<TrackingWorkspace
  surface={surface} sheet={guid} page={page}
  measurements={...} scales={...} assets={...} options={...}
  onMeasurementCreated={...} onMeasurementChanged={...} onMeasurementDeleted={...}
  onScaleChanged={...} onAssetChanged={...} onOptionsChanged={...}
/>
```

Pass every measurement the assets refer to (all sheets), not only the current
sheet's: an asset whose measurement is missing becomes unplaced. Upsert on
`onAssetChanged` by `asset.key`.

## Behaviour worth knowing

- Built on `Autodesk.Edit2D`, not `Autodesk.Measure`. Measure has no open
  polyline, no colour or thickness API, and its read/write calls work only while
  its own UI is active.
- Length is always computed from the raw clicked points times the run's scale. In
  Auto, a run takes the scale of the viewport its first snapped click lands in, saved
  on the measurement when drawn; outside any viewport it falls back to the manual
  calibration.
- Line thickness is in points on the paper sheet, so lines zoom with the drawing.
  Pieces of a divided run are drawn with a gap at each cut, its width set in Divide
  options (points on the paper); the stored geometry and lengths are untouched.
- Unplaced assets without progress are not listed (they are kept in the data).
- A leftover shorter than half the division size joins the last piece (31 m at 3 m:
  ten pieces, last 4 m; 32 m at 3 m: eleven, last 2 m). A piece that spans a corner
  keeps the corner. Pieces always sum to the run.
- An asset is anchored by `(sheet, page, measurementId, occurrenceKey)`. The key
  is `run` for a whole run and `run:0`, `run:1`, ... for pieces, by index.
- An asset whose geometry disappears becomes unplaced, never deleted.
- Percent complete is derived from the stage's position in the ladder, never stored.
- Changing the division size re-cuts every run: low indices keep their key but
  cover a new span, extra indices become unplaced, and missing ones are created. The
  app warns with the counts first. "Carry progress by span" gives new and re-cut
  pieces the stage of the old piece they overlap most.
