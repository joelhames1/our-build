import type { BathSpec, KitchenSpec, Level, Opening, Project, Rect, Roof, Room, RoomType, Side, Site, Stair, Style } from '../model/schema';
import { Project as ProjectSchema } from '../model/schema';
import { snap } from '../model/units';
import type { Box } from '../geometry/polygon';
import { DEFAULT_AREA, HALL_W, packAlongHall, type PackRoom } from '../ops/helpers/layout';
import type { TemplateId, TemplateParams } from './params';
import { orient } from './orient';

export { TEMPLATE_IDS } from './params';
export type { TemplateId, TemplateParams } from './params';

/**
 * Parametric starting plans. Each is written facing south (front door on the y=0 side) and
 * rotated afterwards. They encode the typology (zones, halls, stacked wet walls, stair spots);
 * doors, windows and furniture come from auto-dressing.
 */

interface RoomDef {
  name: string;
  type: RoomType;
  kitchen?: Partial<KitchenSpec>;
  bath?: Partial<BathSpec>;
  ceiling?: 'flat' | 'vaulted';
  covered?: boolean;
  tag?: string;
}
type Node = RoomDef | { split: 'x' | 'y'; parts: Part[] };
interface Part {
  /** Fixed size in feet. */
  size?: number;
  /** Share of what's left after fixed parts (default 1). */
  w?: number;
  node: Node;
}

const isSplit = (n: Node): n is { split: 'x' | 'y'; parts: Part[] } => 'split' in n;
const X = (...parts: Part[]): Node => ({ split: 'x', parts });
const Y = (...parts: Part[]): Node => ({ split: 'y', parts });
const fixed = (size: number, node: Node): Part => ({ size, node });
const flex = (w: number, node: Node): Part => ({ w, node });
const R = (name: string, type: RoomType, extra: Partial<RoomDef> = {}): RoomDef => ({ name, type, ...extra });

function slice(box: Box, node: Node, out: { def: RoomDef; rect: Rect }[]) {
  if (!isSplit(node)) {
    // '__wing' reserves space that a packed program fills in later.
    if (node.name !== '__wing') out.push({ def: node, rect: [box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0] });
    return;
  }
  const lo = node.split === 'x' ? box.x0 : box.y0;
  const hi = node.split === 'x' ? box.x1 : box.y1;
  const fixedSum = node.parts.reduce((s, p) => s + (p.size ?? 0), 0);
  const weights = node.parts.reduce((s, p) => s + (p.size === undefined ? (p.w ?? 1) : 0), 0);
  const free = Math.max(0, hi - lo - fixedSum);
  let cursor = lo;
  node.parts.forEach((p, i) => {
    const len = p.size ?? (free * (p.w ?? 1)) / (weights || 1);
    const end = i === node.parts.length - 1 ? hi : snap(cursor + len);
    const sub: Box = node.split === 'x' ? { x0: cursor, x1: end, y0: box.y0, y1: box.y1 } : { x0: box.x0, x1: box.x1, y0: cursor, y1: end };
    if (end - cursor >= 0.99) slice(sub, p.node, out);
    cursor = end;
  });
}

interface Ctx {
  n: number;
  st: number;
}

function toRooms(ctx: Ctx, placed: { def: RoomDef; rect: Rect }[]): (Room & { tag?: string })[] {
  return placed.map(({ def, rect }) => {
    const r: Room & { tag?: string } = { id: `r${++ctx.n}`, name: def.name, type: def.type, rect, ceiling: def.ceiling ?? 'flat', furnish: 'auto' };
    if (def.type === 'kitchen') r.kitchen = { shape: 'L', island: false, ...def.kitchen };
    if (def.type === 'bath') r.bath = { bathing: 'tub_shower', vanity: 'single', ...def.bath };
    if (def.type === 'half_bath') r.bath = { bathing: 'none', vanity: 'single', ...def.bath };
    if (def.covered !== undefined) r.covered = def.covered;
    if (def.tag) r.tag = def.tag;
    return r;
  });
}

interface LevelPlan {
  name: string;
  kind?: Level['kind'];
  ceiling?: number;
  kneeWall?: number;
  box?: Box;
  node?: Node;
  /** Rooms packed along a hall instead of a slicing tree. */
  program?: PackRoom[];
  programBox?: Box;
  hallThrough?: number;
  hallAxis?: 'x' | 'y';
  stairs?: (rooms: (Room & { tag?: string })[]) => Omit<Stair, 'id'>[];
  openings?: (rooms: (Room & { tag?: string })[]) => Omit<Opening, 'id'>[];
  porches?: { side: Side; depth: number; from?: number; to?: number; type?: RoomType; name?: string; covered?: boolean }[];
}

interface Plan {
  footprint: Box;
  levels: LevelPlan[];
  roof?: Partial<Roof>;
  /** A chimney on this side of the named room (plans are drawn facing south). */
  chimney?: { room: string; side: Side };
  style?: Partial<Style>;
  site?: Partial<Site>;
}

function build(plan: Plan, front: Side, base: { site: Site; style: Style; name: string; brief: string; notes: string[] }): Project {
  const ctx: Ctx = { n: 0, st: 0 };
  let openId = 0;
  const levels: Level[] = plan.levels.map((lp, i) => {
    const box = lp.box ?? plan.footprint;
    const placed: { def: RoomDef; rect: Rect }[] = [];
    if (lp.node) slice(box, lp.node, placed);
    let rooms = toRooms(ctx, placed);
    if (lp.program) {
      const pb = lp.programBox ?? box;
      const { placed: pp, hall } = packAlongHall(pb, lp.program, { through: lp.hallThrough, axis: lp.hallAxis, mode: lp.program.length >= 2 ? 'yes' : 'no' });
      rooms = rooms.concat(toRooms(ctx, pp.map((p) => ({ def: { name: p.spec.name, type: p.spec.type }, rect: p.rect }))));
      if (hall) rooms = rooms.concat(toRooms(ctx, [{ def: R('Hall', 'hall'), rect: hall }]));
    }
    for (const pc of lp.porches ?? []) {
      const fb = box;
      const a = pc.from ?? (pc.side === 'N' || pc.side === 'S' ? fb.x0 : fb.y0);
      const b = pc.to ?? (pc.side === 'N' || pc.side === 'S' ? fb.x1 : fb.y1);
      const rect: Rect =
        pc.side === 'S' ? [a, fb.y0 - pc.depth, b - a, pc.depth] : pc.side === 'N' ? [a, fb.y1, b - a, pc.depth] : pc.side === 'E' ? [fb.x1, a, pc.depth, b - a] : [fb.x0 - pc.depth, a, pc.depth, b - a];
      let name = pc.name ?? (pc.type === 'deck' ? 'Deck' : pc.type === 'screened_porch' ? 'Screened Porch' : 'Porch');
      // Plans are drawn facing south, so a second porch is named for where it sits.
      if (rooms.some((r) => r.name === name)) name = `${pc.side === 'S' ? 'Front' : pc.side === 'N' ? 'Back' : 'Side'} ${name}`;
      rooms.push({ id: `r${++ctx.n}`, name, type: pc.type ?? 'porch', rect, ceiling: 'flat', furnish: 'auto', covered: pc.covered ?? (pc.type !== 'deck' && pc.type !== 'patio') });
    }
    const stairs: Stair[] = (lp.stairs?.(rooms) ?? []).map((s) => ({ ...s, id: `st${++ctx.st}` }) as Stair);
    const openings: Opening[] = (lp.openings?.(rooms) ?? []).map((o) => ({ ...o, id: `${o.type === 'window' || o.type === 'picture_window' ? 'w' : o.type === 'open' || o.type === 'cased_opening' ? 'o' : 'd'}${++openId}` }) as Opening);
    return {
      id: `L${i + 1}`,
      name: lp.name,
      kind: lp.kind ?? 'full',
      ceiling: lp.ceiling ?? (lp.kind === 'half' || lp.kind === 'loft' ? 8 : 9),
      kneeWall: lp.kneeWall ?? 4,
      rooms: rooms.map(({ tag: _t, ...r }) => r),
      openings,
      fixtures: [],
      stairs,
      suppress: [],
    };
  });
  const project = ProjectSchema.parse({
    v: 1,
    name: base.name,
    brief: base.brief,
    notes: base.notes,
    site: { ...base.site, ...plan.site, front: 'S' },
    style: { ...base.style, ...plan.style },
    roof: { ...plan.roof, chimney: chimneyFor(plan, levels) },
    levels,
  });
  return orient(project, front);
}

function chimneyFor(plan: Plan, levels: Level[]): Roof['chimney'] {
  if (!plan.chimney) return null;
  const room = levels.flatMap((l) => l.rooms).find((r) => r.name === plan.chimney!.room);
  return room ? { room: room.id, side: plan.chimney.side } : null;
}

const byTag = (rooms: (Room & { tag?: string })[], tag: string) => rooms.find((r) => r.tag === tag)!;
const byType = (rooms: Room[], t: RoomType) => rooms.find((r) => r.type === t)!;

// --- helpers for sizing ------------------------------------------------------------------------

function bedsBaths(p: TemplateParams, beds: number, baths: number) {
  const b = p.bedrooms ?? beds;
  const ba = p.baths ?? baths;
  return { beds: b, full: Math.max(b > 0 ? 1 : 0, Math.floor(ba)), half: ba % 1 >= 0.5 ? 1 : 0 };
}

const bedroomNames = (n: number, primary = true) => Array.from({ length: n }, (_, i) => (primary && i === 0 ? R('Primary Bedroom', 'primary_bedroom') : R(n > 1 || !primary ? `Bedroom ${primary ? i + 1 : i + 1}` : 'Bedroom', 'bedroom')));

function program(beds: number, full: number, opts: { primary?: boolean; extra?: PackRoom[] } = {}): PackRoom[] {
  const rooms: PackRoom[] = [];
  for (let i = 0; i < beds; i++) rooms.push(i === 0 && opts.primary ? { name: 'Primary Bedroom', type: 'primary_bedroom', area: 220 } : { name: beds - (opts.primary ? 1 : 0) > 1 ? `Bedroom ${i + (opts.primary ? 1 : 1)}` : 'Bedroom', type: 'bedroom', area: 135 });
  for (let i = 0; i < full; i++) rooms.push({ name: i === 0 && opts.primary ? 'Primary Bath' : full > 1 ? `Bath ${i + 1}` : 'Bath', type: 'bath', area: i === 0 && opts.primary ? 75 : 55 });
  return [...rooms, ...(opts.extra ?? [])];
}

const stairAlong = (room: Room, wall: Side, dir: Side): Omit<Stair, 'id'> => ({ room: room.id, shape: 'straight', dir, wall, width: 3.5 });

/** Upper floor over a center stair hall: bedrooms to either side, primary suite on one side. */
function centerHallUpper(beds: number, full: number, office: boolean): Node {
  const west: Part[] = [flex(1, R('Bedroom 2', 'bedroom')), fixed(8, R(full >= 2 ? 'Bath 2' : 'Bath', 'bath'))];
  if (beds >= 3) west.push(flex(1, R('Bedroom 3', 'bedroom')));
  const east: Part[] = [flex(1.35, R('Primary Bedroom', 'primary_bedroom')), fixed(8, X(flex(1.3, R('Primary Bath', 'bath', { bath: { bathing: 'tub_and_shower', vanity: 'double' } })), flex(1, R('Walk-in Closet', 'walk_in_closet'))))];
  if (beds >= 4) east.push(flex(1, R('Bedroom 4', 'bedroom')));
  else if (office) east.push(flex(1, R('Office', 'office')));
  return X(flex(1, Y(...west)), fixed(9, R('Hall', 'hall')), flex(1, Y(...east)));
}

// --- the templates --------------------------------------------------------------------------------

type Gen = (p: TemplateParams) => Plan;

const cottage: Gen = (p) => {
  const { beds, full, half } = bedsBaths(p, 2, 1);
  const upper = p.stories === '1.5' || p.stories === '2';
  const D = 26;
  const mainBeds = upper ? Math.min(1, beds) : beds;
  const pub = X(flex(1.25, R('Kitchen', 'kitchen', { kitchen: { shape: 'L' } })), flex(1, R('Dining', 'dining')));
  const publicZone = Y(fixed(14, R('Living', 'living')), flex(1, pub));
  let privateZone: Node;
  let Wq: number;
  if (mainBeds <= 1) {
    Wq = 13;
    privateZone = Y(flex(1.35, R(upper ? 'Primary Bedroom' : 'Bedroom', upper ? 'primary_bedroom' : 'bedroom')), flex(1, R('Bath', 'bath')));
  } else {
    const front = Array.from({ length: Math.ceil(mainBeds / 2) }, (_, i) => flex(1, R(i === 0 ? 'Primary Bedroom' : `Bedroom ${i + 1}`, i === 0 ? 'primary_bedroom' : 'bedroom')));
    const back: Part[] = [fixed(full > 1 ? 6 : 7, R('Bath', 'bath'))];
    for (let i = Math.ceil(mainBeds / 2); i < mainBeds; i++) back.push(flex(1, R(`Bedroom ${i + 1}`, 'bedroom')));
    if (full > 1) back.unshift(fixed(6, R('Bath 2', 'bath')));
    Wq = Math.max(12 * Math.max(front.length, back.length - (full > 1 ? 1 : 0)) + (full > 1 ? 6 : 0), 17);
    privateZone = Y(flex(1, X(...front)), fixed(HALL_W, R('Hall', 'hall')), flex(1, X(...back)));
  }
  const Wp = snap((p.area ?? 0) > 0 ? Math.max(18, (p.area! - Wq * D) / D) : 20);
  const W = Wp + (upper ? 8 : 0) + Wq;
  const zones: Part[] = [fixed(Wp, publicZone)];
  if (upper) zones.push(fixed(8, Y(flex(1, R('Stair Hall', 'stair_hall', { tag: 'stair' })), fixed(half ? 6 : 0.01, R('Powder Room', 'half_bath')))));
  zones.push(flex(1, privateZone));
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  const levels: LevelPlan[] = [
    {
      name: 'Main Floor',
      node: X(...zones),
      porches: p.porch === 'none' ? [] : [{ side: p.porch === 'back' ? 'N' : 'S', depth: 8, type: p.porch === 'screened' ? 'screened_porch' : 'porch' }, ...(p.porch === 'wrap' ? [{ side: 'E' as Side, depth: 8, from: 0, to: D * 0.6 }] : [])],
      stairs: upper ? (rooms) => [stairAlong(byTag(rooms, 'stair'), 'E', 'N')] : undefined,
    },
  ];
  if (upper) {
    const kind = p.stories === '2' ? 'full' : 'half';
    const up = Math.max(beds - mainBeds, 1);
    const east = up >= 2 ? flex(1, R('Bedroom 2', 'bedroom')) : flex(1, R('Reading Nook', 'loft'));
    levels.push({ name: 'Upper Floor', kind, kneeWall: 3.5, node: X(fixed(Wp, R(up >= 2 ? 'Bedroom 1' : 'Bedroom', 'bedroom')), fixed(8, Y(flex(1, R('Hall', 'hall')), fixed(7, R('Bath', 'bath')))), east), box });
  }
  return {
    footprint: box,
    levels,
    roof: { form: 'gable', pitch: upper ? 12 : 9, ridge: 'parallel_to_front', overhang: 1, rake: 0.75 },
    chimney: { room: 'Living', side: 'W' },
    style: { preset: 'cottage', wall: 'shingle', wallColor: '#c8c0b2', trimColor: '#fbfaf6', roofMaterial: 'cedar_shake', roofColor: '#6d655c', windows: 'double_hung', grilles: 'cottage', doorColor: '#3f5a4c', foundation: 'stone_plinth' },
  };
};

const capeCod: Gen = (p) => {
  const { beds, half } = bedsBaths(p, 3, 2);
  const W = snap(Math.max(36, Math.min(46, (p.area ?? 1600) / 2 / 26 + 6)));
  const D = 26;
  const mainPrimary = (p.primaryOn ?? 'main') === 'main' && beds >= 3;
  const left = mainPrimary ? Y(flex(1, R('Living', 'living')), flex(1, R('Primary Bedroom', 'primary_bedroom'))) : R('Living', 'living');
  const right = Y(flex(1, R('Dining', 'dining')), flex(1.1, R('Kitchen', 'kitchen', { kitchen: { shape: 'L' } })));
  const mid = Y(flex(1, R('Stair Hall', 'stair_hall', { tag: 'stair' })), fixed(mainPrimary ? 8 : half ? 6 : 0.01, mainPrimary ? R('Primary Bath', 'bath') : R('Powder Room', 'half_bath')));
  const upBeds = Math.max(1, beds - (mainPrimary ? 1 : 0));
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  const upWest = R(upBeds > 1 ? 'Bedroom 2' : 'Bedroom', 'bedroom');
  const upEast = upBeds > 1 ? R(upBeds > 2 ? 'Bedroom 3' : 'Bedroom 3', 'bedroom') : R('Sitting Room', 'loft');
  return {
    footprint: box,
    levels: [
      { name: 'Main Floor', node: X(flex(1, left), fixed(9, mid), flex(1, right)), stairs: (rooms) => [stairAlong(byTag(rooms, 'stair'), 'W', 'N')], porches: p.porch && p.porch !== 'none' ? [{ side: 'S', depth: 6, from: W / 2 - 7, to: W / 2 + 7 }] : [] },
      { name: 'Upper Floor', kind: 'half', kneeWall: 3, ceiling: 8, node: X(flex(1, upWest), fixed(9, Y(flex(1, R('Hall', 'hall')), fixed(7, R('Bath', 'bath')))), flex(1, upEast)) },
    ],
    roof: { form: 'gable', pitch: 12, ridge: 'parallel_to_front', overhang: 0.75, rake: 0.5 },
    chimney: { room: 'Living', side: 'W' },
    style: { preset: 'cape_cod', wall: 'shingle', wallColor: '#a9a196', trimColor: '#ffffff', roofMaterial: 'asphalt', roofColor: '#3d3d40', windows: 'double_hung', grilles: 'colonial', doorColor: '#7a2f2a', foundation: 'crawl' },
  };
};

const farmhouse: Gen = (p) => {
  const { beds, full, half } = bedsBaths(p, 4, 2.5);
  const area = p.area ?? 2400;
  const D = 30;
  const W = snap(Math.max(36, Math.min(56, area / 2 / D)));
  const front = X(flex(1, R('Living', 'living')), fixed(9, R('Foyer', 'stair_hall', { tag: 'stair' })), flex(1, R('Dining', 'dining')));
  const back = X(flex(1, R('Family', 'family')), flex(1.15, R('Kitchen', 'kitchen', { kitchen: { shape: 'L', island: true } })), fixed(p.mudroom === false ? 0.01 : 8, Y(flex(1, R('Mudroom', 'mudroom')), fixed(half ? 6 : 0.01, R('Powder Room', 'half_bath')))));
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  const porches: LevelPlan['porches'] =
    p.porch === 'none' ? [] : p.porch === 'wrap' ? [{ side: 'S', depth: 8, from: 0, to: W + 8 }, { side: 'E', depth: 8, from: 0, to: D * 0.55 }] : [{ side: p.porch === 'back' ? 'N' : 'S', depth: 8 }];
  return {
    footprint: box,
    levels: [
      { name: 'Main Floor', node: Y(fixed(16, front), flex(1, back)), stairs: (rooms) => [stairAlong(byTag(rooms, 'stair'), 'W', 'N')], porches },
      { name: 'Upper Floor', node: centerHallUpper(beds, full, !!p.office), box, ceiling: 8.5 },
    ],
    roof: { form: 'gable', pitch: 10, ridge: 'parallel_to_front', overhang: 1, rake: 0.75, porch: 'shed', porchPitch: 3.5 },
    chimney: { room: 'Living', side: 'W' },
    style: { preset: 'farmhouse', wall: 'board_and_batten', wallColor: '#f2f0ea', trimColor: '#f7f6f2', roofMaterial: 'standing_seam', roofColor: '#2f3236', windows: 'double_hung', grilles: 'none', windowColor: '#2b2b2b', doorColor: '#2b2b2b', foundation: 'crawl' },
  };
};

const ranch: Gen = (p) => {
  const { beds, full, half } = bedsBaths(p, 3, 2);
  const D = 28;
  const garage = p.garage ?? '2';
  const bedProgram = program(beds, full, { primary: beds >= 2 });
  const wingArea = bedProgram.reduce((s, r) => s + (r.area ?? DEFAULT_AREA[r.type]), 0) + HALL_W * 20;
  const wingW = snap(Math.max(24, wingArea / D));
  const pubW = snap(Math.max(26, ((p.area ?? 1800) - wingW * D) / D));
  const gW = garage === 'none' ? 0 : garage === '1' ? 13 : 23;
  const pub = Y(fixed(15, X(flex(1.4, R('Living', 'living')), fixed(8, R('Entry', 'foyer')))), flex(1, X(flex(1.2, R('Kitchen', 'kitchen', { kitchen: { shape: 'L', island: true } })), flex(1, R('Dining', 'dining')))));
  const service = Y(flex(1, R('Laundry', 'laundry')), fixed(half ? 5.5 : 0.01, R('Powder Room', 'half_bath')), flex(1.2, R('Mudroom', 'mudroom')));
  const parts: Part[] = [];
  if (gW) parts.push(fixed(gW, R('Garage', 'garage')), fixed(7, service));
  parts.push(fixed(pubW, pub));
  const x0 = parts.reduce((s, q) => s + (q.size ?? 0), 0);
  const box = { x0: 0, y0: 0, x1: x0 + wingW, y1: D };
  const wingBox = { x0, y0: 0, x1: x0 + wingW, y1: D };
  return {
    footprint: box,
    levels: [
      {
        name: 'Main Floor',
        node: X(...parts, flex(1, R('__wing', 'hall'))),
        program: bedProgram,
        programBox: wingBox,
        hallAxis: 'x',
        hallThrough: 13,
        porches: p.porch && p.porch !== 'none' ? [{ side: 'S', depth: 7, from: gW + 7, to: gW + 7 + pubW }] : [],
      },
    ],
    roof: { form: 'hip', pitch: 6, overhang: 2 },
    style: { preset: 'ranch', wall: 'lap_siding', wallColor: '#d9d2c4', trimColor: '#f4f1ea', roofMaterial: 'asphalt', roofColor: '#57534e', windows: 'double_hung', grilles: 'prairie', foundation: 'slab' },
  };
};

const bungalow: Gen = (p) => {
  const { beds, full } = bedsBaths(p, 2, 1);
  const W = 30;
  const backBeds = Math.max(1, beds);
  const D = snap(Math.max(38, (p.area ?? 1250) / W));
  const front = X(flex(1.5, R('Living', 'living')), flex(1, R('Den', 'office')));
  const middle = X(flex(1, R('Dining', 'dining')), flex(1, R('Kitchen', 'kitchen', { kitchen: { shape: 'U' } })));
  const beds_: Part[] = Array.from({ length: Math.ceil(backBeds / 2) }, (_, i) => flex(1, R(i === 0 ? 'Bedroom' : `Bedroom ${i * 2 + 1}`, 'bedroom')));
  const back = Y(fixed(HALL_W, X(flex(1, R('Hall', 'hall')), fixed(full > 1 ? 7 : 0.01, R('Bath 2', 'bath')))), flex(1, X(...beds_, fixed(7, R('Bath', 'bath')), ...(backBeds > 1 ? [flex(1, R('Bedroom 2', 'bedroom'))] : []))));
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  return {
    footprint: box,
    levels: [{ name: 'Main Floor', node: Y(fixed(15, front), fixed(12, middle), flex(1, back)), porches: p.porch === 'none' ? [] : [{ side: 'S', depth: 8, from: 0, to: W * 0.7 }] }],
    roof: { form: 'gable', pitch: 6, ridge: 'perpendicular_to_front', overhang: 2.5, rake: 2, porch: 'gable', porchPitch: 6 },
    chimney: { room: 'Living', side: 'W' },
    style: { preset: 'craftsman', wall: 'shingle', wallColor: '#7b8a72', trimColor: '#efe8d8', roofMaterial: 'asphalt', roofColor: '#4c4a45', windows: 'double_hung', grilles: 'prairie', doorColor: '#7a4b2a', foundation: 'stone_plinth' },
  };
};

const aFrame: Gen = (p) => {
  const W = 26;
  const D = snap(Math.max(30, (p.area ?? 950) / W));
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  const main = Y(flex(1.6, R('Great Room', 'great_room', { ceiling: 'vaulted' })), flex(1, X(flex(1, R('Kitchen', 'kitchen', { kitchen: { shape: 'galley' } })), fixed(9, R('Bath', 'bath', { bath: { bathing: 'shower' } })), flex(1, R('Bedroom', 'bedroom', { tag: 'stair' })))));
  const backDepth = snap(D / 2.6);
  return {
    footprint: box,
    levels: [
      {
        name: 'Main Floor',
        kind: 'half',
        kneeWall: 1.5,
        ceiling: 8,
        node: main,
        stairs: (rooms) => [{ room: byType(rooms, 'kitchen').id, shape: 'straight', dir: 'N', wall: 'E', width: 3 }],
        porches: [{ side: 'S', depth: 10, type: 'deck', covered: false }],
      },
      // The loft sits where the steep roof still leaves headroom: inset from both long walls.
      { name: 'Loft', kind: 'loft', ceiling: 7, box: { x0: 6, y0: D - backDepth - 0.5, x1: W - 6, y1: D }, node: R('Sleeping Loft', 'loft') },
    ],
    roof: { form: 'gable', pitch: 22, ridge: 'perpendicular_to_front', overhang: 1.5, rake: 1 },
    style: { preset: 'a_frame', wall: 'vertical_wood', wallColor: '#8a6a4f', trimColor: '#2d2a26', roofMaterial: 'standing_seam', roofColor: '#2b2d2f', windows: 'modern', grilles: 'none', windowColor: '#26282a', doorColor: '#26282a', foundation: 'crawl' },
    site: { trees: 'many', setting: 'forest' },
  };
};

const modern: Gen = (p) => {
  const { beds, full, half } = bedsBaths(p, 3, 2.5);
  const two = p.stories === '2';
  const D = 30;
  const area = p.area ?? 2200;
  const box2 = (w: number) => ({ x0: 0, y0: 0, x1: w, y1: D });
  if (two) {
    const W = snap(Math.max(36, area / 2 / D));
    return {
      footprint: box2(W),
      levels: [
        {
          name: 'Main Floor',
          node: X(flex(2.2, R('Great Room', 'great_room')), fixed(10, Y(flex(1, R('Entry', 'stair_hall', { tag: 'stair' })), fixed(half ? 6 : 0.01, R('Powder Room', 'half_bath')))), flex(1.3, Y(flex(1, R('Office', 'office')), flex(1.2, R('Kitchen', 'kitchen', { kitchen: { shape: 'L', island: true } }))))),
          stairs: (rooms) => [stairAlong(byTag(rooms, 'stair'), 'E', 'N')],
          porches: [{ side: 'N', depth: 12, type: 'deck', covered: false }],
        },
        { name: 'Upper Floor', box: box2(W), node: X(flex(2.2, Y(flex(1.3, R('Primary Bedroom', 'primary_bedroom')), flex(1, X(flex(1, R('Primary Bath', 'bath', { bath: { bathing: 'shower', vanity: 'double' } })), fixed(7, R('Closet', 'walk_in_closet')))))), fixed(10, R('Hall', 'hall')), flex(1.3, Y(flex(1, R('Bedroom 2', 'bedroom')), fixed(8, R('Bath 2', 'bath')), flex(1, R(beds >= 3 ? 'Bedroom 3' : 'Study', beds >= 3 ? 'bedroom' : 'office'))))) },
      ],
      roof: { form: 'flat', overhang: 2 },
      style: { preset: 'modern', wall: 'panel', wallColor: '#e7e4dd', trimColor: '#2a2a2a', roofMaterial: 'membrane', roofColor: '#3a3a3a', windows: 'modern', grilles: 'none', windowColor: '#1f1f1f', doorColor: '#1f1f1f', foundation: 'slab' },
    };
  }
  const wing = program(beds, full, { primary: true });
  const wingW = snap(Math.max(26, wing.reduce((s, r) => s + (r.area ?? DEFAULT_AREA[r.type]), 0) / D + 4));
  const pubW = snap(Math.max(28, (area - wingW * D) / D));
  const W = pubW + wingW;
  return {
    footprint: box2(W),
    levels: [
      {
        name: 'Main Floor',
        node: X(fixed(pubW, Y(fixed(8, X(flex(1, R('Entry', 'foyer')), fixed(half ? 6 : 0.01, R('Powder Room', 'half_bath')))), flex(1, X(flex(1.6, R('Great Room', 'great_room')), flex(1, R('Kitchen', 'kitchen', { kitchen: { shape: 'L', island: true } })))))), flex(1, R('__wing', 'hall'))),
        program: wing,
        programBox: { x0: pubW, y0: 0, x1: W, y1: D },
        hallAxis: 'x',
        porches: [{ side: 'N', depth: 12, type: 'deck', covered: false, from: 0, to: pubW }],
      },
    ],
    roof: { form: 'flat', overhang: 2.5 },
    style: { preset: 'modern', wall: 'stucco', wallColor: '#ecebe6', trimColor: '#2a2a2a', roofMaterial: 'membrane', roofColor: '#3a3a3a', windows: 'modern', grilles: 'none', windowColor: '#1f1f1f', doorColor: '#6b4a32', foundation: 'slab' },
  };
};

const lakeHouse: Gen = (p) => {
  const { half } = bedsBaths(p, 3, 2.5);
  // Deep enough for a straight stair in the entry with a landing at its foot.
  const D = 31;
  // Wide enough upstairs for the west stack, the hall, and a primary bath beside a real Bedroom 3.
  const minW = (half ? 18 : 12) + 9 + 17;
  const W = snap(Math.max(minW, Math.min(54, (p.area ?? 2200) / 2 / D + 4)));
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  // The lake is behind (north): the great room and kitchen take the view.
  const front = X(fixed(12, R('Mudroom', 'mudroom')), fixed(half ? 6 : 0.01, R('Powder Room', 'half_bath')), fixed(9, R('Entry', 'stair_hall', { tag: 'stair' })), flex(1, R('Office', 'office')));
  const back = X(flex(1.7, R('Great Room', 'great_room', { ceiling: 'flat' })), flex(1, R('Kitchen', 'kitchen', { kitchen: { shape: 'L', island: true } })));
  const porches: LevelPlan['porches'] = p.porch === 'none' ? [] : [{ side: 'N', depth: 10, from: -0, to: W + 10, type: p.porch === 'screened' ? 'screened_porch' : 'porch' }, { side: 'E', depth: 10, from: 0, to: D }];
  return {
    footprint: box,
    levels: [
      { name: 'Main Floor', node: Y(fixed(16, front), flex(1, back)), stairs: (rooms) => [stairAlong(byTag(rooms, 'stair'), 'W', 'N')], porches },
      {
        name: 'Upper Floor',
        kind: p.stories === '2' ? 'full' : 'half',
        kneeWall: 4,
        box,
        node: X(fixed(half ? 18 : 12, Y(flex(1, R('Bedroom 2', 'bedroom')), fixed(8, R('Bath 2', 'bath')))), fixed(9, R('Hall', 'hall')), flex(1, Y(flex(1, X(fixed(7, R('Primary Bath', 'bath')), flex(1, R('Bedroom 3', 'bedroom')))), flex(1.25, R('Primary Bedroom', 'primary_bedroom'))))),
      },
    ],
    roof: { form: 'gable', pitch: 11, ridge: 'parallel_to_front', overhang: 1.5, rake: 1, porch: 'shed', porchPitch: 3.5 },
    chimney: { room: 'Great Room', side: 'W' },
    style: { preset: 'lake_house', wall: 'lap_siding', wallColor: '#5f6e74', trimColor: '#f5f3ee', roofMaterial: 'standing_seam', roofColor: '#33383b', windows: 'casement', grilles: 'none', windowColor: '#f5f3ee', doorColor: '#b9874c', foundation: 'stone_plinth' },
    site: { setting: 'lakefront', water: ['N'] },
  };
};

const tinyHouse: Gen = (p) => {
  const W = 28;
  const D = snap(Math.max(14, (p.area ?? 420) / W));
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  return {
    footprint: box,
    levels: [{ name: 'Main Floor', node: X(flex(1, R('Living', 'great_room', { ceiling: 'vaulted' })), fixed(8, Y(flex(1, R('Kitchen', 'kitchen', { kitchen: { shape: 'single_wall' } })), fixed(6.5, R('Bath', 'bath', { bath: { bathing: 'shower' } })))), fixed(10, R('Bedroom', 'bedroom'))), porches: p.porch === 'none' ? [] : [{ side: 'S', depth: 6, type: 'deck', covered: false }] }],
    roof: { form: 'shed', pitch: 3, overhang: 1.5, rake: 1 },
    style: { preset: 'tiny', wall: 'vertical_wood', wallColor: '#b48a62', trimColor: '#2b2b2b', roofMaterial: 'standing_seam', roofColor: '#3a3d40', windows: 'modern', grilles: 'none', windowColor: '#2b2b2b', doorColor: '#2b2b2b', foundation: 'crawl' },
  };
};

const garageStudio: Gen = (p) => {
  const W = p.garage === '1' ? 16 : 26;
  const D = 24;
  const box = { x0: 0, y0: 0, x1: W, y1: D };
  return {
    footprint: box,
    levels: [
      // A stairwell along the side with storage behind it; the stair climbs toward the back.
      { name: 'Garage Level', node: X(flex(1, R('Garage', 'garage')), fixed(5, Y(fixed(16.5, R('Stair', 'stair_hall', { tag: 'stair' })), flex(1, R('Storage', 'storage'))))), stairs: (rooms) => [{ room: byTag(rooms, 'stair').id, shape: 'straight', dir: 'N', wall: 'E', width: 3.5 }] },
      // Upstairs you arrive at the back of the landing and step into the studio; kitchen and bath face the street.
      {
        name: 'Studio',
        node: X(
          flex(1, Y(flex(1, X(flex(1, R('Kitchen', 'kitchen', { kitchen: { shape: 'single_wall' } })), fixed(W - 5 >= 18 ? 8 : 5.5, R('Bath', 'bath', { bath: { bathing: 'shower' } })))), flex(1.3, R('Studio', 'studio')))),
          fixed(5, Y(fixed(19, R('Landing', 'hall')), flex(1, R('Closet', 'closet')))),
        ),
      },
    ],
    roof: { form: 'gable', pitch: 9, ridge: 'perpendicular_to_front', overhang: 1, rake: 1 },
    style: { preset: 'carriage_house', wall: 'board_and_batten', wallColor: '#e9e5dc', trimColor: '#2c2c2c', roofMaterial: 'asphalt', roofColor: '#3b3b3e', windows: 'double_hung', grilles: 'colonial', foundation: 'slab' },
  };
};

const GENERATORS: Record<TemplateId, Gen> = {
  cottage,
  cape_cod: capeCod,
  farmhouse,
  ranch,
  bungalow,
  a_frame: aFrame,
  modern,
  lake_house: lakeHouse,
  tiny_house: tinyHouse,
  garage_studio: garageStudio,
};

export const TEMPLATE_INFO: Record<TemplateId, string> = {
  cottage: 'Cozy 1 or 1.5-story cottage: living in front, kitchen/dining behind, bedrooms off a short hall; front porch; steep gable. Params: bedrooms 1–3, stories 1|1.5|2, porch.',
  cape_cod: 'Symmetric 1.5-story Cape: center stair hall, living one side, dining/kitchen the other, bedrooms upstairs under a 12/12 roof; optional main-floor primary.',
  farmhouse: 'Two-story farmhouse: center foyer with stairs, living and dining in front, family/kitchen/mudroom behind, bedrooms upstairs; porch front/back/wrap; metal roof.',
  ranch: 'One-story ranch: garage + mudroom/laundry, open living/kitchen/dining in the middle, bedroom wing along a hall; low hip roof.',
  bungalow: 'Craftsman bungalow: deep and narrow, living + den in front under a gabled porch, dining/kitchen, bedrooms in back; wide eaves.',
  a_frame: 'A-frame cabin: steep roof to the ground, vaulted great room, kitchen, bath, bedroom, sleeping loft above; deck in front.',
  modern: 'Modern: open great room and kitchen, bedroom wing (1 story) or bedrooms upstairs (stories 2); flat roof, big glass, deck.',
  lake_house: 'Lake house: entry/mudroom/office on the approach side, great room and kitchen facing the water, wraparound porch on the lake side, bedrooms upstairs (1.5 or 2 stories).',
  tiny_house: 'Tiny house (~350–450 sf): living, kitchen, bath, bedroom; shed roof.',
  garage_studio: 'Garage with a studio apartment above (ADU).',
};

export function buildTemplate(id: TemplateId, params: TemplateParams, base: { site: Site; style: Style; name: string; brief: string; notes: string[] }): Project {
  const plan = GENERATORS[id](params);
  // Drop zero-size spacer rooms and the placeholder for packed wings.
  for (const lp of plan.levels) if (lp.node) lp.node = prune(lp.node);
  const front = params.front ?? base.site.front ?? 'S';
  return build(plan, front, base);
}

function prune(n: Node): Node {
  if (!isSplit(n)) return n;
  return { split: n.split, parts: n.parts.filter((p) => !(p.size !== undefined && p.size < 0.5)).map((p) => ({ ...p, node: prune(p.node) })) };
}
