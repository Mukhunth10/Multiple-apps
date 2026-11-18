import type { LengthUnit, Point } from '../measure';

export interface Stage {
  name: string;
  color: string;
}

/** The divide options: a settings surface, not a constant. */
export interface DivideOptions {
  /** Empty or zero keeps every run as one asset. */
  divisionSize: number | null;
  divisionUnit: LengthUnit;
  /** Ordered stages an asset moves through (1st fix, 2nd fix, ...). */
  ladder: Stage[];
  /** Visible gap drawn at each cut between pieces, in points on the paper. Display only. */
  gapWidth: number;
}

export interface AssetAnchor {
  sheet: string;
  page: number;
  measurementId: string;
  /** "run" for an undivided run, "run:0", "run:1", ... for pieces, by index along the run. */
  occurrenceKey: string;
}

export interface Asset extends AssetAnchor {
  /** Stable id built from the anchor. Never a render-time element id. */
  key: string;
  /** Index along the run, or null for an undivided run. The run number lives on the group. */
  pieceIndex: number | null;
  /** Position in the ladder; -1 is not started. Percent complete is derived from this. */
  stage: number;
  /** False when the geometry it was anchored to is gone. Unplaced assets are kept, never deleted. */
  placed: boolean;
  /** Where the asset sits along its run, in metres. */
  fromM: number;
  toM: number;
}

/** An asset's current geometry; computed from the measurement, never stored. */
export interface PlacedPiece {
  occurrenceKey: string;
  pieceIndex: number | null;
  points: Point[];
  fromM: number;
  toM: number;
}
