// Pure tracking state: which assets a set of measurements produces, their
// status, and what a change of divide options does to them. No persistence:
// callers pass state in and store what comes out.

import { divide } from '../divide';
import { convertLength, findSheetScale, measuredLength, resolveScale, type Measurement, type Scale, type SheetScale } from '../measure';
import type { Asset, AssetAnchor, DivideOptions, PlacedPiece, Stage } from './types';

export const DEFAULT_LADDER: Stage[] = [
  { name: '1st fix', color: '#f5a623' },
  { name: '2nd fix', color: '#4a90e2' },
  { name: '3rd fix', color: '#9b59b6' },
  { name: '4th fix', color: '#2ecc71' },
];

export const DEFAULT_OPTIONS: DivideOptions = { divisionSize: null, divisionUnit: 'm', ladder: DEFAULT_LADDER, gapWidth: 3 };

export function assetKey(a: AssetAnchor): string {
  return `${a.sheet}|${a.page}|${a.measurementId}|${a.occurrenceKey}`;
}

export function isDivided(options: DivideOptions): boolean {
  return Number(options.divisionSize) > 0;
}

/** Derived, never stored. Not started is 0 %, the last stage is 100 %. */
export function percentComplete(stage: number, ladder: readonly Stage[]): number {
  if (stage < 0 || !ladder.length) return 0;
  return Math.round(((Math.min(stage, ladder.length - 1) + 1) / ladder.length) * 100);
}

export function stageOf(stage: number, ladder: readonly Stage[]): Stage | null {
  return stage < 0 || !ladder.length ? null : ladder[Math.min(stage, ladder.length - 1)];
}

/** The pieces a run currently divides into. A run without a scale cannot be divided. */
export function runPieces(m: Measurement, scale: Scale | undefined, options: DivideOptions): PlacedPiece[] {
  const totalM = scale ? measuredLength(m, scale, 'm') : 0;
  if (!isDivided(options) || !scale) {
    return [{ occurrenceKey: 'run', pieceIndex: null, points: m.points, fromM: 0, toM: totalM }];
  }
  const unit = options.divisionUnit;
  return divide(m.points, measuredLength(m, scale, unit), options.divisionSize).map((p) => ({
    occurrenceKey: `run:${p.index}`,
    pieceIndex: p.index,
    points: p.points,
    fromM: convertLength(p.from, unit, 'm'),
    toM: convertLength(p.to, unit, 'm'),
  }));
}

export interface TrackingInput {
  measurements: readonly Measurement[];
  scales: readonly SheetScale[];
  options: DivideOptions;
  assets: readonly Asset[];
  /** Only assets on this sheet/page are reconciled; the rest pass through untouched. */
  scope?: { sheet: string; page: number };
}

export interface ReconcileResult {
  assets: Asset[];
  /** New or modified assets, in the order they should be emitted. */
  changed: Asset[];
}

/**
 * Bring the asset list in line with the measurements. A piece whose geometry
 * exists is placed; an asset whose geometry is gone becomes unplaced (kept).
 */
export function reconcile(input: TrackingInput): ReconcileResult {
  const inScope = (a: { sheet: string; page: number }) =>
    !input.scope || (a.sheet === input.scope.sheet && a.page === input.scope.page);

  const wanted = new Map<string, Asset>();
  for (const m of input.measurements) {
    if (!inScope(m)) continue;
    const scale = resolveScale(m, findSheetScale(input.scales, m.sheet, m.page));
    for (const p of runPieces(m, scale, input.options)) {
      const anchor = { sheet: m.sheet, page: m.page, measurementId: m.id, occurrenceKey: p.occurrenceKey };
      const key = assetKey(anchor);
      wanted.set(key, { ...anchor, key, pieceIndex: p.pieceIndex, stage: -1, placed: true, fromM: p.fromM, toM: p.toM });
    }
  }

  const assets: Asset[] = [];
  const changed: Asset[] = [];
  const seen = new Set<string>();
  for (const a of input.assets) {
    seen.add(a.key);
    if (!inScope(a)) {
      assets.push(a);
      continue;
    }
    const w = wanted.get(a.key);
    const next: Asset = w ? { ...a, placed: true, pieceIndex: w.pieceIndex, fromM: w.fromM, toM: w.toM } : { ...a, placed: false };
    const same = next.placed === a.placed && next.fromM === a.fromM && next.toM === a.toM && next.pieceIndex === a.pieceIndex;
    assets.push(same ? a : next);
    if (!same) changed.push(next);
  }
  for (const [key, w] of wanted) {
    if (seen.has(key)) continue;
    assets.push(w);
    changed.push(w);
  }
  return { assets, changed };
}

export interface RedividePlan extends ReconcileResult {
  /** Placed assets that the new division leaves without geometry. */
  unplaced: Asset[];
  /** Assets whose key survives but now covers a different span of the run. */
  recut: Asset[];
  /** Unplaced or re-cut assets that carry progress. */
  withProgress: number;
  created: Asset[];
}

/**
 * What applying `next` options would do. Keys are the piece index, so a new
 * division size gives `run:0` a different span and drops or adds the tail
 * indices: destructive to piece progress, and the caller warns with these counts.
 * `carryProgress` gives each new or re-cut piece the stage of the old piece it overlaps most.
 */
export function planRedivide(input: TrackingInput, next: DivideOptions, carryProgress = false): RedividePlan {
  const result = reconcile({ ...input, options: next });
  const before = new Map(input.assets.map((a) => [a.key, a]));
  const unplaced = result.changed.filter((a) => !a.placed && before.get(a.key)?.placed);
  const recut = result.changed.filter((a) => a.placed && before.get(a.key)?.placed);
  const created = result.changed.filter((a) => !before.has(a.key));

  if (carryProgress) {
    const old = [...before.values()].filter((a) => a.placed);
    const overlap = (a: Asset, b: Asset) => Math.max(0, Math.min(a.toM, b.toM) - Math.max(a.fromM, b.fromM));
    const remap = new Set([...recut, ...created].map((a) => a.key));
    const carry = (a: Asset): Asset => {
      if (!remap.has(a.key)) return a;
      let best: Asset | null = null;
      let bestLen = 0;
      for (const o of old) {
        if (o.measurementId !== a.measurementId) continue;
        const len = overlap(a, o);
        if (len > bestLen) [best, bestLen] = [o, len];
      }
      return best ? { ...a, stage: best.stage } : a;
    };
    result.assets = result.assets.map(carry);
    result.changed = result.changed.map(carry);
  }

  const changedByKey = new Map(result.changed.map((a) => [a.key, a]));
  return {
    ...result,
    unplaced,
    recut,
    withProgress: [...unplaced, ...recut].filter((a) => (before.get(a.key)?.stage ?? -1) >= 0).length,
    created: created.map((a) => changedByKey.get(a.key)!),
  };
}

export function divisionChanged(a: DivideOptions, b: DivideOptions): boolean {
  const size = (o: DivideOptions) => (isDivided(o) ? convertLength(Number(o.divisionSize), o.divisionUnit, 'm') : 0);
  return size(a) !== size(b);
}

export interface AssetGroup {
  measurementId: string;
  measurement: Measurement | null;
  /** "Run 3: Supply duct". The run number keeps runs sharing a subject apart. */
  label: string;
  placed: Asset[];
  unplaced: Asset[];
}

/** A run is the parent group of its pieces. */
export function groupAssets(assets: readonly Asset[], measurements: readonly Measurement[]): AssetGroup[] {
  const byRun = new Map<string, AssetGroup>();
  for (const m of measurements) {
    byRun.set(m.id, { measurementId: m.id, measurement: m, label: `Run ${m.number}: ${m.subject}`, placed: [], unplaced: [] });
  }
  for (const a of assets) {
    let g = byRun.get(a.measurementId);
    if (!g) {
      g = { measurementId: a.measurementId, measurement: null, label: 'Removed run', placed: [], unplaced: [] };
      byRun.set(a.measurementId, g);
    }
    (a.placed ? g.placed : g.unplaced).push(a);
  }
  const order = (a: Asset, b: Asset) => (a.pieceIndex ?? -1) - (b.pieceIndex ?? -1) || a.key.localeCompare(b.key);
  const groups = [...byRun.values()];
  groups.forEach((g) => {
    g.placed.sort(order);
    g.unplaced.sort(order);
  });
  return groups.sort((a, b) => (a.measurement?.number ?? Infinity) - (b.measurement?.number ?? Infinity));
}

/** A piece's label is only its own index; the run number is on the group. */
export function assetLabel(a: Asset): string {
  return a.pieceIndex === null ? 'Whole run' : `#${a.pieceIndex + 1}`;
}
