// Pure: shorten a polyline at either end, for the small gap drawn between the pieces of a divided run.

import type { Point } from './edit2d-surface';

/** Never trim more than this fraction of a piece from one end, so short pieces stay visible. */
const MAX_TRIM_FRACTION = 0.25;

export function trimPolyline(points: readonly Point[], startBy: number, endBy: number): Point[] {
  const len = length(points);
  if (len <= 0 || (startBy <= 0 && endBy <= 0)) return points.map((p) => ({ ...p }));
  const cap = len * MAX_TRIM_FRACTION;
  const from = Math.min(Math.max(startBy, 0), cap);
  const to = len - Math.min(Math.max(endBy, 0), cap);
  return slice(points, from, to);
}

function length(pts: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return n;
}

/** The part of the polyline between distances `from` and `to`, corners kept. */
function slice(pts: readonly Point[], from: number, to: number): Point[] {
  const out: Point[] = [];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const at = (d: number) => {
      const t = seg === 0 ? 0 : (d - walked) / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    if (!out.length && walked + seg >= from) out.push(at(from));
    if (walked + seg >= to) {
      out.push(at(to));
      return out;
    }
    if (out.length) out.push({ x: b.x, y: b.y });
    walked += seg;
  }
  return out;
}
