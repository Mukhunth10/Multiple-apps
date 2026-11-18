import type { LengthUnit, MeasureStyle, Measurement, Point, Scale, SheetScale, ViewportScale } from './types';

export const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'in', 'ft'];

const METRES_PER: Record<LengthUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return (value * METRES_PER[from]) / METRES_PER[to];
}

/** Sheet-space length of the raw clicked points. */
export function rawLength(points: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return n;
}

/** Real-world length of a run in `unit` (defaults to the scale's own unit). */
export function measuredLength(m: Pick<Measurement, 'points'>, scale: Scale, unit: LengthUnit = scale.unit): number {
  return convertLength(rawLength(m.points) * scale.unitsPerSheetUnit, scale.unit, unit);
}

/** Manual calibration from a reference line the user drew and the real length they typed. */
export function calibrate(referencePoints: readonly Point[], realLength: number, unit: LengthUnit): Scale | null {
  const sheetLen = rawLength(referencePoints);
  if (!(sheetLen > 0) || !(realLength > 0)) return null;
  return { unit, unitsPerSheetUnit: realLength / sheetLen };
}

export function findSheetScale(scales: readonly SheetScale[], sheet: string, page: number): SheetScale | undefined {
  return scales.find((s) => s.sheet === sheet && s.page === page);
}

/** Auto unless the user chose otherwise. */
export function scaleModeOf(s: SheetScale | undefined): 'auto' | 'manual' {
  return s?.mode ?? 'auto';
}

/** The scale a run is measured with. Auto falls back to the manual calibration outside a viewport. */
export function resolveScale(m: Measurement, sheetScale: SheetScale | undefined): Scale | undefined {
  if (scaleModeOf(sheetScale) === 'auto' && m.viewportScale) return m.viewportScale;
  return sheetScale?.manual ?? undefined;
}

export function nextRunNumber(measurements: readonly Measurement[], sheet: string, page: number): number {
  return measurements.reduce((n, m) => (m.sheet === sheet && m.page === page ? Math.max(n, m.number) : n), 0) + 1;
}

export function createMeasurement(
  existing: readonly Measurement[],
  sheet: string,
  page: number,
  points: readonly Point[],
  style: MeasureStyle,
  viewportScale: ViewportScale | null,
): Measurement {
  return {
    id: crypto.randomUUID(),
    sheet,
    page,
    number: nextRunNumber(existing, sheet, page),
    subject: style.subject.trim() || 'Untitled',
    thickness: style.thickness,
    color: style.color,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    viewportScale,
  };
}

export function formatLength(value: number, unit: LengthUnit): string {
  return `${value.toFixed(unit === 'mm' ? 0 : 2)} ${unit}`;
}
