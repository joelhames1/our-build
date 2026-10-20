import type { BathSpec, Side } from '../model/schema';
import { OPPOSITE } from '../geometry/fixtures';
import type { Box } from '../geometry/polygon';
import { type RoomCtx, SIDES } from './context';

/**
 * Lay out a bathroom: the tub or shower across a short end when the room is the classic 5' alcove
 * width (otherwise along the longest wall without a door), the toilet on the wet wall beside it with
 * 15" to its centerline and 21" clear in front, then the vanity.
 */
export function bath(ctx: RoomCtx, spec: BathSpec, half: boolean) {
  const id = (s: string) => `ab_${ctx.room.id}_${s}`.slice(0, 24);
  const hasDoor = (s: Side) => ctx.doorsOn(s).length > 0;
  let tubSide: Side | null = null;
  let tubBox: Box | null = null;

  const bathing = half ? 'none' : spec.bathing;
  const placeBathing = (kind: 'tub' | 'tub_shower' | 'shower', role: string): Box | null => {
    const depth = kind === 'shower' ? 3 : kind === 'tub' ? 2.5 : 2.6;
    // Alcove: a short wall between 4'-10" and 6'-3" takes the tub wall to wall.
    const ends = SIDES.filter((s) => !hasDoor(s)).filter((s) => {
      const sf = ctx.frame(s)!;
      const l = sf.b - sf.a;
      return l >= 4.8 && l <= 6.25 && ctx.across(s) >= depth + 2.5;
    });
    for (const s of ends) {
      const sf = ctx.frame(s)!;
      const slot = ctx.wallSlot(s, sf.b - sf.a - 0.02, depth, 1.6);
      if (slot) {
        const box = ctx.wall(id(role), kind, s, slot.u, [sf.b - sf.a - 0.02, depth]);
        if (box) {
          tubSide = s;
          return box;
        }
      }
    }
    // Otherwise along the longest door-free wall, tucked into a corner.
    const w = kind === 'shower' ? 3.5 : 5;
    const d = kind === 'shower' ? 3.5 : depth;
    const order = [...SIDES].sort((a, b) => Number(hasDoor(a)) - Number(hasDoor(b)) || ctx.frame(b)!.b - ctx.frame(b)!.a - (ctx.frame(a)!.b - ctx.frame(a)!.a));
    for (const s of order) {
      const sf = ctx.frame(s)!;
      for (const prefer of [sf.a, sf.b]) {
        const slot = ctx.wallSlot(s, w, d, 1.6, { prefer });
        if (!slot || Math.abs(slot.u - prefer) > w / 2 + 0.1) continue;
        const box = ctx.wall(id(role), kind, s, slot.u, [w, d]);
        if (box) {
          tubSide = s;
          return box;
        }
      }
    }
    return null;
  };

  if (bathing === 'tub_shower') tubBox = placeBathing('tub_shower', 'tub');
  else if (bathing === 'tub') tubBox = placeBathing('tub', 'tub');
  else if (bathing === 'shower') tubBox = placeBathing('shower', 'shower');
  else if (bathing === 'tub_and_shower' && ctx.w * ctx.d < 80) tubBox = placeBathing('shower', 'shower');
  else if (bathing === 'tub_and_shower') {
    // A big bath: a freestanding tub if there's floor for it, and a shower in a corner.
    tubBox = placeBathing('shower', 'shower');
    const big = ctx.w >= 9.5 && ctx.d >= 9.5;
    if (big) {
      for (const [cx, cy] of [
        [ctx.cx, ctx.cy],
        [ctx.cx, ctx.inner.y1 - 2.3],
        [ctx.inner.x1 - 2.3, ctx.cy],
      ]) {
        const facing: Side = ctx.w >= ctx.d ? 'S' : 'E';
        const b = ctx.float(id('tub'), 'freestanding_tub', cx, cy, facing);
        if (b) break;
      }
    } else placeBathing('tub', 'tub2');
  }

  // Wet wall: the stated one, else beside the tub, else any wall without a door.
  const tubAt = tubSide as Side | null;
  const candidates: Side[] = spec.wetWall ? [spec.wetWall] : [];
  for (const s of SIDES) if (!candidates.includes(s) && s !== tubAt && (tubAt === null || s !== OPPOSITE[tubAt])) candidates.push(s);
  for (const s of SIDES) if (!candidates.includes(s)) candidates.push(s);
  candidates.sort((a, b) => (a === spec.wetWall ? -10 : 0) - (b === spec.wetWall ? -10 : 0) || Number(hasDoor(a)) - Number(hasDoor(b)));

  // Toilet: 15" from its centerline to anything beside it, 21" clear in front.
  let toilet: { side: Side; u: number } | null = null;
  for (const s of candidates) {
    const sf = ctx.frame(s)!;
    // Next to the tub when it's on the wet wall's end.
    const prefer = tubBox ? nearestEnd(sf, tubBox) : undefined;
    const slot = ctx.wallSlot(s, 2.5, 2.4, 2.6, { prefer, clear: 1.75 });
    if (!slot) continue;
    if (ctx.wall(id('wc'), 'toilet', s, slot.u)) {
      toilet = { side: s, u: slot.u };
      ctx.keep.push(ctx.strip(sf, slot.u - 1.25, slot.u + 1.25, 0, 2.4 + 1.75));
      break;
    }
  }

  // Vanity: double if asked and it fits, on the wet wall past the toilet if possible.
  const sizes: [string, number, number][] = half
    ? [
        ['vanity', 2.5, 1.6],
        ['vanity', 2, 1.4],
      ]
    : spec.vanity === 'double'
      ? [
          ['vanity_double', 5.5, 1.8],
          ['vanity_double', 5, 1.8],
          ['vanity', 3, 1.8],
          ['vanity', 2.5, 1.7],
          ['vanity', 2, 1.5],
        ]
      : [
          ['vanity', 3, 1.8],
          ['vanity', 2.5, 1.7],
          ['vanity', 2, 1.5],
        ];
  const order = toilet ? [toilet.side, ...candidates.filter((s) => s !== toilet!.side)] : candidates;
  for (const [kind, w, d] of sizes) {
    let done = false;
    for (const s of order) {
      const sf = ctx.frame(s)!;
      const prefer = toilet && s === toilet.side ? (toilet.u > (sf.a + sf.b) / 2 ? sf.a : sf.b) : undefined;
      const slot = ctx.wallSlot(s, w, d, 2.8, { prefer, clear: 2 });
      if (!slot) continue;
      if (ctx.wall(id('vanity'), kind, s, slot.u, [w, d])) {
        done = true;
        break;
      }
    }
    if (done) break;
  }
}

/** The end of a side's span nearer a box (the tub), to put the toilet beside it. */
function nearestEnd(sf: { axis: 'x' | 'y'; a: number; b: number }, box: Box): number {
  const lo = sf.axis === 'x' ? box.x0 : box.y0;
  const hi = sf.axis === 'x' ? box.x1 : box.y1;
  return Math.abs(lo - sf.a) < Math.abs(sf.b - hi) ? Math.max(sf.a, hi) + 1.25 : Math.min(sf.b, lo) - 1.25;
}
