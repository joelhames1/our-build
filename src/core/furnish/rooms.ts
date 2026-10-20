import { fixtureSpec } from '../catalog/fixtures';
import { OPPOSITE } from '../geometry/fixtures';
import type { Box } from '../geometry/polygon';
import type { Side } from '../model/schema';
import { type RoomCtx, SIDES } from './context';

const id = (ctx: RoomCtx, s: string) => `af_${ctx.room.id}_${s}`.slice(0, 24);
const grow = (b: Box, by: number): Box => ({ x0: b.x0 - by, x1: b.x1 + by, y0: b.y0 - by, y1: b.y1 + by });
const AXIS: Record<Side, 'x' | 'y'> = { N: 'x', S: 'x', E: 'y', W: 'y' };

/** Pick the first slot that works from a list of sides, trying sizes ([width, depth, clear in front]) biggest first. */
function firstSlot(ctx: RoomCtx, sides: Side[], sizes: [number, number, number?][], h: number, prefer?: (s: Side) => number | undefined) {
  for (const [w, d, clear] of sizes) {
    for (const s of sides) {
      const slot = ctx.wallSlot(s, w, d, h, { prefer: prefer?.(s), clear });
      if (slot) return { ...slot, w, d };
    }
  }
  return null;
}

/** Sides ordered by how good they are for something big against the wall: no doors, long, solid. */
function sidesForBig(ctx: RoomCtx): Side[] {
  const mainDoor = SIDES.find((s) => ctx.doorsOn(s).length > 0);
  const score = (s: Side) => (ctx.doorsOn(s).length ? -10 : 0) + (mainDoor && s === OPPOSITE[mainDoor] ? 3 : 0) + (ctx.windowsOn(s).length ? -1 : 0) + ctx.solid(s).reduce((a, [x, y]) => a + (y - x), 0) * 0.1;
  return [...SIDES].sort((a, b) => score(b) - score(a));
}

// --- bedrooms -------------------------------------------------------------------------------------

export function bedroom(ctx: RoomCtx, kind: 'primary' | 'bedroom' | 'nursery' | 'guest', closet: boolean) {
  const min = Math.min(ctx.w, ctx.d);
  if (kind === 'nursery') {
    const crib = firstSlot(ctx, sidesForBig(ctx), [[2.5, 4.5, 2]], 3);
    if (crib) ctx.wall(id(ctx, 'crib'), 'crib', crib.side, crib.u);
  } else {
    const ladder = kind === 'primary' ? ['bed_king', 'bed_queen', 'bed_full', 'bed_twin'] : ['bed_queen', 'bed_full', 'bed_twin'];
    const fitsRoom = (k: string) => {
      const s = fixtureSpec(k);
      return s.w + 2 * 2.5 <= Math.max(ctx.w, ctx.d) && s.d + 2.5 <= Math.max(ctx.w, ctx.d) && s.w + 2 <= min + 2;
    };
    const order = ladder.filter((k) => fitsRoom(k));
    let placed = false;
    // A bed she's moved or resized: nightstands and walking room go around it where it is.
    const own = ctx.pinned.find((f) => f.kind.startsWith('bed_') && f.wall);
    if (own) {
      const side = own.wall!;
      const sf = ctx.frame(side)!;
      const u = sf.axis === 'x' ? own.cx : own.cy;
      ctx.wall(id(ctx, 'ns1'), 'nightstand', side, u - own.w / 2 - 1.05);
      ctx.wall(id(ctx, 'ns2'), 'nightstand', side, u + own.w / 2 + 1.05);
      ctx.keep.push(ctx.strip(sf, u - own.w / 2 - 2.2, u - own.w / 2, 1.6, own.d + 2.3), ctx.strip(sf, u + own.w / 2, u + own.w / 2 + 2.2, 1.6, own.d + 2.3), ctx.strip(sf, u - own.w / 2, u + own.w / 2, own.d, own.d + 2.3));
      placed = true;
    }
    for (const k of placed ? [] : order.length ? order : ['bed_twin']) {
      const s = fixtureSpec(k);
      for (const side of sidesForBig(ctx)) {
        // Room for the bed, nightstands, and 2'-6" to walk around its foot.
        if (ctx.across(side) < s.d + 2.5) continue;
        const withStands = ctx.wallSlot(side, s.w + 2 * 1.9, s.d + 2.5, 2.2);
        const slot = withStands ?? ctx.wallSlot(side, s.w, s.d + 2.5, 2.2);
        if (!slot) continue;
        const bed = ctx.wall(id(ctx, 'bed'), k, side, slot.u);
        if (!bed) continue;
        if (withStands) {
          ctx.wall(id(ctx, 'ns1'), 'nightstand', side, slot.u - s.w / 2 - 1.05);
          ctx.wall(id(ctx, 'ns2'), 'nightstand', side, slot.u + s.w / 2 + 1.05);
        }
        // Walking room beside and at the foot of the bed (beyond the nightstands).
        const sf = ctx.frame(side)!;
        ctx.keep.push(ctx.strip(sf, slot.u - s.w / 2 - 2.2, slot.u - s.w / 2, 1.6, s.d + 2.3), ctx.strip(sf, slot.u + s.w / 2, slot.u + s.w / 2 + 2.2, 1.6, s.d + 2.3), ctx.strip(sf, slot.u - s.w / 2, slot.u + s.w / 2, s.d, s.d + 2.3));
        if (kind === 'primary') {
          const [rx, ry] = ctx.point(side, slot.u, s.d * 0.62);
          ctx.float(id(ctx, 'rug'), 'rug', rx, ry, OPPOSITE[side], [Math.min(s.w + 3, 9), 8]);
          const [bx, by] = ctx.point(side, slot.u, s.d + 0.95);
          if (ctx.across(side) >= s.d + 1.4 + 3) ctx.float(id(ctx, 'bench'), 'bench', bx, by, OPPOSITE[side], [Math.min(4.5, s.w - 0.5), 1.4]);
        }
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  // Dresser across from the bed or on a side wall, with 3' in front of it.
  const dresser = firstSlot(ctx, sidesForBig(ctx).reverse(), [
    [5, 1.6, 3],
    [3.5, 1.6, 3],
  ], 3);
  if (dresser) ctx.wall(id(ctx, 'dresser'), 'dresser', dresser.side, dresser.u, [dresser.w, 1.6]);
  if (!closet) {
    const wr = firstSlot(ctx, sidesForBig(ctx).reverse(), [[4, 2, 3]], 6.5);
    if (wr) ctx.wall(id(ctx, 'wardrobe'), 'wardrobe', wr.side, wr.u);
  }
  if (kind === 'nursery') {
    const c = ctx.corner(3);
    if (c) ctx.float(id(ctx, 'chair'), 'armchair', c.x, c.y, c.x < ctx.cx ? 'E' : 'W');
  }
}

// --- living rooms ---------------------------------------------------------------------------------

export function living(ctx: RoomCtx, opts: { fireplace?: { side: Side; u: number }; big?: boolean }) {
  // The focal wall: the fireplace if there is one, else the longest solid wall without doors (for a TV).
  let focal: Side | null = null;
  let focalU: number | undefined;
  if (opts.fireplace) {
    const fp = ctx.wallSlot(opts.fireplace.side, 5.5, 2 + 3, 4.5, { prefer: opts.fireplace.u });
    if (fp && Math.abs(fp.u - opts.fireplace.u) < 0.6 && ctx.wall(id(ctx, 'fireplace'), 'fireplace', fp.side, fp.u)) {
      focal = fp.side;
      focalU = fp.u;
    }
  }
  if (!focal) {
    const order = [...SIDES].sort((a, b) => score(b) - score(a));
    function score(s: Side) {
      const solid = ctx.freeAlong(s, 1.6, 2).reduce((m, [x, y]) => Math.max(m, y - x), 0);
      return solid + (ctx.windowsOn(s).length ? -2 : 0) + (ctx.across(s) >= 11 ? 3 : 0);
    }
    for (const s of order) {
      if (ctx.across(s) < 10) continue;
      // The TV hangs at eye height, so it has to miss the windows; the console goes under it.
      let tv: { u: number; w: number } | null = null;
      for (const w of [4.8, 4, 3.4]) {
        const slot = ctx.wallSlot(s, w, 0.3, 2.7, { mount: 3.6 });
        if (slot) {
          tv = { u: slot.u, w };
          break;
        }
      }
      if (!tv) continue;
      const con = ctx.wallSlot(s, Math.max(tv.w + 0.8, 5), 1.6, 2, { prefer: tv.u, clear: 2 });
      if (!con || Math.abs(con.u - tv.u) > 0.75) continue;
      if (ctx.wall(id(ctx, 'console'), 'tv_console', s, con.u, [Math.max(tv.w + 0.8, 5), 1.6])) {
        ctx.wall(id(ctx, 'tv'), 'tv', s, tv.u, [tv.w, 0.25]);
        focal = s;
        focalU = tv.u;
        break;
      }
    }
  }
  if (!focal) {
    // No focal wall: a sofa against the longest wall and a coffee table.
    // Sofa backs sit low enough to go under a window.
    const s = firstSlot(ctx, sidesForBig(ctx), [
      [7.5, 3.1, 3],
      [5.5, 3.1, 3],
    ], 2.4);
    if (s) {
      ctx.wall(id(ctx, 'sofa'), s.w > 6 ? 'sofa' : 'loveseat', s.side, s.u);
      const [x, y] = ctx.point(s.side, s.u, 3.1 + 1.5 + 1);
      ctx.float(id(ctx, 'coffee'), 'coffee_table', x, y, OPPOSITE[s.side]);
    }
    return;
  }
  const sf = ctx.frame(focal)!;
  const depth = ctx.across(focal);
  const u = focalU ?? (sf.a + sf.b) / 2;
  const facing = focal; // the sofa looks at the focal wall
  // Sofa: against the far wall if the room isn't deep, otherwise floating about 9' from the focal wall.
  let sofaN: number | null = null;
  let sofaKind = 'sofa';
  if (depth <= 15.5) {
    const far = OPPOSITE[focal];
    for (const [k, w] of [
      ['sofa', 7.5],
      ['loveseat', 5.5],
    ] as const) {
      const slot = ctx.wallSlot(far, w, 3.1, 2.4, { prefer: u });
      if (slot && Math.abs(slot.u - u) < 2 && ctx.wall(id(ctx, 'sofa'), k, far, slot.u)) {
        sofaN = depth - 3.1 / 2;
        sofaKind = k;
        break;
      }
    }
  }
  if (sofaN === null) {
    for (const n of [9 + 1.55, 8 + 1.55, 10.5 + 1.55, 7 + 1.55]) {
      if (n + 1.55 > depth - 0.5) continue;
      const [x, y] = ctx.point(focal, u, n);
      for (const [k, w] of [
        ['sofa', 7.5],
        ['loveseat', 5.5],
      ] as const) {
        if (ctx.float(id(ctx, 'sofa'), k, x, y, facing, [w, 3.1])) {
          sofaN = n;
          sofaKind = k;
          break;
        }
      }
      if (sofaN !== null) break;
    }
  }
  if (sofaN === null) return;
  const sofaW = sofaKind === 'sofa' ? 7.5 : 5.5;
  // Coffee table 18" in front of the sofa; armchairs either side facing in.
  const tableN = sofaN - 1.55 - 1.5 - 1;
  if (tableN > 3) {
    const [tx, ty] = ctx.point(focal, u, tableN);
    ctx.float(id(ctx, 'coffee'), 'coffee_table', tx, ty, facing);
    const off = 2 + 1.5 + 1.5;
    for (const [k, sgn] of [
      ['ch1', 1],
      ['ch2', -1],
    ] as const) {
      const [cx, cy] = ctx.point(focal, u + sgn * off, tableN);
      // Face the coffee table.
      const toward: Side = sgn > 0 ? (AXIS[focal] === 'x' ? 'W' : 'S') : AXIS[focal] === 'x' ? 'E' : 'N';
      ctx.float(id(ctx, k), 'armchair', cx, cy, toward);
    }
    // A rug pulls the group together.
    const [rx, ry] = ctx.point(focal, u, (tableN + sofaN) / 2 - 0.5);
    const big = opts.big || (ctx.w >= 16 && ctx.d >= 16);
    ctx.float(id(ctx, 'rug'), big ? 'rug_large' : 'rug', rx, ry, facing, big ? [12, 9] : [10, 8]);
  }
  // A lamp at the end of the sofa, a plant in a corner, shelves on a spare wall.
  const [lx, ly] = ctx.point(focal, u + sofaW / 2 + 0.9, sofaN + 0.6);
  ctx.float(id(ctx, 'lamp'), 'floor_lamp', lx, ly, facing);
  const c = ctx.corner(1.6);
  if (c) ctx.float(id(ctx, 'plant'), 'plant', c.x, c.y, 'S');
  const shelf = firstSlot(ctx, SIDES.filter((s) => s !== focal && s !== OPPOSITE[focal]), [[3, 1.2, 2.5]], 6.5);
  if (shelf) ctx.wall(id(ctx, 'shelf'), 'bookshelf', shelf.side, shelf.u);
}

// --- dining ---------------------------------------------------------------------------------------

export function dining(ctx: RoomCtx) {
  const long = Math.max(ctx.w, ctx.d);
  const short = Math.min(ctx.w, ctx.d);
  const along: Side = ctx.w >= ctx.d ? 'N' : 'E'; // table's long side faces this way
  type T = { kind: string; w: number; d: number; chairs: number; round: boolean };
  const tables: T[] = [
    ...(long >= 14 && short >= 10 ? [{ kind: 'dining_table_large', w: 8, d: 3.75, chairs: 8, round: false }] : []),
    ...(long >= 12 && short >= 9.5 ? [{ kind: 'dining_table', w: 6, d: 3.5, chairs: 6, round: false }] : []),
    ...(short >= 9 ? [{ kind: 'round_table', w: 4, d: 4, chairs: 4, round: true }] : []),
    ...(short >= 7.5 ? [{ kind: 'round_table', w: 3.5, d: 3.5, chairs: 4, round: true }] : []),
  ];
  const shifts: [number, number][] = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
  ];
  for (const t of tables) {
    for (const [dx, dy, room] of shifts.flatMap(([a, b]) => [[a, b, 2.4] as const, [a, b, 2.1] as const])) {
      const cx = ctx.cx + dx;
      const cy = ctx.cy + dy;
      const tb = footprintOf(cx, cy, t.w, t.d, along);
      // Chairs need a couple of feet all round to pull out; tucked in, they must keep doorways clear.
      if (!ctx.fits(grow(tb, room), { keep: false }) || !ctx.fits(grow(tb, 1.2))) continue;
      if (!ctx.float(id(ctx, 'table'), t.kind, cx, cy, along, t.round ? undefined : [t.w, t.d])) continue;
      chairsAround(ctx, cx, cy, t, along);
      // A sideboard on a free wall.
      const sb = firstSlot(ctx, sidesForBig(ctx), [[5.5, 1.7, 0.5]], 2.8);
      if (sb) ctx.wall(id(ctx, 'buffet'), 'buffet', sb.side, sb.u);
      return;
    }
  }
}

function footprintOf(cx: number, cy: number, w: number, d: number, facing: Side): Box {
  const ns = facing === 'N' || facing === 'S';
  return { x0: cx - (ns ? w : d) / 2, x1: cx + (ns ? w : d) / 2, y0: cy - (ns ? d : w) / 2, y1: cy + (ns ? d : w) / 2 };
}

function chairsAround(ctx: RoomCtx, cx: number, cy: number, t: { w: number; d: number; chairs: number; round: boolean }, along: Side) {
  const seats: [number, number, Side][] = [];
  const out = 0.55;
  if (t.round) {
    const r = t.w / 2 + out;
    seats.push([cx, cy + r, 'S'], [cx, cy - r, 'N'], [cx + r, cy, 'W'], [cx - r, cy, 'E']);
  } else {
    const xLong = along === 'N' || along === 'S';
    const perSide = Math.max(1, Math.floor((t.w - 0.5) / 2.25));
    const halfW = t.w / 2;
    const halfD = t.d / 2 + out;
    for (let k = 0; k < perSide; k++) {
      const s = -halfW + (t.w / perSide) * (k + 0.5);
      if (xLong) seats.push([cx + s, cy + halfD, 'S'], [cx + s, cy - halfD, 'N']);
      else seats.push([cx + halfD, cy + s, 'W'], [cx - halfD, cy + s, 'E']);
    }
    const end = halfW + out;
    if (t.chairs > perSide * 2) {
      if (xLong) seats.push([cx + end, cy, 'W'], [cx - end, cy, 'E']);
      else seats.push([cx, cy + end, 'S'], [cx, cy - end, 'N']);
    }
  }
  seats.forEach(([x, y, f], k) => ctx.float(id(ctx, `c${k + 1}`), 'dining_chair', x, y, f));
}

// --- work and utility rooms -----------------------------------------------------------------------

export function office(ctx: RoomCtx, library: boolean) {
  // Desk under a window if one has room, else on the longest free wall.
  const windowSides = SIDES.filter((s) => ctx.windowsOn(s).length).concat(SIDES);
  const desk = firstSlot(ctx, windowSides, [
    [5, 2.2, 3],
    [4.5, 2.2, 3],
    [3.5, 2.2, 3],
  ], 2.45, (s) => {
    const w = ctx.windowsOn(s)[0];
    return w ? (w.u0 + w.u1) / 2 : undefined;
  });
  if (desk) {
    ctx.wall(id(ctx, 'desk'), 'desk', desk.side, desk.u, [desk.w, 2.2]);
    const [x, y] = ctx.point(desk.side, desk.u, 2.2 + 0.8);
    ctx.float(id(ctx, 'chair'), 'office_chair', x, y, desk.side);
  }
  const shelves = library ? 3 : 1;
  for (let k = 0; k < shelves; k++) {
    const s = firstSlot(ctx, sidesForBig(ctx), [[3, 1.2, 2.5]], 6.5);
    if (!s || !ctx.wall(id(ctx, `shelf${k + 1}`), 'bookshelf', s.side, s.u)) break;
  }
  if (library || ctx.w * ctx.d > 140) {
    const c = ctx.corner(3.2);
    if (c) ctx.float(id(ctx, 'arm'), 'armchair', c.x, c.y, c.x < ctx.cx ? 'E' : 'W');
  }
}

export function laundry(ctx: RoomCtx) {
  const s = firstSlot(ctx, sidesForBig(ctx), [[4.8, 2.3, 3]], 3.2);
  if (!s) return;
  ctx.wall(id(ctx, 'washer'), 'washer', s.side, s.u - 1.2);
  ctx.wall(id(ctx, 'dryer'), 'dryer', s.side, s.u + 1.2);
  const sink = firstSlot(ctx, sidesForBig(ctx), [[2, 1.8, 2.5]], 3);
  if (sink) ctx.wall(id(ctx, 'sink'), 'utility_sink', sink.side, sink.u);
}

export function mudroom(ctx: RoomCtx) {
  const s = firstSlot(ctx, sidesForBig(ctx), [
    [6, 1.4, 3],
    [5, 1.4, 3],
    [4, 1.4, 2.5],
    [3, 1.4, 2.5],
  ], 6);
  if (s) ctx.wall(id(ctx, 'cubbies'), 'cubbies', s.side, s.u, [s.w, 1.4]);
}

export function entry(ctx: RoomCtx) {
  if (ctx.w * ctx.d < 45) return;
  const s = firstSlot(ctx, sidesForBig(ctx), [[4, 1.4, 3]], 1.5);
  if (s) ctx.wall(id(ctx, 'bench'), 'bench', s.side, s.u);
}

export function garage(ctx: RoomCtx) {
  for (const door of ctx.openings.filter((o) => o.type === 'garage_door')) {
    const sf = ctx.frame(door.here);
    if (!sf) continue;
    const c = (door.u0 + door.u1) / 2;
    const cars = door.u1 - door.u0 >= 14 ? [c - 4.6, c + 4.6] : [c];
    cars.forEach((u, k) => {
      const [x, y] = ctx.point(door.here, u, 1.5 + 7.5);
      ctx.float(id(ctx, `car${k + 1}`), 'car', x, y, OPPOSITE[door.here]);
    });
    // A workbench on the back wall if the cars leave room.
    const back = OPPOSITE[door.here];
    const wb = ctx.wallSlot(back, 6, 2.2 + 2, 3);
    if (wb) ctx.wall(id(ctx, 'bench'), 'workbench', back, wb.u);
  }
}

export function closet(ctx: RoomCtx, pantry: boolean) {
  const kind = pantry ? 'pantry_shelving' : 'closet_shelving';
  const d = pantry ? 1.3 : 2;
  let n = 0;
  for (const s of [...SIDES].sort((a, b) => ctx.across(a) - ctx.across(b))) {
    for (const [a, b] of ctx.freeAlong(s, d + 1.5, 7)) {
      if (b - a < 2.5) continue;
      if (ctx.wall(id(ctx, `sh${++n}`), kind, s, (a + b) / 2, [b - a, d])) break;
    }
    if (n >= 3) break;
  }
}

// --- outdoors ---------------------------------------------------------------------------------------

export function porch(ctx: RoomCtx, screened: boolean) {
  if (screened) return living(ctx, {});
  // Rocking chairs either side of the door that opens onto the porch, looking out.
  const door = ctx.openings.find((o) => o.type !== 'window' && o.type !== 'picture_window' && o.type !== 'transom' && o.type !== 'garage_door');
  if (door) {
    const out = OPPOSITE[door.here];
    let k = 0;
    for (const u of [door.u0 - 2.3, door.u1 + 2.3]) {
      const [x, y] = ctx.point(door.here, u, 2.2);
      if (ctx.float(id(ctx, `rock${++k}`), 'rocking_chair', x, y, out)) {
        const [tx, ty] = ctx.point(door.here, u + (u < door.u0 ? -1.9 : 1.9), 1.9);
        if (k === 1) ctx.float(id(ctx, 'side'), 'side_table', tx, ty, out, [1.4, 1.4]);
      }
    }
    // A swing hung toward the far end of a deep enough porch.
    const sf = ctx.frame(door.here)!;
    if (ctx.across(door.here) >= 7) {
      const far = Math.abs(sf.b - door.u1) > Math.abs(door.u0 - sf.a) ? sf.b - 3.5 : sf.a + 3.5;
      const [x, y] = ctx.point(door.here, far, 2.6);
      ctx.float(id(ctx, 'swing'), 'porch_swing', x, y, out);
    }
  }
}

export function deck(ctx: RoomCtx) {
  if (ctx.w < 8 || ctx.d < 8) {
    const c = ctx.corner(3);
    if (c) ctx.float(id(ctx, 'chair1'), 'adirondack_chair', c.x, c.y, 'S');
    return;
  }
  const along: Side = ctx.w >= ctx.d ? 'N' : 'E';
  if (ctx.float(id(ctx, 'table'), 'outdoor_table', ctx.cx, ctx.cy, along)) {
    chairsAround(ctx, ctx.cx, ctx.cy, { w: 5, d: 3, chairs: 4, round: false }, along);
  }
  if (ctx.w * ctx.d > 220) {
    for (const k of [1, 2]) {
      const c = ctx.corner(3);
      if (c) ctx.float(id(ctx, `lounge${k}`), 'adirondack_chair', c.x, c.y, c.y < ctx.cy ? 'N' : 'S');
    }
  }
}
