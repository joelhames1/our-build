import type { Box } from './polygon';

/**
 * Where to put a room's label: the clear spot nearest the middle of the room, so names and sizes
 * don't land on the furniture. `w` × `h` is the label's size in feet.
 */
export function labelSpot(inner: Box, obstacles: Box[], w: number, h: number): [number, number] {
  return labelFit(inner, obstacles, w, h).at;
}

/** The best spot for a w×h label, and how much of it (sf) still lands on something. */
export function labelFit(inner: Box, obstacles: Box[], w: number, h: number): { at: [number, number]; covered: number } {
  const cx = (inner.x0 + inner.x1) / 2;
  const cy = (inner.y0 + inner.y1) / 2;
  let best: [number, number] = [cx, cy];
  let bestScore = Infinity;
  let bestCovered = 0;
  const step = 0.5;
  for (let x = inner.x0 + w / 2; x <= inner.x1 - w / 2 + 1e-6; x += step) {
    for (let y = inner.y0 + h / 2; y <= inner.y1 - h / 2 + 1e-6; y += step) {
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
      let covered = 0;
      for (const o of obstacles) {
        const ox = Math.min(box.x1, o.x1) - Math.max(box.x0, o.x0);
        const oy = Math.min(box.y1, o.y1) - Math.max(box.y0, o.y0);
        if (ox > 0 && oy > 0) covered += ox * oy;
      }
      const score = covered * 50 + Math.hypot(x - cx, y - cy);
      if (score < bestScore) {
        bestScore = score;
        best = [x, y];
        bestCovered = covered;
      }
    }
  }
  return { at: best, covered: bestCovered };
}
