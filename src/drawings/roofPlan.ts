import { type MultiPoly, distToSeg, pointInMulti, union } from '@/core/geometry/polygon';
import type { Resolved } from '@/core/resolve';
import { type Drawing, Pad } from './ir';
import { dimensionsAround, hatch, northArrow } from './plan';

/**
 * The roof from above: every visible roof plane with its ridges, hips and valleys, a slope arrow
 * and pitch on each plane, the walls below dashed, the chimney, and overall dimensions.
 */
export function roofPlan(res: Resolved, scale: number): Drawing {
  const pad = new Pad(scale);
  // Walls below: the outline of every level, dashed.
  const below = union(...res.levels.map((rl) => rl.footprint));
  for (const poly of below) for (const ring of poly) pad.line(ring as [number, number][], 'hidden', 'A-ROOF', true);

  const seen = new Set<string>();
  const edge = (a: [number, number], b: [number, number]) => {
    const k1 = `${a[0].toFixed(3)},${a[1].toFixed(3)}`;
    const k2 = `${b[0].toFixed(3)},${b[1].toFixed(3)}`;
    const key = k1 < k2 ? k1 + k2 : k2 + k1;
    if (seen.has(key)) return;
    seen.add(key);
    pad.seg(a, b, 'medium', 'A-ROOF');
  };
  for (const f of res.roof.faces) {
    for (const poly of f.visible) pad.fill(poly as [number, number][][], 'light', 'A-ROOF');
    for (const poly of f.visible)
      for (const ring of poly)
        for (let i = 0; i < ring.length; i++) edge(ring[i] as [number, number], ring[(i + 1) % ring.length] as [number, number]);
  }
  // Slope arrows, pointing downhill, with the pitch.
  for (const f of res.roof.faces) {
    const at = interiorPoint(f.visible);
    if (!at) continue;
    const [x, y, room] = at;
    const slope = Math.hypot(f.plane.a, f.plane.b);
    if (slope < 1e-3 || (f.down[0] === 0 && f.down[1] === 0)) {
      if (room > pad.p(0.3)) pad.text([x, y - pad.p(0.04)], 'FLAT', 0.08, 'A-ANNO-TEXT', { align: 'center', font: 'sans' });
      continue;
    }
    const len = Math.min(pad.p(0.5), room * 1.4);
    if (len < pad.p(0.18)) continue;
    const [dx, dy] = f.down;
    const a: [number, number] = [x - (dx * len) / 2, y - (dy * len) / 2];
    const b: [number, number] = [x + (dx * len) / 2, y + (dy * len) / 2];
    pad.seg(a, b, 'fine', 'A-ANNO-SYMB');
    const h = pad.p(0.05);
    pad.fill([[b, [b[0] - dx * h * 1.8 - dy * h * 0.6, b[1] - dy * h * 1.8 + dx * h * 0.6], [b[0] - dx * h * 1.8 + dy * h * 0.6, b[1] - dy * h * 1.8 - dx * h * 0.6]]], 'poche', 'A-ANNO-SYMB');
    const pitch = Math.round(slope * 12 * 2) / 2;
    // Pitch text beside the arrow, reading along it where it runs sideways.
    const along = Math.abs(dx) > Math.abs(dy);
    pad.text(along ? [x, y + pad.p(0.04)] : [x + pad.p(0.05), y], `${pitch}:12`, 0.075, 'A-ANNO-TEXT', { align: along ? 'center' : 'left', font: 'sans' });
  }
  // Chimney from above: the stack hatched, the cap and flue on top.
  const ch = res.chimney;
  if (ch) {
    for (const blk of [...ch.blocks].sort((p, q) => p.z1 - q.z1)) {
      if (blk.part === 'base') continue;
      const b = blk.box;
      const ring: [number, number][] = [
        [b.x0, b.y0],
        [b.x1, b.y0],
        [b.x1, b.y1],
        [b.x0, b.y1],
      ];
      pad.fill([ring], 'white', 'A-ROOF');
      pad.line(ring, 'medium', 'A-ROOF', true);
      if (blk.part === 'stack') for (const [p, q] of hatch(b, pad.p(0.06))) pad.seg(p, q, 'fine', 'A-ROOF');
    }
  }
  dimensionsAround(pad, union(...res.roof.faces.map((f) => f.visible)));
  northArrow(pad, res);
  return { id: 'roof', title: 'Roof Plan', scale, items: pad.items };
}

/** The point inside a region farthest from its edges (sampled), and that distance. */
export function interiorPoint(m: MultiPoly): [number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of m)
    for (const r of p)
      for (const [x, y] of r) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (!Number.isFinite(x0)) return null;
  let best: [number, number, number] | null = null;
  const n = 24;
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * j) / n;
      if (!pointInMulti([x, y], m)) continue;
      let d = Infinity;
      for (const p of m)
        for (const r of p)
          for (let k = 0; k < r.length; k++) d = Math.min(d, distToSeg([x, y], r[k], r[(k + 1) % r.length]));
      if (!best || d > best[2]) best = [x, y, d];
    }
  return best;
}
