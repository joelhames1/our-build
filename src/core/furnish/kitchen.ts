import type { KitchenSpec, Side } from '../model/schema';
import { OPPOSITE } from '../geometry/fixtures';
import { type Interval, type RoomCtx, SIDES, subtract } from './context';

const COUNTER = 2;
const AISLE = 3.5;
const SINK_W = 2.75;
const DW_W = 2;
const RANGE_W = 2.5;
const FRIDGE_W = 3;
const NEXT: Record<Side, Side> = { N: 'E', E: 'S', S: 'W', W: 'N' };
const PREV: Record<Side, Side> = { N: 'W', W: 'S', S: 'E', E: 'N' };

interface Run {
  side: Side;
  /** Free stretches along the side for counters (corners already taken out). */
  ivs: Interval[];
  /** What's reserved for appliances, by [a, b] along the side. */
  taken: { a: number; b: number; what: 'sink' | 'dw' | 'range' | 'fridge' }[];
}

const len = (ivs: Interval[]) => ivs.reduce((s, [a, b]) => s + (b - a), 0);

/**
 * Lay out a kitchen from its spec: cabinet runs on the chosen walls, sink under a window when there is
 * one, dishwasher beside it, range on another leg with counter both sides, fridge at the end of a run,
 * uppers over the counters (never over windows), and an island with a 42" aisle when there's room.
 */
export function kitchen(ctx: RoomCtx, spec: KitchenSpec) {
  const id = (s: string) => `ak_${ctx.room.id}_${s}`.slice(0, 24);
  const avail = new Map(SIDES.map((s) => [s, ctx.freeAlong(s, COUNTER, 3).filter(([a, b]) => b - a >= 2)]));
  const total = (s: Side) => len(avail.get(s)!);

  const sides = chooseWalls(ctx, spec, total);
  if (!sides.length) return;

  // Runs in order; a later run on an adjacent wall starts past the earlier run's counter.
  const runs: Run[] = [];
  for (const side of sides) {
    let ivs = avail.get(side)!;
    for (const r of runs) {
      if (r.side !== NEXT[side] && r.side !== PREV[side]) continue;
      const sf = ctx.frame(r.side)!;
      const p0 = sf.face;
      const p1 = sf.face + sf.into * COUNTER;
      ivs = subtract(ivs, Math.min(p0, p1) - 0.01, Math.max(p0, p1));
    }
    ivs = ivs.filter(([a, b]) => b - a >= 1.5);
    if (ivs.length) runs.push({ side, ivs, taken: [] });
  }
  if (!runs.length) return;
  const islandSink = spec.sink === 'island';
  const islandRange = spec.range === 'island';
  const fits = (r: Run, a: number, b: number) => r.ivs.some(([x, y]) => a >= x - 1e-6 && b <= y + 1e-6) && !r.taken.some((t) => a < t.b - 1e-6 && t.a < b - 1e-6);
  const reserve = (r: Run, a: number, b: number, what: Run['taken'][number]['what']) => r.taken.push({ a, b, what });

  const counterLen = runs.reduce((s, r) => s + len(r.ivs), 0);
  // Small kitchens get apartment-size appliances and skip the dishwasher before they skip the range.
  const small = counterLen < 10;
  let sinkW = small ? 2 : SINK_W;

  // Sink: under a window if any run has one, otherwise mid-run on the longest stretch that takes it.
  let sinkAt: { r: Run; c: number } | null = null;
  if (!islandSink) {
    const pref = spec.sink && spec.sink !== 'island' ? runs.filter((r) => r.side === spec.sink) : runs;
    const list = pref.length ? pref : runs;
    for (const w of small ? [2] : [SINK_W, 2.25, 2]) {
      for (const r of list) {
        for (const win of ctx.windowsOn(r.side)) {
          const c = (win.u0 + win.u1) / 2;
          for (const dc of [0, -0.5, 0.5, -1, 1]) {
            if (!sinkAt && fits(r, c + dc - w / 2, c + dc + w / 2)) sinkAt = { r, c: c + dc };
          }
        }
      }
      if (!sinkAt) {
        const all = list.flatMap((r) => r.ivs.map((iv) => ({ r, iv }))).sort((p, q) => q.iv[1] - q.iv[0] - (p.iv[1] - p.iv[0]));
        const hit = all.find(({ iv }) => iv[1] - iv[0] >= w);
        if (hit) sinkAt = { r: hit.r, c: (hit.iv[0] + hit.iv[1]) / 2 };
      }
      if (sinkAt) {
        sinkW = w;
        break;
      }
    }
    if (sinkAt) {
      reserve(sinkAt.r, sinkAt.c - sinkW / 2, sinkAt.c + sinkW / 2, 'sink');
      // Dishwasher on whichever side of the sink has room, preferring away from the nearest run end.
      const r = sinkAt.r;
      const right: [number, number] = [sinkAt.c + sinkW / 2, sinkAt.c + sinkW / 2 + DW_W];
      const left: [number, number] = [sinkAt.c - sinkW / 2 - DW_W, sinkAt.c - sinkW / 2];
      const iv = r.ivs.find(([a, b]) => sinkAt!.c >= a && sinkAt!.c <= b)!;
      const order = sinkAt.c - iv[0] > iv[1] - sinkAt.c ? [left, right] : [right, left];
      const dw = small ? undefined : order.find(([a, b]) => fits(r, a, b));
      if (dw) reserve(r, dw[0], dw[1], 'dw');
    }
  }

  // Fridge: at the open end of a run (not tucked in a corner), before the range takes the middle.
  let fridgeAt: { r: Run; c: number; w: number } | null = null;
  for (const fw of small ? [2.5, 2] : [FRIDGE_W, 2.5]) {
    let best: { r: Run; c: number; w: number; score: number } | null = null;
    const pref = spec.fridge ? runs.filter((r) => r.side === spec.fridge) : runs;
    for (const r of pref.length ? pref : runs) {
      for (const [a, b] of r.ivs) {
        for (const [x0, x1] of [
          [a, a + fw],
          [b - fw, b],
        ]) {
          if (x1 - x0 > b - a || !fits(r, x0, x1)) continue;
          const c = (x0 + x1) / 2;
          // An end that meets another run is a corner: fridges there block the counter.
          const cornerEnd = runs.some((o) => o !== r && (o.side === NEXT[r.side] || o.side === PREV[r.side]) && Math.abs(cornerCoord(ctx, o.side) - (x0 === a ? a : b)) < COUNTER + 0.2);
          const score = (cornerEnd ? 0 : 3) + (r !== sinkAt?.r ? 1 : 0);
          if (!best || score > best.score) best = { r, c, w: fw, score };
        }
      }
    }
    if (best) {
      fridgeAt = best;
      reserve(best.r, best.c - fw / 2, best.c + fw / 2, 'fridge');
      break;
    }
  }

  // Range: on another leg if there is one, with counter on each side (15" if it can).
  let rangeAt: { r: Run; c: number; w: number } | null = null;
  const findRange = () => {
    const pref = spec.range && spec.range !== 'island' ? runs.filter((r) => r.side === spec.range) : [...runs.filter((r) => r !== sinkAt?.r), ...runs.filter((r) => r === sinkAt?.r)];
    for (const [w, side] of [
      [RANGE_W, 1.25],
      [RANGE_W, 0.5],
      [2, 0.25],
    ]) {
      for (const r of pref.length ? pref : runs) {
        let free: Interval[] = r.ivs;
        for (const t of r.taken) free = subtract(free, t.a - (r === sinkAt?.r ? side : 0), t.b + (r === sinkAt?.r ? side : 0));
        const best = free.filter(([a, b]) => b - a >= w + 2 * side).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
        if (best) return { r, c: (best[0] + best[1]) / 2, w };
      }
    }
    return null;
  };
  if (!islandRange) {
    rangeAt = findRange();
    if (!rangeAt) {
      // Give up the dishwasher before the range.
      for (const r of runs) r.taken = r.taken.filter((t) => t.what !== 'dw');
      rangeAt = findRange();
    }
    if (rangeAt) reserve(rangeAt.r, rangeAt.c - rangeAt.w / 2, rangeAt.c + rangeAt.w / 2, 'range');
  }

  // Place appliances, then fill each run with base cabinets.
  if (sinkAt) ctx.wall(id('sink'), 'sink', sinkAt.r.side, sinkAt.c, [sinkW, COUNTER]);
  for (const r of runs) for (const t of r.taken.filter((x) => x.what === 'dw')) ctx.wall(id('dw'), 'dishwasher', r.side, (t.a + t.b) / 2, [DW_W, COUNTER]);
  if (rangeAt) {
    ctx.wall(id('range'), 'range', rangeAt.r.side, rangeAt.c, [rangeAt.w, COUNTER + 0.1]);
    ctx.wall(id('hood'), 'hood', rangeAt.r.side, rangeAt.c, [rangeAt.w + 0.25, 1.6]);
  }
  if (fridgeAt) ctx.wall(id('fridge'), 'fridge', fridgeAt.r.side, fridgeAt.c, [fridgeAt.w, 2.6]);
  let nb = 0;
  let nu = 0;
  for (const r of runs) {
    let base: Interval[] = r.ivs;
    for (const t of r.taken) base = subtract(base, t.a, t.b);
    for (const [a, b] of base) if (b - a >= 0.75) ctx.wall(id(`b${++nb}`), 'base_cabinet', r.side, (a + b) / 2, [b - a, COUNTER]);
    // Uppers over counters, sink and dishwasher; not over the range (hood), fridge or windows.
    let over: Interval[] = r.ivs;
    for (const t of r.taken) if (t.what === 'range' || t.what === 'fridge') over = subtract(over, t.a - 0.05, t.b + 0.05);
    const wallOk = ctx.freeAlong(r.side, 1.1, 2.5, 4.5);
    for (const [a, b] of over) {
      for (const [x, y] of wallOk) {
        const lo = Math.max(a, x);
        const hi = Math.min(b, y);
        if (hi - lo >= 1.25) ctx.wall(id(`u${++nu}`), 'upper_cabinet', r.side, (lo + hi) / 2, [hi - lo, 1.1]);
      }
    }
  }

  // Island: parallel to the main run, a 42" aisle out from the counter.
  const wantIsland = spec.island || islandSink || islandRange;
  if (wantIsland && spec.shape !== 'galley') island(ctx, spec, runs, id, islandSink, islandRange);
}

function cornerCoord(ctx: RoomCtx, side: Side): number {
  return ctx.frame(side)!.face;
}

function island(ctx: RoomCtx, spec: KitchenSpec, runs: Run[], id: (s: string) => string, sink: boolean, range: boolean) {
  const main = runs.reduce((p, q) => (len(q.ivs) > len(p.ivs) ? q : p));
  const sf = ctx.frame(main.side)!;
  const seats = spec.seats ?? undefined;
  const deep = spec.islandSize?.[1] ?? (seats !== 0 || sink ? 3.5 : 3);
  const span: [number, number] = [Math.min(...main.ivs.map((i) => i[0])), Math.max(...main.ivs.map((i) => i[1]))];
  // Legs of an L or U stick out from the walls at the ends of the main run.
  const legs = runs.filter((r) => r !== main);
  let a = sf.a + 3;
  let b = sf.b - 3;
  for (const r of legs) {
    const lf = ctx.frame(r.side)!;
    const edge = lf.face + lf.into * (COUNTER + AISLE);
    if (lf.into > 0) a = Math.max(a, edge);
    else b = Math.min(b, edge);
  }
  const near = COUNTER + AISLE;
  const acrossRoom = ctx.across(main.side);
  // Behind the island: 3' to a wall, or just a foot if that side is open to the next room.
  const farSide = OPPOSITE[main.side];
  const farOpen = ctx.solid(farSide).reduce((s, [x, y]) => s + (y - x), 0) < 0.5 * (sf.b - sf.a);
  const behind = farOpen ? 1 : 3;
  if (acrossRoom < near + deep + behind) return;
  const want = spec.islandSize?.[0] ?? Math.min(8, Math.max(4, span[1] - span[0] - 2));
  const mid = (Math.max(a, span[0]) + Math.min(b, span[1])) / 2;
  for (let L = Math.min(want, b - a); L >= 4; L -= 0.5) {
    const c = Math.min(Math.max(mid, a + L / 2), b - L / 2);
    const [cx, cy] = ctx.point(main.side, c, near + deep / 2);
    const facing = OPPOSITE[main.side];
    const box = ctx.float(id('island'), 'island', cx, cy, facing, [L, deep]);
    if (!box) continue;
    if (sink) ctx.float(id('isink'), 'island_sink', ...ctx.point(main.side, range ? c - L / 4 : c, near + 0.9), facing);
    if (range) ctx.float(id('icook'), 'island_cooktop', ...ctx.point(main.side, sink ? c + L / 4 : c, near + 0.9), facing);
    // Stools along the far side, tucked under the overhang.
    const n = seats ?? Math.max(0, Math.floor(L / 2.1));
    for (let k = 0; k < n; k++) {
      const u = c - L / 2 + (L / n) * (k + 0.5);
      const [sx, sy] = ctx.point(main.side, u, near + deep + 0.45);
      ctx.float(id(`s${k + 1}`), 'bar_stool', sx, sy, main.side);
    }
    return;
  }
}

function chooseWalls(ctx: RoomCtx, spec: KitchenSpec, total: (s: Side) => number): Side[] {
  if (spec.walls?.length) return spec.walls.filter((s) => total(s) >= 2);
  // A sink, a range and a fridge need about 8'-6" of wall; if the asked-for shape can't give that, use more walls.
  const sum = (ss: Side[]) => ss.reduce((a, s) => a + total(s), 0);
  const first = shapeWalls(ctx, spec.shape, total);
  if (sum(first) >= 8.5) return first;
  // Walls broken up by doors make poor runs: count each extra piece against a shape.
  const pieces = (ss: Side[]) => ss.reduce((a, s) => a + Math.max(0, ctx.freeAlong(s, COUNTER, 3).filter(([x, y]) => y - x >= 2).length - 1), 0);
  const score = (ss: Side[]) => sum(ss) - 4 * pieces(ss) - ss.length;
  const more = (['L', 'galley', 'U'] as const).map((sh) => shapeWalls(ctx, sh, total)).filter((ss) => sum(ss) > sum(first));
  const enough = more.filter((ss) => sum(ss) >= 8.5);
  return (enough.length ? enough : more).sort((a, b) => score(b) - score(a))[0] ?? first;
}

function shapeWalls(ctx: RoomCtx, shape: KitchenSpec['shape'], total: (s: Side) => number): Side[] {
  const ok = (s: Side, min: number) => total(s) >= min;
  const single = (): Side[] => {
    const best = [...SIDES].sort((a, b) => total(b) - total(a))[0];
    return total(best) >= 3 ? [best] : [];
  };
  const L = (): Side[] => {
    let best: Side[] = [];
    let score = 0;
    for (const s of SIDES) {
      const t = NEXT[s];
      if (!ok(s, 4) || !ok(t, 4)) continue;
      const sc = total(s) + total(t);
      if (sc > score) {
        score = sc;
        best = total(s) >= total(t) ? [s, t] : [t, s];
      }
    }
    return best.length ? best : single();
  };
  switch (shape) {
    case 'single_wall':
      return single();
    case 'galley': {
      const pairs: Side[][] = [
        ['N', 'S'],
        ['E', 'W'],
      ];
      const fit = pairs.filter(([a, b]) => ok(a, 3) && ok(b, 3) && ctx.across(a) >= 2 * COUNTER + 3);
      if (!fit.length) return L();
      return fit.sort((p, q) => total(q[0]) + total(q[1]) - total(p[0]) - total(p[1]))[0];
    }
    case 'U': {
      let best: Side[] = [];
      let score = 0;
      for (const m of SIDES) {
        const l1 = PREV[m];
        const l2 = NEXT[m];
        if (!ok(m, 4) || !ok(l1, 3) || !ok(l2, 3) || ctx.across(l1) < 2 * COUNTER + AISLE + 0.5) continue;
        const sc = total(m) + total(l1) + total(l2);
        if (sc > score) {
          score = sc;
          best = [m, l1, l2];
        }
      }
      return best.length ? best : L();
    }
    default:
      return L();
  }
}
