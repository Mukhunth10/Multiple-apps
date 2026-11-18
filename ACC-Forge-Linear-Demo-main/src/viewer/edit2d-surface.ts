// The measure surface on top of an APS viewer, built on Autodesk.Edit2D.
//
// Why Edit2D and not Autodesk.Measure: Measure has no open polyline (Distance is
// exactly two picks, Area closes itself), no colour or thickness API, and its
// list/set calls only work while its own UI is active. Edit2D draws open
// polylines with a per-shape style and owns a selection model whose hit test
// follows the line itself, so every piece becomes a first-class selectable shape
// and hover/highlight look identical for all of them.
//
// Everything that knows the Edit2D API is in this file (and sheet-scale.ts).

import { trimPolyline } from './gaps';
import type { ApsViewer } from './load';
import { layerUnitsPerPaperMm, readViewportScales, snappedViewportId, type SheetViewportScale } from './sheet-scale';

export interface Point {
  x: number;
  y: number;
}

export interface DrawStyle {
  color: string;
  /** Points on the paper sheet (1/72 inch), so a line scales with the drawing like ink. */
  thickness: number;
}

/** One selectable thing on the sheet. `id` is the caller's id (an asset key). */
export interface SurfaceShape extends DrawStyle {
  id: string;
  points: Point[];
  /** Leave a gap at this end (a cut between two pieces). */
  gapStart?: boolean;
  gapEnd?: boolean;
  /** Width of each gap, in points on the paper. */
  gapWidth?: number;
}

export interface DrawnPolyline {
  /** The raw clicked points, in sheet (layer) coordinates. */
  points: Point[];
  /** Scale of the viewport the run was drawn in, or null when none could be found. */
  viewportScale: SheetViewportScale | null;
}

export interface DrawHandlers {
  /** A polyline was finished (double-click or Enter). */
  onDrawn(r: DrawnPolyline): void;
  /** Draw mode ended: endDraw(), or Esc with no line in progress. */
  onExit?(): void;
}

export interface EditHandlers {
  /** The run's points changed: a vertex moved, was added or deleted, or the run was continued. */
  onChange(points: Point[]): void;
  /** Edit mode ended: endEdit(), Esc, or draw mode started. */
  onExit?(): void;
}

export interface MeasureSurface {
  /** Enter draw mode. Stays on for any number of polylines until endDraw() or Esc. */
  beginDraw(style: DrawStyle, handlers: DrawHandlers): void;
  /** Style for the next polyline drawn while draw mode is on. */
  setDrawStyle(style: DrawStyle): void;
  endDraw(): void;
  isDrawing(): boolean;
  /**
   * Edit one run with Edit2D's own vertex tool: only its ends and elbows move (the
   * line itself does not), Delete/Backspace removes the selected elbow, double-click
   * an end to continue the run. Esc or endEdit() finishes.
   */
  beginEdit(points: Point[], style: DrawStyle, handlers: EditHandlers): void;
  endEdit(): void;
  /** Viewports on the loaded sheet that publish a scale. Empty for PDFs. */
  viewportScales(): SheetViewportScale[];
  /** Replace every displayed shape. Selection survives for ids that still exist. */
  setShapes(shapes: SurfaceShape[]): void;
  setSelection(ids: string[]): void;
  /** Zoom the camera to the given shapes. */
  locate(ids: string[]): void;
  onSelectionChanged(cb: (ids: string[]) => void): () => void;
  dispose(): void;
}

const PICK_TOOL = 'MeasureTrackingPickTool';
const MM_PER_PT = 25.4 / 72;

export async function attachEdit2D(viewer: ApsViewer): Promise<MeasureSurface> {
  const ext = await viewer.loadExtension('Autodesk.Edit2D', { enableArcs: false });
  ext.registerDefaultTools();
  const ctx = ext.defaultContext;
  const layer = ctx.layer;
  const selection = ctx.selection;
  const polylineTool = ext.defaultTools.polylineTool;
  const Edit2D = Autodesk.Edit2D;
  const scales = readViewportScales(viewer, layer);
  const unitsPerPt = layerUnitsPerPaperMm(viewer, layer) * MM_PER_PT;
  // Flat ends, so a cut reads as a clean break (Edit2D defaults its layer to round caps).
  layer.context.canvasContext.lineCap = 'butt';
  // None of Edit2D's tools may be live until draw mode is asked for.
  for (const tool of Object.values<any>(ext.defaultTools)) {
    if (tool?.isActive?.()) viewer.toolController.deactivateTool(tool.getName());
  }

  // Finish ONLY on double-click or Enter. Edit2D also finishes on "C" and on a
  // click on the start vertex; both are auto-finish behaviours, so both go.
  polylineTool.keyMap.FINISH_EDIT = [Autodesk.Viewing.KeyCode.ENTER];
  polylineTool.handleStartVertexClicked = function (this: any, e: Event) {
    if (this.poly) {
      const p = this.poly.getPoint(0);
      this.addVertex(p.x, p.y);
    }
    e.stopPropagation();
  };

  const byId = new Map<string, any>();      // caller id -> Edit2D shape
  const idOf = new Map<number, string>();   // Edit2D shape id -> caller id
  const listeners = new Set<(ids: string[]) => void>();

  // ---- drawing -------------------------------------------------------------
  // Draw mode is entered only through beginDraw (the panel's button). Outside it
  // the polyline tool is not active, so the cursor and clicks are the viewer's own.
  let pending: DrawHandlers | null = null;
  let drawViewport: number | null = null;
  const toolName = polylineTool.getName();
  const logTools = (when: string) =>
    console.log(`[Draw] ${when}`, { active: viewer.toolController.getActiveToolName?.(), polylineActive: polylineTool.isActive?.() });

  // The first click that snaps onto sheet geometry inside a viewport fixes the run's scale.
  const originalClick = polylineTool.handleSingleClick.bind(polylineTool);
  polylineTool.handleSingleClick = (e: any, button: number) => {
    const handled = originalClick(e, button);
    if (pending && drawViewport === null) {
      const id = snappedViewportId(ctx);
      if (id !== null && scales.has(id)) drawViewport = id;
    }
    return handled;
  };

  const exitDraw = () => {
    const h = pending;
    pending = null;
    polylineTool.cancelEdit?.();
    viewer.toolController.deactivateTool(toolName);
    logTools('off');
    h?.onExit?.();
  };
  // Esc: in draw mode it first cancels the line in progress (Edit2D's own behaviour) and
  // then leaves draw mode; while continuing a run it drops the extension; in edit mode it finishes.
  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (pending && !polylineTool.poly) exitDraw();
    else if (editing && extending) cancelExtend();
    else if (editing) surface.endEdit();
  };
  window.addEventListener('keydown', onEsc, true);

  const onPolygonAdded = (e: any) => {
    const poly = e.polygon;
    const points: Point[] = shapePoints(poly).map((p) => ({ x: p.x, y: p.y }));
    // The finished shape belongs to the caller's state now; it is redrawn via setShapes.
    layer.removeShape(poly);
    ctx.undoStack.clear();
    if (editing && extending) {
      console.log('[Edit] run continued', { points: points.length, fromStart: extendFromStart });
      return finishExtend(points);
    }
    // Outside any snapped viewport, a sheet with exactly one scaled viewport is unambiguous.
    const vpId = drawViewport ?? (scales.size === 1 ? [...scales.keys()][0] : null);
    console.log('[Scale] run drawn', { snappedViewport: drawViewport, used: vpId });
    drawViewport = null;
    if (points.length >= 2) pending?.onDrawn({ points, viewportScale: vpId === null ? null : scales.get(vpId)! });
  };
  polylineTool.addEventListener(Edit2D.PolygonTool.POLYGON_ADDED, onPolygonAdded);

  // ---- picking: hover, click, ctrl-click, shift-drag marquee ----------------
  const hit = (e: any) => {
    const p = layer.canvasToLayer(e.canvasX, e.canvasY);
    const s = layer.hitTest(p.x, p.y);
    return s && idOf.has(s.id) ? s : null;
  };

  let marquee: { x0: number; y0: number; box: HTMLDivElement } | null = null;

  const pickTool = {
    getNames: () => [PICK_TOOL],
    getName: () => PICK_TOOL,
    getPriority: () => 40,
    register() {},
    deregister() {},
    activate() {},
    deactivate() {},
    update: () => false,
    handleSingleClick(e: any, button: number) {
      if (pending || editing || button !== 0) return false;
      const s = hit(e);
      if (!s) {
        if (!(e.ctrlKey || e.metaKey)) selection.clear();
        return false;
      }
      if (e.ctrlKey || e.metaKey) selection.toggleSelection(s);
      else selection.selectOnly(s);
      return true;
    },
    handleButtonDown(e: any, button: number) {
      if (pending || editing || button !== 0 || !e.shiftKey) return false;
      const box = document.createElement('div');
      box.className = 'mt-marquee';
      viewer.container.appendChild(box);
      marquee = { x0: e.canvasX, y0: e.canvasY, box };
      return true;
    },
    handleMouseMove(e: any) {
      if (marquee) {
        const { x0, y0, box } = marquee;
        Object.assign(box.style, {
          left: `${Math.min(x0, e.canvasX)}px`,
          top: `${Math.min(y0, e.canvasY)}px`,
          width: `${Math.abs(e.canvasX - x0)}px`,
          height: `${Math.abs(e.canvasY - y0)}px`,
        });
        return true;
      }
      if (pending || editing) return false;
      const s = hit(e);
      selection.setHoveredId(s ? s.id : 0);
      return false;
    },
    handleButtonUp(e: any) {
      if (!marquee) return false;
      const { x0, y0, box } = marquee;
      marquee = null;
      box.remove();
      const a = layer.canvasToLayer(x0, y0);
      const b = layer.canvasToLayer(e.canvasX, e.canvasY);
      const rect = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
      const picked = [...byId.values()].filter((s) => polylineTouchesRect(shapePoints(s), rect));
      selection.setSelection(e.ctrlKey || e.metaKey ? [...selection.getSelectedShapes(), ...picked] : picked);
      return true;
    },
  };
  viewer.toolController.registerTool(pickTool);
  viewer.toolController.activateTool(PICK_TOOL);

  const onSelection = () => {
    const ids = selection.getSelectedShapes().map((s: any) => idOf.get(s.id)).filter(Boolean) as string[];
    listeners.forEach((cb) => cb(ids));
  };
  selection.addEventListener(Edit2D.Selection.Events.SELECTION_CHANGED, onSelection);

  // Tint highlighted pieces with the viewer's own 2D maths: selection blends toward its
  // 2D selection colour (set2dSelectionColor), hover 25% toward yellow, as its shaders do.
  const highlight = (shape: any, style: any) => {
    if (!idOf.has(shape.id)) return style;
    const selected = selection.shapeIsSelected(shape);
    if (!selected && shape.id !== selection.hoveredId) return style;
    const own = parseRgb(style.lineColor);
    if (!own) return style;
    const s = style.clone();
    s.lineColor = selected ? mixRgb(own, viewerSelectionColor(viewer), viewerSelectionAlpha(viewer)) : mixRgb(own, [1, 1, 0], 0.25);
    return s;
  };
  layer.addStyleModifier(highlight);

  // ---- shapes, and the gaps between pieces ---------------------------------------
  // Width and gap are both in sheet units, so they zoom with the drawing.
  const applyStyle = (style: any, s: DrawStyle) => {
    style.lineColor = gammaCorrected(s.color);
    style.lineWidth = s.thickness * unitsPerPt;
    style.isScreenSpace = false;
  };

  const geometryOf = (spec: SurfaceShape): Point[] => {
    if ((!spec.gapStart && !spec.gapEnd) || !(spec.gapWidth! > 0)) return spec.points;
    const half = (spec.gapWidth! / 2) * unitsPerPt;
    return trimPolyline(spec.points, spec.gapStart ? half : 0, spec.gapEnd ? half : 0);
  };

  const build = (spec: SurfaceShape) => {
    const s = new Edit2D.Polyline(geometryOf(spec).map((p) => ({ x: p.x, y: p.y })));
    applyStyle(s.style, spec);
    return s;
  };


  // ---- editing one run with Edit2D's own vertex tool ---------------------------
  const editTool = ext.defaultTools.polygonEditTool;
  const editToolName = editTool.getName();
  const KeyCode = Autodesk.Viewing.KeyCode;
  let editing: EditHandlers | null = null;
  let editShape: any = null;
  let editStyle: DrawStyle = { color: '#000000', thickness: 1 };
  let extending = false;
  let extendFromStart = false;
  let extendBase: Point[] = [];

  // Arcs are off in this app, so the arc/ellipse shortcuts have nothing to do.
  editTool.keyMap.ChangeToArc = null;
  editTool.keyMap.ChangeToLine = null;
  editTool.keyMap.ChangeToEllipse = null;
  // Delete removes the selected vertex too, not only Backspace. Both are always consumed
  // here: otherwise Edit2D's own shortcut further down the tool stack deletes the whole run.
  const editKeyDown = editTool.handleKeyDown.bind(editTool);
  editTool.handleKeyDown = (e: any, key: number) => {
    if (key === KeyCode.DELETE || key === KeyCode.BACKSPACE) {
      editKeyDown(e, editTool.keyMap.DeleteSelectedVertex);
      return true;
    }
    return editKeyDown(e, key);
  };
  // A run keeps at least two points; Edit2D would delete the whole line instead.
  const editRemovePoint = editTool.removePoint.bind(editTool);
  editTool.removePoint = (v: any) => {
    if (editTool.poly?.vertexCount > 2) editRemovePoint(v);
  };
  // No segment handles (the blue bar mid-segment): segments are not draggable here.
  editTool.edgeMoveTool.setAllGizmosEnabled(false);
  // Only ends and elbows move: a press reaches Edit2D's vertex dragger and nothing else,
  // so the edit tool's segment drag, whole-shape move and Ctrl+drag insert never start.
  // A press anywhere else falls through to the viewer (it pans).
  editTool.handleButtonDown = (e: any, button: number) => {
    if (button !== 0 || !editTool.poly) return false;
    if (!editTool.vertexMoveTool.handleButtonDown(e, button)) return false;
    editTool.edgeMoveTool.setSelectedEdge(null);
    return true;
  };
  // The move cursor only where something moves: over an end/elbow handle or while dragging one
  // (Edit2D shows it anywhere on the line, since its line is normally draggable).
  editTool.getCursor = () => {
    const vt = editTool.vertexMoveTool;
    return editTool.poly && (vt.draggedVertex || vt.findVertexUnderMouse()) ? 'move' : undefined;
  };
  // Double-click on an end continues the run with Edit2D's own drawing tool.
  const editDoubleClick = editTool.handleDoubleClick?.bind(editTool);
  editTool.handleDoubleClick = (e: any, button: number) => {
    const end = editing && !extending ? endUnderPointer(e) : null;
    if (end !== null) {
      startExtend(end === 0);
      return true;
    }
    return editDoubleClick ? editDoubleClick(e, button) : false;
  };

  const editPoints = (): Point[] => (editShape ? shapePoints(editShape).map((p) => ({ x: p.x, y: p.y })) : []);
  const onEdited = () => {
    if (editing && !extending && editShape) editing.onChange(editPoints());
  };
  ctx.undoStack.addEventListener('afterAction', onEdited);

  const showEditShape = (points: Point[]) => {
    editShape = new Edit2D.Polyline(points.map((p) => ({ x: p.x, y: p.y })));
    applyStyle(editShape.style, editStyle);
    layer.addShape(editShape);
    // Active first: the tool only builds its vertex handles from a selection change it sees.
    viewer.toolController.activateTool(editToolName);
    selection.selectOnly(editShape);
    if (editTool.poly !== editShape) editTool.setEditPoly(editShape);
  };
  const hideEditShape = () => {
    viewer.toolController.deactivateTool(editToolName);
    if (editShape) layer.removeShape(editShape);
    editShape = null;
    selection.clear();
    ctx.undoStack.clear();
  };

  /** Index of the run's first or last vertex under the pointer (within 10 px), else null. */
  const endUnderPointer = (e: any): number | null => {
    if (!editShape) return null;
    const p = layer.canvasToLayer(e.canvasX, e.canvasY);
    const pts = editPoints();
    const near = (q: Point) => Math.hypot(q.x - p.x, q.y - p.y) / layer.getUnitsPerPixel() <= 10;
    if (near(pts[pts.length - 1])) return pts.length - 1;
    if (near(pts[0])) return 0;
    return null;
  };

  const startExtend = (fromStart: boolean) => {
    extendBase = editPoints();
    extending = true;
    extendFromStart = fromStart;
    hideEditShape();
    applyStyle(polylineTool.style, editStyle);
    viewer.toolController.activateTool(toolName);
    const seq = fromStart ? [...extendBase].reverse() : extendBase;
    polylineTool.startPoly(seq[0].x, seq[0].y);
    seq.forEach((p) => polylineTool.addVertex(p.x, p.y));
    console.log('[Edit] continuing run', { seeded: polylineTool.poly?.vertexCount, fromStart });
  };
  // Runs from inside Edit2D's POLYGON_ADDED; switch tools only once it has returned.
  const finishExtend = (points: Point[]) => {
    const pts = extendFromStart ? [...points].reverse() : points;
    setTimeout(() => {
      extending = false;
      viewer.toolController.deactivateTool(toolName);
      editing?.onChange(pts);
      if (editing) showEditShape(pts);
    }, 0);
  };
  const cancelExtend = () => {
    extending = false;
    polylineTool.cancelEdit?.();
    viewer.toolController.deactivateTool(toolName);
    showEditShape(extendBase);
  };

  // ---- surface API -----------------------------------------------------------
  const surface: MeasureSurface = {
    beginDraw(style, handlers) {
      if (pending) exitDraw();
      if (editing) surface.endEdit();
      selection.clear();
      selection.setHoveredId(0);
      drawViewport = null;
      surface.setDrawStyle(style);
      pending = handlers;
      viewer.toolController.activateTool(toolName);
      logTools('on');
    },
    setDrawStyle(style) {
      applyStyle(polylineTool.style, style);
    },
    endDraw() {
      if (pending) exitDraw();
    },
    isDrawing: () => pending !== null,
    beginEdit(points, style, handlers) {
      if (pending) exitDraw();
      if (editing) surface.endEdit();
      editing = handlers;
      editStyle = style;
      showEditShape(points);
    },
    endEdit() {
      if (!editing) return;
      if (extending) cancelExtend();
      const h = editing;
      const final = editShape ? editPoints() : null;
      editing = null;
      hideEditShape();
      if (final) h.onChange(final);
      h.onExit?.();
    },
    viewportScales: () => [...scales.values()],
    setShapes(shapes) {
      const keep = new Set(selection.getSelectedShapes().map((s: any) => idOf.get(s.id)));
      layer.autoUpdate = false;
      byId.forEach((s) => layer.removeShape(s));
      byId.clear();
      idOf.clear();
      for (const spec of shapes) {
        const s = build(spec);
        layer.addShape(s);
        byId.set(spec.id, s);
        idOf.set(s.id, spec.id);
              }
      layer.autoUpdate = true;
      layer.update();
      if (editShape) selection.selectOnly(editShape);
      else selection.setSelection([...keep].map((id) => byId.get(id as string)).filter(Boolean));
    },
    setSelection(ids) {
      selection.setSelection(ids.map((id) => byId.get(id)).filter(Boolean));
    },
    locate(ids) {
      const shapes = ids.map((id) => byId.get(id)).filter(Boolean);
      if (!shapes.length) return;
      const box = new THREE.Box3();
      for (const s of shapes) {
        const b = s.getBBox();
        box.expandByPoint(new THREE.Vector3(b.min.x, b.min.y, 0).applyMatrix4(layer.layerToWorld));
        box.expandByPoint(new THREE.Vector3(b.max.x, b.max.y, 0).applyMatrix4(layer.layerToWorld));
      }
      const pad = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * 0.25 || 1;
      box.expandByVector(new THREE.Vector3(pad, pad, 0));
      viewer.navigation.fitBounds(false, box);
    },
    onSelectionChanged(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      surface.endDraw();
      surface.endEdit();
      window.removeEventListener('keydown', onEsc, true);
      ctx.undoStack.removeEventListener('afterAction', onEdited);
      polylineTool.handleSingleClick = originalClick;
      polylineTool.removeEventListener(Edit2D.PolygonTool.POLYGON_ADDED, onPolygonAdded);
      selection.removeEventListener(Edit2D.Selection.Events.SELECTION_CHANGED, onSelection);
      layer.removeStyleModifier(highlight);
      viewer.toolController.deactivateTool(PICK_TOOL);
      viewer.toolController.deregisterTool(pickTool);
      byId.forEach((s) => layer.removeShape(s));
      byId.clear();
      idOf.clear();
      listeners.clear();
      ext.unregisterDefaultTools();
    },
  };
  return surface;
}

/**
 * Edit2D's layer shows each colour channel as the square root of what it is given
 * (#e5484d renders as #f2878c, measured on a sheet), so square it first: the same
 * correction Autodesk.Measure's `_hexToCorrectedColor` applies to its 3D lines.
 */
function gammaCorrected(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const sq = (c: number) => Math.round((c / 255) ** 2 * 255);
  return `rgb(${sq((n >> 16) & 255)},${sq((n >> 8) & 255)},${sq(n & 255)})`;
}

type Rgb = [number, number, number];

/** The viewer's 2D selection colour and strength (defaults #0000FF at 0.6), read from its material manager. */
function viewerSelectionColor(viewer: ApsViewer): Rgb {
  const c = viewer.impl?.matman?.()?.get2dSelectionColor?.();
  return c ? [c.r, c.g, c.b] : [0, 0, 1];
}
function viewerSelectionAlpha(viewer: ApsViewer): number {
  const holder: any = { value: {} };
  viewer.impl?.matman?.()?.get2dSelectionColor?.(holder);
  return typeof holder.value.w === 'number' ? holder.value.w : 0.6;
}

function parseRgb(css: string): Rgb | null {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(String(css).replace(/\s/g, ''));
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : null;
}

/** Blend in the layer's own (already corrected) colour space, like the shader's mix(). */
function mixRgb(a: Rgb, b: Rgb, t: number): string {
  const ch = (i: number) => Math.round((a[i] + (b[i] - a[i]) * t) * 255);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

function shapePoints(s: any): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < s.vertexCount; i++) out.push(s.getPoint(i));
  return out;
}

type Rect = { minX: number; maxX: number; minY: number; maxY: number };

/** True when any segment of the polyline crosses or lies inside the rect (not its bounding box). */
function polylineTouchesRect(pts: Point[], r: Rect): boolean {
  const inside = (p: Point) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
  if (pts.some(inside)) return true;
  const corners = [
    { x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY },
  ];
  for (let i = 1; i < pts.length; i++) {
    for (let k = 0; k < 4; k++) {
      if (segmentsCross(pts[i - 1], pts[i], corners[k], corners[(k + 1) % 4])) return true;
    }
  }
  return false;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
