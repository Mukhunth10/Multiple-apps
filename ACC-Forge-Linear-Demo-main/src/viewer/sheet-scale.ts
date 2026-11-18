// Scale published by the sheet itself, read the way Autodesk.Measure reads it:
// each viewport on a Revit/CAD sheet carries a page-to-model transform and its
// units (`model.getData().viewports[id]`, `model.pageToModel(p1, p2, id)`).
// Revit sheets often arrive as vector PDFs and still carry them; a plain PDF
// carries none, so it falls back to manual calibration.

import type { ApsViewer } from './load';

export type ScaleUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface SheetViewportScale {
  viewportId: number;
  unit: ScaleUnit;
  /** Model units per Edit2D layer unit (the space the clicked points are in). */
  unitsPerSheetUnit: number;
}

const UNIT_ALIASES: Record<string, ScaleUnit> = {
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  in: 'in', inch: 'in', inches: 'in', '"': 'in', 'decimal-in': 'in', 'fractional-in': 'in',
  ft: 'ft', foot: 'ft', feet: 'ft', "'": 'ft', 'decimal-ft': 'ft', 'ft-and-fractional-in': 'ft', 'ft-and-decimal-in': 'ft', 'feet and inches': 'ft',
};

function normUnit(u: unknown): ScaleUnit | null {
  return typeof u === 'string' ? UNIT_ALIASES[u.trim().toLowerCase()] ?? null : null;
}

/** Every viewport on the loaded sheet that has a usable scale. Empty for PDFs. */
export function readViewportScales(viewer: ApsViewer, layer: any): Map<number, SheetViewportScale> {
  const out = new Map<number, SheetViewportScale>();
  const model = viewer.model;
  const data = model?.getData?.();
  // Vector PDFs published from Revit carry viewports too; a plain PDF has none (or only the paper).
  if (!model?.is2d?.() || !Array.isArray(data?.viewports)) {
    console.log('[Scale] no viewport data on this sheet', { is2d: model?.is2d?.(), isPdf: model?.isPdf?.() });
    return out;
  }
  const sheetUnits = model.getMetadata?.('page_dimensions', 'model_units', null);
  // Index 0 is the paper itself; real viewports start at 1.
  for (let id = 1; id < data.viewports.length; id++) {
    const vp = data.viewports[id];
    const unit = normUnit(vp?.units) ?? normUnit(sheetUnits);
    if (!unit) continue;
    const a = toWorld(layer, 0, 0);
    const b = toWorld(layer, 1, 0);
    model.pageToModel(a, b, id);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 0 && Number.isFinite(d)) out.set(id, { viewportId: id, unit, unitsPerSheetUnit: d });
  }
  console.log(
    `[Scale] ${data.viewports.length - 1} viewports, ${out.size} with a scale`,
    [...out.values()].map((s) => `#${s.viewportId}: ${s.unitsPerSheetUnit.toPrecision(5)} ${s.unit}/unit`),
    { sheetUnits, firstViewportKeys: data.viewports[1] ? Object.keys(data.viewports[1]) : [] },
  );
  return out;
}

/**
 * The viewport a click landed in. Edit2D's snapper wraps the viewer's own, and a
 * click snapped to sheet geometry carries `viewportIndex2d` the same way Measure reads it.
 */
export function snappedViewportId(edit2dContext: any): number | null {
  const sheetSnapper = edit2dContext?.snapper?.sheetSnapper;
  if (!sheetSnapper?.isSnapped?.()) return null;
  const id = sheetSnapper.getSnapResult?.()?.viewportIndex2d;
  return Number.isInteger(id) && id > 0 ? id : null;
}

const MM_PER: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, pt: 25.4 / 72 };

/**
 * Edit2D layer units per millimetre of PAPER, from `page_dimensions`. A PDF's world
 * space is the page itself; an F2D sheet's is `logical_width` across `page_width`.
 * Falls back to 1 (layer unit = paper mm) when the sheet carries no page size.
 */
export function layerUnitsPerPaperMm(viewer: ApsViewer, layer: any): number {
  const model = viewer.model;
  const pd = model?.getData?.()?.metadata?.page_dimensions;
  const mmPerPageUnit = MM_PER[String(pd?.page_units ?? '').toLowerCase()];
  if (!pd?.page_width || !mmPerPageUnit) {
    console.log('[Paper] no page size, assuming 1 sheet unit = 1 paper mm');
    return 1;
  }
  const worldPerPageUnit = model.isPdf?.() ? 1 : pd.logical_width / pd.page_width;
  const a = toWorld(layer, 0, 0);
  const b = toWorld(layer, 1, 0);
  const worldPerLayer = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const perMm = worldPerPageUnit / mmPerPageUnit / worldPerLayer;
  console.log(`[Paper] ${pd.page_width.toFixed(1)} x ${pd.page_height.toFixed(1)} ${pd.page_units}, ${perMm.toPrecision(5)} sheet units per paper mm`);
  return perMm;
}

function toWorld(layer: any, x: number, y: number): any {
  return new THREE.Vector3(x, y, 0).applyMatrix4(layer.layerToWorld);
}
