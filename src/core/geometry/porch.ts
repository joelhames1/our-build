import { isOutdoor } from '../model/schema';
import type { ResolvedLevel } from '../resolve';
import { pointInMulti, pointInRing, roomRing } from './polygon';
import { PORCH_BEAM } from './roof';

export interface Box3 {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/**
 * Posts and the beam over them along every open edge of a covered porch: a post at each end and
 * about every 8', set in from the edge. Shared by the 3D view and the drawings.
 */
export function porchFrame(rl: ResolvedLevel, cut?: number): { owner: string; posts: Box3[]; beams: Box3[] }[] {
  const out: { owner: string; posts: Box3[]; beams: Box3[] }[] = [];
  const outdoor = rl.level.rooms.filter((r) => isOutdoor(r.type));
  for (const r of outdoor) {
    if (!r.covered) continue;
    const ring = roomRing(r);
    const floor = rl.elevation - 0.33;
    const beamTop = cut !== undefined ? Math.min(floor + PORCH_BEAM, rl.elevation + cut) : floor + PORCH_BEAM;
    const posts: Box3[] = [];
    const beams: Box3[] = [];
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = (x2 - x1) / len;
      const dy = (y2 - y1) / len;
      // Outward is right of travel for counter-clockwise rings; skip edges against the house or another porch.
      const probe: [number, number] = [mx + dy * 0.3, my - dx * 0.3];
      if (pointInMulti(probe, rl.footprint)) continue;
      if (outdoor.some((o) => o !== r && pointInRing(probe, roomRing(o)))) continue;
      const ix = -dy;
      const iy = dx;
      const inset = 0.35;
      const n = Math.max(1, Math.ceil(len / 8));
      for (let k = 0; k <= n; k++) {
        const along = k === 0 ? inset : k === n ? len - inset : (len * k) / n;
        const cx = x1 + dx * along + ix * inset;
        const cy = y1 + dy * along + iy * inset;
        posts.push({ x0: cx - 0.25, x1: cx + 0.25, y0: cy - 0.25, y1: cy + 0.25, z0: floor, z1: beamTop });
      }
      if (cut === undefined) {
        const bx = mx + ix * inset;
        const by = my + iy * inset;
        const [hx, hy] = Math.abs(dx) > 0.5 ? [len / 2, 0.25] : [0.25, len / 2];
        beams.push({ x0: bx - hx, x1: bx + hx, y0: by - hy, y1: by + hy, z0: beamTop - 0.7, z1: beamTop });
      }
    }
    out.push({ owner: r.id, posts, beams });
  }
  return out;
}
