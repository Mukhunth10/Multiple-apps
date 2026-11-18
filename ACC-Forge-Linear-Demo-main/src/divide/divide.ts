// Pure: cut a measured run into fixed-length pieces. No viewer, no state, no DOM.
//
// Remainder rule: a leftover shorter than HALF the division size is absorbed into
// the last piece. 31 m at 3 m is ten pieces, the last 4 m; 32 m at 3 m is eleven,
// the last 2 m. A run no longer than one division is a single piece.

export interface Point {
  x: number;
  y: number;
}

export interface Piece {
  index: number;
  /** Length in the measured unit (the unit `totalLength` and `size` are given in). */
  length: number;
  /** Distance along the run where the piece starts / ends, measured unit. */
  from: number;
  to: number;
  /** Polyline in the run's own coordinate space, corners included. */
  points: Point[];
}

export const ABSORB_BELOW = 0.5;

/** Length of each piece. [] for a run with no length, [total] when it does not divide. */
export function pieceLengths(total: number, size: number | null | undefined): number[] {
  const L = Number(total);
  const D = Number(size);
  if (!(L > 0)) return [];
  if (!(D > 0) || L <= D) return [L];
  const full = Math.floor(L / D);
  const rest = L - full * D;
  const out: number[] = new Array(full).fill(D);
  if (rest <= 0) return out;
  if (rest < D * ABSORB_BELOW) out[out.length - 1] = D + rest;
  else out.push(rest);
  return out;
}

/** Cumulative distance at which each piece ENDS; the last is exactly `total`. */
export function cutPoints(total: number, size: number | null | undefined): number[] {
  const lens = pieceLengths(total, size);
  const ends: number[] = [];
  let at = 0;
  lens.forEach((len, i) => {
    at += len;
    ends.push(i === lens.length - 1 ? Number(total) : at);
  });
  return ends;
}

export function polylineLength(points: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return n;
}

/** Point at distance `d` along the polyline and the segment it lies on; clamped at both ends. */
export function pointAt(points: readonly Point[], d: number): (Point & { seg: number }) | null {
  if (!points.length) return null;
  if (d <= 0) return { x: points[0].x, y: points[0].y, seg: 0 };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (walked + segLen >= d) {
      const t = segLen === 0 ? 0 : (d - walked) / segLen;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
        seg: i - 1,
      };
    }
    walked += segLen;
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y, seg: points.length - 2 };
}

/**
 * The run cut into pieces. `totalLength` and `size` are in the measured unit;
 * the points are in the polyline's own space. One ratio converts between them.
 */
export function divide(points: readonly Point[], totalLength: number, size: number | null | undefined): Piece[] {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  const lens = pieceLengths(totalLength, size);
  if (pts.length < 2 || !lens.length) return [];
  const scale = totalLength > 0 ? polylineLength(pts) / totalLength : 0;

  const out: Piece[] = [];
  let from = 0;
  for (let i = 0; i < lens.length; i++) {
    const to = i === lens.length - 1 ? totalLength : from + lens[i];
    const a = pointAt(pts, from * scale)!;
    const b = pointAt(pts, to * scale)!;
    // Every vertex between the two cuts, so a piece turning a corner keeps it.
    const mid = pts.slice(a.seg + 1, b.seg + 1);
    out.push({
      index: i,
      length: lens[i],
      from,
      to,
      points: [{ x: a.x, y: a.y }, ...mid.map((p) => ({ x: p.x, y: p.y })), { x: b.x, y: b.y }],
    });
    from = to;
  }
  return out;
}
