export interface Point {
  x: number;
  y: number;
}

/** The three things a measurement can be styled with, and nothing else. */
export interface MeasureStyle {
  subject: string;
  /** Line thickness in points on the paper sheet (1/72 inch); it zooms with the drawing. */
  thickness: number;
  /** CSS hex colour, e.g. "#e5484d". */
  color: string;
}

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** How many `unit`s one sheet coordinate unit is. */
export interface Scale {
  unit: LengthUnit;
  unitsPerSheetUnit: number;
}

/** A scale read from a viewport on the sheet (Revit and other CAD sheets carry one per viewport). */
export interface ViewportScale extends Scale {
  viewportId: number;
}

/**
 * auto: each run uses the scale of the viewport it was drawn in, as the sheet publishes it.
 * manual: the user calibrates the sheet once against a known dimension.
 */
export type ScaleMode = 'auto' | 'manual';

/** The scale choice for one sheet. */
export interface SheetScale {
  sheet: string;
  page: number;
  mode: ScaleMode;
  /** The manual calibration, if one was made. Kept when switching to auto. */
  manual: Scale | null;
}

export interface Measurement extends MeasureStyle {
  id: string;
  /** The sheet (viewable guid) and page the run was drawn on. */
  sheet: string;
  page: number;
  /** Run number, unique per sheet+page. Names the run's asset group. */
  number: number;
  /** The raw clicked points, in sheet coordinates. Length is always derived from these. */
  points: Point[];
  /** The viewport scale under the run when it was drawn, or null outside any viewport. */
  viewportScale: ViewportScale | null;
}
