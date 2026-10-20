import { type SymbolPrim, fixtureSymbol } from '@/core/catalog/symbols';
import { labelFit } from '@/core/geometry/labels';
import type { ResolvedOpening } from '@/core/geometry/openings';
import { porchFrame } from '@/core/geometry/porch';
import { type Box, type MultiPoly, difference, multiArea, union } from '@/core/geometry/polygon';
import type { ResolvedStair } from '@/core/geometry/stairs';
import { wallUnion } from '@/core/geometry/walls';
import { isDoorType, isOutdoor, isWindowType } from '@/core/model/schema';
import { dims, ftIn } from '@/core/model/units';
import type { Resolved, ResolvedLevel } from '@/core/resolve';
import { type Drawing, type Layer, Pad, type Pen } from './ir';
import type { SectionCut } from './section';

/** Height above the floor where the plan slices the walls. */
export const PLAN_CUT = 4;

const EQUIPMENT = /^(base_cabinet|upper_cabinet|sink|island|island_sink|island_cooktop|range|hood|fridge|dishwasher|pantry_cabinet|toilet|vanity|vanity_double|tub|tub_shower|shower|freestanding_tub|washer|dryer|utility_sink|closet_shelving|pantry_shelving)$/;

export interface PlanOptions {
  /** Section cuts to mark, with the label and sheet each refers to. */
  cuts?: { cut: SectionCut; label: string; sheet: string }[];
  /** Door and window marks by opening id (they key into the schedules). */
  marks?: Map<string, string>;
}

/** A floor plan of one level at the given scale (feet per paper inch). */
export function floorPlan(res: Resolved, levelIndex: number, scale: number, opts: PlanOptions = {}): Drawing {
  const rl = res.levels[levelIndex];
  const pad = new Pad(scale);

  // Outdoor floors get a light tone so porches and decks read as outside.
  for (const info of rl.rooms.values()) {
    if (isOutdoor(info.room.type)) {
      pad.fill([info.ring], 'deck', 'A-FLOR-OTLN');
      pad.line(info.ring, 'medium', 'A-FLOR-OTLN', true);
    }
  }
  roofsSeen(pad, res, rl);
  for (const f of rl.fixtures) symbol(pad, fixtureSymbol(f), EQUIPMENT.test(f.kind) ? 'A-EQPM' : 'A-FURN');
  for (const s of rl.stairHoles) stair(pad, s, 'DN', true);
  for (const s of rl.stairs) stair(pad, s, 'UP', false);
  chimney(pad, res, rl);

  // Walls sliced at 4': solid poché with a heavy outline, open where doors and windows cross the cut.
  const holes: Box[] = rl.openings
    .filter((o) => o.type !== 'open' && o.sill < PLAN_CUT && o.head > PLAN_CUT)
    .map((o) => (o.axis === 'x' ? { x0: o.u0, x1: o.u1, y0: o.wall.coord - o.wall.thickness, y1: o.wall.coord + o.wall.thickness } : { y0: o.u0, y1: o.u1, x0: o.wall.coord - o.wall.thickness, x1: o.wall.coord + o.wall.thickness }));
  const walls = wallUnion(rl.walls, holes);
  for (const poly of walls) {
    pad.fill(poly as [number, number][][], 'poche', 'A-WALL-PATT');
    for (const ring of poly) pad.line(ring as [number, number][], 'cut', 'A-WALL', true);
  }
  for (const w of rl.walls) if (w.kind === 'railing') pad.seg(w.axis === 'x' ? [w.a, w.coord] : [w.coord, w.a], w.axis === 'x' ? [w.b, w.coord] : [w.coord, w.b], 'medium', 'A-WALL');
  for (const { posts } of porchFrame(rl)) for (const b of posts) {
    const ring: [number, number][] = [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x1, b.y1],
      [b.x0, b.y1],
    ];
    pad.fill([ring], 'poche', 'A-WALL-PATT');
    pad.line(ring, 'cut', 'A-WALL', true);
  }
  for (const o of rl.openings) opening(pad, o);

  if (opts.marks) for (const o of rl.openings) if (opts.marks.has(o.id)) tag(pad, o, opts.marks.get(o.id)!);
  labels(pad, rl);
  dimensions(pad, res, rl);
  for (const c of opts.cuts ?? []) sectionMark(pad, res, c.cut, c.label, c.sheet);
  northArrow(pad, res);
  return { id: `plan-${rl.level.id}`, title: `${rl.level.name} Plan`, scale, items: pad.items };
}

// --- pieces -------------------------------------------------------------------------------------

function symbol(pad: Pad, prims: SymbolPrim[], layer: Layer) {
  const pen: Record<'outline' | 'detail' | 'hidden', Pen> = { outline: 'medium', detail: 'fine', hidden: 'hidden' };
  for (const p of prims) {
    if (p.t === 'text') pad.text(p.at, p.text, 1 / 16, layer, { align: 'center' });
    else if (p.t === 'circle') pad.circle(p.c, p.r, pen[p.pen], layer, p.fill === 'tone' ? 'tone' : undefined);
    else {
      if (p.closed && p.fill === 'tone') pad.fill([p.pts], 'tone', layer);
      pad.line(p.pts, pen[p.pen], layer, p.closed);
    }
  }
}

function opening(pad: Pad, o: ResolvedOpening) {
  const t = o.wall.thickness;
  const c = o.wall.coord;
  const along = (u: number, n: number): [number, number] => (o.axis === 'x' ? [u, c + n] : [c + n, u]);
  if (isWindowType(o.type)) {
    if (!(o.sill < PLAN_CUT && o.head > PLAN_CUT)) {
      // Above or below the cut (high windows, transoms): dashed.
      pad.seg(along(o.u0, 0), along(o.u1, 0), 'hidden', 'A-GLAZ');
      return;
    }
    for (const n of [-t / 2, t / 2]) pad.seg(along(o.u0, n), along(o.u1, n), 'fine', 'A-GLAZ');
    pad.seg(along(o.u0, 0), along(o.u1, 0), 'medium', 'A-GLAZ');
    // Mullions between units of a group.
    for (let k = 1; k < o.count; k++) {
      const u = o.u0 + k * ((o.u1 - o.u0) / o.count);
      pad.seg(along(u, -t / 2), along(u, t / 2), 'fine', 'A-GLAZ');
    }
    return;
  }
  if (!isDoorType(o.type)) return;
  const face = o.swingTo * (t / 2);
  if (o.type === 'garage_door') {
    pad.seg(along(o.u0, 0), along(o.u1, 0), 'hidden', 'A-DOOR');
    pad.seg(along(o.u0, -o.swingTo * 0.1), along(o.u1, -o.swingTo * 0.1), 'fine', 'A-DOOR');
    return;
  }
  if (o.type === 'slider') {
    const mid = (o.u0 + o.u1) / 2;
    pad.rect(...along(o.u0, -0.08), ...along(mid + 0.15, 0.02), 'medium', 'A-DOOR');
    pad.rect(...along(mid - 0.15, -0.02), ...along(o.u1, 0.08), 'medium', 'A-DOOR');
    return;
  }
  if (o.type === 'pocket_door') {
    pad.seg(along(o.u0, 0), along(o.u1, 0), 'medium', 'A-DOOR');
    pad.seg(along(o.u1, 0), along(o.u1 + (o.u1 - o.u0), 0), 'hidden', 'A-DOOR');
    return;
  }
  // Swinging leaves: the leaf drawn open at 90°, and the arc it sweeps.
  const leaves = o.type === 'double_door' || o.type === 'french_door' ? 2 : 1;
  const w = (o.u1 - o.u0) / leaves;
  for (let k = 0; k < leaves; k++) {
    const hinge = leaves === 2 ? (k === 0 ? o.u0 : o.u1) : o.hinge === 'u0' ? o.u0 : o.u1;
    const dir = hinge === o.u0 ? 1 : -1;
    const h = along(hinge, face);
    const open = along(hinge, face + o.swingTo * w);
    pad.seg(h, open, 'medium', 'A-DOOR');
    // Arc from the open leaf back to the closed position.
    const a0 = Math.atan2(open[1] - h[1], open[0] - h[0]);
    const closed = along(hinge + dir * w, face);
    const a1 = Math.atan2(closed[1] - h[1], closed[0] - h[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    pad.arc(h, w, da > 0 ? a0 : a1, da > 0 ? a1 : a0, 'fine', 'A-DOOR');
  }
}

function stair(pad: Pad, s: ResolvedStair, label: 'UP' | 'DN', below: boolean) {
  const f = s.footprint;
  for (const st of s.steps) {
    const b = st.box;
    // Treads past the cut are drawn dashed on the floor they start from (they're above the slice).
    const hidden = !below && st.top > PLAN_CUT;
    pad.rect(b.x0, b.y0, b.x1, b.y1, hidden ? 'hidden' : 'fine', 'A-FLOR-STRS');
  }
  for (const l of s.landings) pad.rect(l.box.x0, l.box.y0, l.box.x1, l.box.y1, 'fine', 'A-FLOR-STRS');
  pad.rect(f.x0, f.y0, f.x1, f.y1, below ? 'cut' : 'medium', 'A-FLOR-STRS');
  // Walking line with an arrow pointing the way it goes.
  const pts: [number, number][] = [];
  for (const fl of s.flights) {
    const b = fl.box;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const a: [number, number] = fl.dx > 0 ? [b.x0 + 0.4, cy] : fl.dx < 0 ? [b.x1 - 0.4, cy] : fl.dy > 0 ? [cx, b.y0 + 0.4] : [cx, b.y1 - 0.4];
    const e: [number, number] = fl.dx > 0 ? [b.x1 - 0.4, cy] : fl.dx < 0 ? [b.x0 + 0.4, cy] : fl.dy > 0 ? [cx, b.y1 - 0.4] : [cx, b.y0 + 0.4];
    pts.push(a, e);
  }
  if (pts.length < 2) return;
  const path = label === 'DN' ? [...pts].reverse() : pts;
  pad.line(path, 'fine', 'A-FLOR-STRS');
  const [ex, ey] = path[path.length - 1];
  const [px, py] = path[path.length - 2];
  const len = Math.hypot(ex - px, ey - py) || 1;
  const ux = (ex - px) / len;
  const uy = (ey - py) / len;
  const hs = pad.p(0.06);
  pad.line(
    [
      [ex - ux * hs * 1.6 - uy * hs, ey - uy * hs * 1.6 + ux * hs],
      [ex, ey],
      [ex - ux * hs * 1.6 + uy * hs, ey - uy * hs * 1.6 - ux * hs],
    ],
    'fine',
    'A-FLOR-STRS',
  );
  pad.circle(path[0], pad.p(0.02), 'fine', 'A-FLOR-STRS', 'poche');
  const [sx, sy] = path[0];
  pad.text([sx, sy - (label === 'UP' ? pad.p(0.14) : -pad.p(0.06))], label, 3 / 32, 'A-ANNO-TEXT', { align: 'center', font: 'sans', bold: true });
}

function chimney(pad: Pad, res: Resolved, rl: ResolvedLevel) {
  const ch = res.chimney;
  if (!ch) return;
  const z = rl.elevation + PLAN_CUT;
  const blk = ch.blocks.find((b) => b.z0 <= z && b.z1 > z && (b.part === 'base' || b.part === 'stack'));
  if (!blk) return;
  const b = blk.box;
  const ring: [number, number][] = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ];
  pad.fill([ring], 'tone', 'A-WALL-PATT');
  pad.line(ring, 'cut', 'A-WALL', true);
  for (const [a, c] of hatch(b, pad.p(0.08))) pad.seg(a, c, 'fine', 'A-WALL-PATT');
}

/** 45° hatch lines across a box, `gap` apart. */
export function hatch(b: Box, gap: number): [[number, number], [number, number]][] {
  const out: [[number, number], [number, number]][] = [];
  // Lines y = x + k, clipped to the box.
  for (let k = b.y0 - b.x1 + gap; k < b.y1 - b.x0; k += gap) {
    const x0 = Math.max(b.x0, b.y0 - k);
    const x1 = Math.min(b.x1, b.y1 - k);
    if (x1 - x0 > 1e-6) out.push([
      [x0, x0 + k],
      [x1, x1 + k],
    ]);
  }
  return out;
}

/** The roof edge overhead (dashed) and, from upstairs, the lower roofs below (fine). */
function roofsSeen(pad: Pad, res: Resolved, rl: ResolvedLevel) {
  const own = res.roof.faces.filter((f) => f.level === rl.roofLevel);
  if (own.length) {
    const outline = union(...own.map((f) => f.visible));
    const inside = difference(outline, rl.footprint);
    if (multiArea(inside) > 1) for (const poly of outline) for (const ring of poly) pad.line(ring as [number, number][], 'hidden', 'A-ROOF', true);
  }
  for (const f of res.roof.faces) {
    if (f.level >= rl.index) continue;
    const seen: MultiPoly = difference(f.visible, rl.footprint);
    for (const poly of seen) for (const ring of poly) pad.line(ring as [number, number][], 'fine', 'A-ROOF', true);
  }
}

// --- labels, dimensions, north ------------------------------------------------------------------

/** A mark keyed to the schedules: windows in a box outside the wall, doors in a circle on the side away from the swing. */
function tag(pad: Pad, o: ResolvedOpening, text: string) {
  const door = isDoorType(o.type) || o.type === 'cased_opening';
  if (!door && !isWindowType(o.type)) return;
  const t = o.wall.thickness;
  const out = o.wall.kind === 'exterior' ? (o.wall.outside === 0 ? -o.hostSign : o.wall.outside) : door ? -o.swingTo : -o.hostSign;
  const side = door ? (o.wall.kind === 'exterior' ? out : -o.swingTo) : out;
  const size = 0.065;
  const hw = Math.max(pad.p(0.09), (text.length * pad.p(size) * 0.62) / 2 + pad.p(0.03));
  const hh = pad.p(0.065);
  const n = o.wall.coord + side * (t / 2 + pad.p(door ? 0.13 : 0.15));
  const u = (o.u0 + o.u1) / 2;
  const c: [number, number] = o.axis === 'x' ? [u, n] : [n, u];
  if (door) pad.circle(c, hw, 'fine', 'A-ANNO-SYMB', 'white');
  else {
    const ring: [number, number][] = [
      [c[0] - hw, c[1] - hh],
      [c[0] + hw, c[1] - hh],
      [c[0] + hw, c[1] + hh],
      [c[0] - hw, c[1] + hh],
    ];
    pad.fill([ring], 'white', 'A-ANNO-SYMB');
    pad.line(ring, 'fine', 'A-ANNO-SYMB', true);
  }
  pad.text([c[0], c[1] - pad.p(size * 0.36)], text, size, 'A-ANNO-SYMB', { align: 'center', font: 'sans' });
}

/** The section line across the plan with a bubble and arrow at each end. */
function sectionMark(pad: Pad, res: Resolved, cut: SectionCut, label: string, sheet: string) {
  // Beyond the dimension strings.
  const b = outerBounds(res);
  const ext = pad.p(1.08);
  const r = pad.p(0.17);
  const [lo, hi] = cut.axis === 'x' ? [b.y0 - ext, b.y1 + ext] : [b.x0 - ext, b.x1 + ext];
  const P = (s: number, n = 0): [number, number] => (cut.axis === 'x' ? [cut.at + n, s] : [s, cut.at + n]);
  pad.seg(P(lo + r), P(hi - r), 'cutline', 'A-ANNO-SYMB');
  for (const end of [lo, hi]) {
    const c = P(end);
    pad.circle(c, r, 'medium', 'A-ANNO-SYMB', 'white');
    pad.seg([c[0] - r, c[1]], [c[0] + r, c[1]], 'fine', 'A-ANNO-SYMB');
    // Arrowhead pointing the way the section looks.
    const tip = P(end, cut.look * r * 1.9);
    const w = r * 0.75;
    const base0 = P(end + w, cut.look * r * 0.55);
    const base1 = P(end - w, cut.look * r * 0.55);
    pad.fill([[base0, tip, base1]], 'poche', 'A-ANNO-SYMB');
    pad.text([c[0], c[1] + pad.p(0.025)], label, 0.1, 'A-ANNO-SYMB', { align: 'center', font: 'sans', bold: true });
    pad.text([c[0], c[1] - pad.p(0.1)], sheet, 0.065, 'A-ANNO-SYMB', { align: 'center', font: 'sans' });
  }
}

function labels(pad: Pad, rl: ResolvedLevel) {
  const swings: Box[] = rl.openings
    .filter((o) => isDoorType(o.type) && o.type !== 'garage_door' && o.type !== 'slider' && o.type !== 'pocket_door')
    .map((o) => {
      const face = o.wall.coord + o.swingTo * (o.wall.thickness / 2);
      const far = face + o.swingTo * (o.u1 - o.u0);
      const [lo, hi] = face < far ? [face, far] : [far, face];
      return o.axis === 'x' ? { x0: o.u0, x1: o.u1, y0: lo, y1: hi } : { y0: o.u0, y1: o.u1, x0: lo, x1: hi };
    });
  for (const info of rl.rooms.values()) {
    if (info.room.type === 'open_to_below') continue;
    const outdoor = isOutdoor(info.room.type);
    const name = info.room.name.toUpperCase();
    const size = dims(info.clearW, info.clearD);
    const obstacles = [...rl.fixtures.filter((f) => f.room === info.room.id && !f.kind.startsWith('rug')).map((f) => f.box), ...rl.stairs.map((s) => s.footprint), ...rl.stairHoles.map((s) => s.footprint), ...swings];
    const room = info.inner;
    const roomW = room.x1 - room.x0;
    // Name at 1/8", size at 3/32"; smaller in tight rooms.
    let k = 1;
    const width = (k: number) => Math.max(name.length * pad.p(0.125 * k) * 0.72, size.length * pad.p(0.09 * k) * 0.5) + pad.p(0.05);
    while (k > 0.6 && width(k) > roomW) k -= 0.1;
    let fit = labelFit(room, obstacles, Math.min(width(k), roomW), pad.p(0.3 * k));
    if (fit.covered > 0.05 && k > 0.7) {
      const f2 = labelFit(room, obstacles, Math.min(width(k * 0.8), roomW), pad.p(0.3 * k * 0.8));
      if (f2.covered < fit.covered) {
        fit = f2;
        k *= 0.8;
      }
    }
    const [x, y] = fit.at;
    pad.text([x, y + pad.p(0.02 * k)], name, 0.125 * k, 'A-AREA-IDEN', { align: 'center', font: 'serif' });
    if (!outdoor) pad.text([x, y - pad.p(0.11 * k)], size, 0.09 * k, 'A-AREA-IDEN', { align: 'center', font: 'sans' });
  }
}

/**
 * Two strings of dimensions on each side: to the corners and the centers of doors and windows,
 * then overall. Measured to the outside face of the walls.
 */
function dimensions(pad: Pad, res: Resolved, rl: ResolvedLevel) {
  const shell = union(rl.footprint, wallUnion(rl.walls.filter((w) => w.kind === 'exterior')));
  // Porches and chimneys stick out past the walls: start the strings beyond them.
  dimensionsAround(pad, shell, {
    out: outerBounds(res),
    extra: (axis, dir) => {
      const at: number[] = [];
      for (const o of rl.openings) {
        if (!o.exterior || o.axis !== axis || o.type === 'open') continue;
        const outward = o.wall.outside === 0 ? -o.hostSign : o.wall.outside;
        if (outward === dir) at.push((o.u0 + o.u1) / 2);
      }
      return at;
    },
  });
}

/** Everything on the ground: rooms, porches and the chimney. */
function outerBounds(res: Resolved): Box {
  const out = { ...res.bounds };
  for (const b of res.chimney?.blocks ?? []) {
    out.x0 = Math.min(out.x0, b.box.x0);
    out.x1 = Math.max(out.x1, b.box.x1);
    out.y0 = Math.min(out.y0, b.box.y0);
    out.y1 = Math.max(out.y1, b.box.y1);
  }
  return out;
}

/** Corner-to-corner (plus any extra stops) and overall dimension strings on all four sides of a shape. */
export function dimensionsAround(pad: Pad, shape: MultiPoly, opts: { out?: Box; extra?: (axis: 'x' | 'y', dir: number) => number[] } = {}) {
  if (!shape.length) return;
  const pts = shape.flatMap((poly) => poly[0]);
  const bx0 = Math.min(...pts.map((p) => p[0]));
  const bx1 = Math.max(...pts.map((p) => p[0]));
  const by0 = Math.min(...pts.map((p) => p[1]));
  const by1 = Math.max(...pts.map((p) => p[1]));
  const out = opts.out ?? { x0: bx0, y0: by0, x1: bx1, y1: by1 };
  const sides = [
    { axis: 'x' as const, at: Math.min(by0, out.y0), dir: -1, lo: bx0, hi: bx1 },
    { axis: 'x' as const, at: Math.max(by1, out.y1), dir: 1, lo: bx0, hi: bx1 },
    { axis: 'y' as const, at: Math.min(bx0, out.x0), dir: -1, lo: by0, hi: by1 },
    { axis: 'y' as const, at: Math.max(bx1, out.x1), dir: 1, lo: by0, hi: by1 },
  ];
  for (const s of sides) {
    const breaks = new Set<number>();
    for (const [x, y] of pts) breaks.add(Math.round((s.axis === 'x' ? x : y) * 96) / 96);
    for (const v of opts.extra?.(s.axis, s.dir) ?? []) breaks.add(Math.round(v * 96) / 96);
    const sorted = [...breaks].filter((v) => v >= s.lo - 1e-6 && v <= s.hi + 1e-6).sort((a, b) => a - b);
    const merged: number[] = [];
    for (const v of sorted) if (!merged.length || v - merged[merged.length - 1] > 0.4) merged.push(v);
    const off1 = s.at + s.dir * pad.p(0.45);
    const off2 = s.at + s.dir * pad.p(0.8);
    if (merged.length > 2) chain(pad, merged, s.axis, off1, s.dir);
    chain(pad, [s.lo, s.hi], s.axis, merged.length > 2 ? off2 : off1, s.dir);
  }
}

function chain(pad: Pad, at: number[], axis: 'x' | 'y', line: number, dir: number) {
  const P = (u: number, n: number): [number, number] => (axis === 'x' ? [u, n] : [n, u]);
  const ext = pad.p(0.06);
  pad.seg(P(at[0] - ext, line), P(at[at.length - 1] + ext, line), 'dim', 'A-ANNO-DIMS');
  const tick = pad.p(0.05);
  for (const u of at) {
    // Extension line from just off the building to just past the dimension line.
    pad.seg(P(u, line - dir * pad.p(0.3)), P(u, line + dir * ext), 'dim', 'A-ANNO-DIMS');
    pad.seg(P(u - tick, line - tick), P(u + tick, line + tick), 'medium', 'A-ANNO-DIMS');
  }
  for (let k = 0; k + 1 < at.length; k++) {
    const len = at[k + 1] - at[k];
    const label = ftIn(len);
    const textW = label.length * pad.p(0.08) * 0.5;
    if (textW > len - pad.p(0.04)) continue;
    const mid = (at[k] + at[k + 1]) / 2;
    const above = dir > 0 ? pad.p(0.03) : pad.p(0.03);
    if (axis === 'x') pad.text([mid, line + above], label, 0.08, 'A-ANNO-DIMS', { align: 'center', font: 'sans' });
    else pad.text([line - above, mid], label, 0.08, 'A-ANNO-DIMS', { align: 'center', font: 'sans', angle: 90 });
  }
}

export function northArrow(pad: Pad, res: Resolved) {
  const b = res.bounds;
  const r = pad.p(0.22);
  const c: [number, number] = [b.x1 + pad.p(1.2), b.y1 + pad.p(0.5)];
  const ang = (-res.project.site.northDeg * Math.PI) / 180;
  const rot = (x: number, y: number): [number, number] => [c[0] + x * Math.cos(ang) + y * Math.sin(ang), c[1] - x * Math.sin(ang) + y * Math.cos(ang)];
  pad.circle(c, r, 'fine', 'A-ANNO-SYMB');
  pad.fill([[rot(0, r * 1.3), rot(r * 0.45, -r * 0.6), rot(0, -r * 0.25)]], 'poche', 'A-ANNO-SYMB');
  pad.line([rot(0, r * 1.3), rot(-r * 0.45, -r * 0.6), rot(0, -r * 0.25)], 'fine', 'A-ANNO-SYMB', true);
  pad.text(rot(0, r * 1.45), 'N', 0.1, 'A-ANNO-SYMB', { align: 'center', font: 'sans', bold: true });
}
