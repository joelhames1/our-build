import type { Issue } from '../model/issues';
import { IdMint } from '../model/ids';
import { type Level, type Opening, type Project, type Rect, type Room, type RoomType, type Side, Project as ProjectSchema, isDoorType, isEnclosed, isOutdoor, isWindowType } from '../model/schema';
import { ftIn, snap } from '../model/units';
import { type Box, boxMulti, multiArea, multiBox, pointInMulti, roomRing } from '../geometry/polygon';
import { stairSize } from '../geometry/stairs';
import { resolve } from '../resolve';
import { checkRules } from '../rules';
import { buildTemplate } from '../templates';
import { autoDress } from './helpers/autoDress';
import { furnishAll } from '../furnish';
import { DEFAULT_AREA, HALL_W, MIN_WIDTH, type PackRoom, packAlongHall } from './helpers/layout';
import { OpError, carve, difference, intersection, levelFootprint, neighbors, overlapping, roomArea, roomBox, roomMulti, setRoomShape, snapRect, stretchLevels, union } from './geom';
import { type Op, Op as OpSchema } from './schema';

export interface ApplyResult {
  ok: boolean;
  project: Project;
  /** Ids of elements added or changed. */
  changed: string[];
  /** One plain-language line per op. */
  log: string[];
  /** Automatic fixes the app made along the way. */
  fixes: string[];
  /** Guardrail findings on the resulting design. */
  issues: Issue[];
  error?: { index: number; op: string; message: string };
}

class Draft {
  mint: IdMint;
  changed = new Set<string>();
  log: string[] = [];
  fixes: string[] = [];
  constructor(public p: Project) {
    this.mint = new IdMint(p);
  }
  level(id: string): Level {
    const l = this.p.levels.find((x) => x.id === id);
    if (!l) throw new OpError(`Level "${id}" not found. Levels: ${this.p.levels.map((x) => `${x.id} ${x.name}`).join(', ')}.`);
    return l;
  }
  room(id: string): { room: Room; level: Level; li: number } {
    for (let li = 0; li < this.p.levels.length; li++) {
      const level = this.p.levels[li];
      const room = level.rooms.find((r) => r.id === id);
      if (room) return { room, level, li };
    }
    throw new OpError(`Room "${id}" not found. Rooms: ${this.p.levels.flatMap((l) => l.rooms.map((r) => `${r.id} ${r.name} (${l.id})`)).join(', ')}.`);
  }
  opening(id: string): { o: Opening; level: Level } {
    for (const level of this.p.levels) {
      const o = level.openings.find((x) => x.id === id);
      if (o) return { o, level };
    }
    throw new OpError(`Opening "${id}" not found.`);
  }
  id(prefix: string, wanted?: string): string {
    if (wanted) {
      if (this.mint.has(wanted)) throw new OpError(`Id "${wanted}" is already used.`);
      this.mint.reserve(wanted);
      return wanted;
    }
    return this.mint.next(prefix);
  }
}

export function applyOps(project: Project, rawOps: unknown[]): ApplyResult {
  const draft = new Draft(structuredClone(project));
  let index = -1;
  try {
    for (index = 0; index < rawOps.length; index++) {
      const parsed = OpSchema.safeParse(rawOps[index]);
      if (!parsed.success) throw new OpError(`Invalid op: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'op'}: ${i.message}`).join('; ')}`);
      runOp(draft, parsed.data);
    }
    index = rawOps.length;
    finalize(draft);
    const reparsed = ProjectSchema.safeParse(draft.p);
    if (!reparsed.success) throw new OpError(`The result isn't a valid design: ${reparsed.error.issues[0]?.message}`);
    const res = resolve(reparsed.data);
    const hard = res.issues.filter((i) => i.severity === 'error');
    if (hard.length) throw new OpError(hard.map((h) => h.message).join(' '));
    const issues = [...res.issues, ...checkRules(res)];
    return { ok: true, project: reparsed.data, changed: [...draft.changed], log: draft.log, fixes: draft.fixes, issues };
  } catch (e) {
    if (!(e instanceof OpError)) throw e;
    const opName = index < rawOps.length ? String((rawOps[index] as { op?: string })?.op ?? '?') : 'result';
    return { ok: false, project, changed: [], log: draft.log, fixes: [], issues: [], error: { index, op: opName, message: e.message } };
  }
}

/** Snap, tidy references, regenerate automatic doors/windows/furniture. */
function finalize(d: Draft) {
  const p = d.p;
  for (const level of p.levels) {
    for (const r of level.rooms) {
      if (r.rect) r.rect = snapRect(r.rect);
      if (r.rect && (r.rect[2] < 1 || r.rect[3] < 1)) throw new OpError(`${r.name} would be thinner than a foot.`);
    }
    const ids = new Set(level.rooms.map((r) => r.id));
    const before = level.openings.length;
    level.openings = level.openings.filter((o) => ids.has(o.room) && (!o.to || o.to === 'outside' || ids.has(o.to)));
    if (level.openings.length < before && level.openings.some((o) => !o.auto)) d.fixes.push(`Removed ${before - level.openings.length} door/window(s) that belonged to rooms that are gone.`);
    level.fixtures = level.fixtures.filter((f) => ids.has(f.room));
    const sBefore = level.stairs.length;
    level.stairs = level.stairs.filter((s) => ids.has(s.room));
    if (level.stairs.length < sBefore) d.fixes.push('Removed stairs whose room is gone.');
  }
  if (p.roof.chimney && !p.levels.some((l) => l.rooms.some((r) => r.id === p.roof.chimney!.room))) {
    p.roof.chimney = null;
    d.fixes.push('Removed the chimney: its room is gone.');
  }
  // Stairs need somewhere to go.
  const top = p.levels[p.levels.length - 1];
  if (top.stairs.length) {
    d.fixes.push(`Removed the stairs on ${top.name}: there's no floor above them.`);
    top.stairs = [];
  }
  d.fixes.push(...autoDress(p));
  furnishAll(p);
}

function runOp(d: Draft, op: Op) {
  const p = d.p;
  switch (op.op) {
    case 'use_template': {
      const next = buildTemplate(op.template, op.params ?? {}, { site: p.site, style: p.style, name: p.name, brief: p.brief, notes: p.notes });
      p.levels = next.levels;
      p.roof = next.roof;
      p.style = next.style;
      p.site = { ...next.site, setting: p.site.setting, water: p.site.water.length ? p.site.water : next.site.water };
      d.mint = new IdMint(p);
      d.log.push(`Started from the ${op.template.replace('_', ' ')} plan.`);
      for (const l of p.levels) for (const r of l.rooms) d.changed.add(r.id);
      return;
    }
    case 'set_style': {
      const { op: _, ...rest } = op;
      Object.assign(p.style, clean(rest));
      d.log.push(`Updated the style (${Object.keys(clean(rest)).join(', ')}).`);
      return;
    }
    case 'set_site': {
      const { op: _, ...rest } = op;
      Object.assign(p.site, clean(rest));
      d.log.push(`Updated the setting (${Object.keys(clean(rest)).join(', ')}).`);
      return;
    }
    case 'set_roof': {
      const { op: _, ...rest } = op;
      Object.assign(p.roof, clean(rest));
      d.log.push(`Updated the roof (${Object.keys(clean(rest)).join(', ')}).`);
      return;
    }
    case 'set_name':
      p.name = op.name;
      d.log.push(`Renamed the project "${op.name}".`);
      return;
    case 'note':
      if (op.add && !p.notes.includes(op.add)) p.notes.push(op.add);
      if (op.remove) p.notes = p.notes.filter((n) => n !== op.remove);
      return;

    case 'add_level':
      return addLevel(d, op);
    case 'update_level': {
      const l = d.level(op.level);
      if (op.name !== undefined) l.name = op.name;
      if (op.kind !== undefined) l.kind = op.kind;
      if (op.ceiling !== undefined) l.ceiling = op.ceiling;
      if (op.kneeWall !== undefined) l.kneeWall = op.kneeWall;
      d.changed.add(l.id);
      d.log.push(`Updated ${l.name}.`);
      return;
    }
    case 'remove_level': {
      const li = p.levels.findIndex((l) => l.id === op.level);
      if (li < 0) d.level(op.level);
      if (p.levels.length === 1) throw new OpError("Can't remove the only level.");
      const [gone] = p.levels.splice(li, 1);
      if (li > 0 && li === p.levels.length) p.levels[li - 1].stairs = [];
      d.log.push(`Removed ${gone.name} (${gone.rooms.filter((r) => isEnclosed(r.type)).map((r) => r.name).join(', ') || 'empty'}).`);
      return;
    }

    case 'add_room':
      return addRoom(d, op);
    case 'update_room': {
      const { room, level } = d.room(op.room);
      for (const k of ['name', 'type', 'ceiling', 'floor', 'wallColor', 'covered', 'furnish'] as const) if (op[k] !== undefined) (room as Record<string, unknown>)[k] = op[k];
      if (op.rect || op.poly) {
        const probe: Room = { ...room, rect: op.rect ? snapRect(op.rect) : undefined, poly: op.poly };
        if (!op.poly) delete probe.poly;
        const clash = overlapping(level, roomMulti(probe), [room.id]);
        if (clash.length) throw new OpError(`That shape overlaps ${clash.map((c) => c.room.name).join(', ')}. Use resize_room (take) or carve space first.`);
        room.rect = probe.rect;
        room.poly = probe.poly;
        if (!room.poly) delete room.poly;
        if (!room.rect) delete room.rect;
      }
      if (op.type === 'kitchen' && !room.kitchen) room.kitchen = { shape: 'L', island: false };
      if ((op.type === 'bath' || op.type === 'half_bath') && !room.bath) room.bath = { bathing: op.type === 'half_bath' ? 'none' : 'tub_shower', vanity: 'single' };
      d.changed.add(room.id);
      d.log.push(`Updated ${room.name}.`);
      return;
    }
    case 'resize_room':
      return resizeRoom(d, op.room, op.side, op.by, op.mode);
    case 'move_room': {
      const { room, level } = d.room(op.room);
      if (!room.rect) throw new OpError(`${room.name} isn't a simple rectangle; reshape it with update_room.`);
      const old = roomMulti(room);
      room.rect = snapRect([room.rect[0] + op.dx, room.rect[1] + op.dy, room.rect[2], room.rect[3]]);
      const now = roomMulti(room);
      const vacated = difference(old, now);
      const { removed } = carve(level, now, [room.id]);
      if (removed.length) d.fixes.push(`${removed.length} room(s) were covered completely and removed.`);
      giveToNeighbor(level, vacated, [room.id]);
      d.changed.add(room.id);
      d.log.push(`Moved ${room.name}.`);
      return;
    }
    case 'stretch': {
      const levels = op.levels === 'all' ? p.levels : op.levels.map((id) => d.level(id));
      const gone = stretchLevels(levels, op.axis, op.at, op.by, 1);
      if (gone.length) d.fixes.push(`Removed ${gone.length} room(s) squeezed to nothing.`);
      d.log.push(`Stretched ${op.axis === 'x' ? 'east–west' : 'north–south'} by ${ftIn(op.by)}.`);
      return;
    }
    case 'grow_level':
      return growLevel(d, op.level, op.addArea, op.axis);
    case 'add_wing':
      return addWing(d, op);
    case 'layout_level':
      return layoutLevel(d, op.level, op.rooms, op.keep);
    case 'split_room': {
      const { room, level } = d.room(op.room);
      const b = roomBox(room);
      const lo = op.axis === 'x' ? b.x0 : b.y0;
      const hi = op.axis === 'x' ? b.x1 : b.y1;
      if (op.at <= lo + 1 || op.at >= hi - 1) throw new OpError(`Split line must be inside ${room.name} (${op.axis}=${lo}..${hi}).`);
      const first: Box = op.axis === 'x' ? { ...b, x1: snap(op.at) } : { ...b, y1: snap(op.at) };
      const second: Box = op.axis === 'x' ? { ...b, x0: snap(op.at) } : { ...b, y0: snap(op.at) };
      const whole = roomMulti(room);
      const [aSpec, bSpec] = op.into;
      setRoomShape(room, intersection(whole, boxMulti(first)));
      room.name = aSpec.name;
      room.type = aSpec.type;
      if (aSpec.kitchen) room.kitchen = aSpec.kitchen;
      if (aSpec.bath) room.bath = aSpec.bath;
      const nb: Room = newRoom(d, bSpec, [0, 0, 1, 1]);
      setRoomShape(nb, intersection(whole, boxMulti(second)));
      level.rooms.push(nb);
      reassignOpenings(level, room, nb);
      d.changed.add(room.id).add(nb.id);
      d.log.push(`Split it into ${room.name} and ${nb.name}.`);
      return;
    }
    case 'merge_rooms': {
      const found = op.rooms.map((id) => d.room(id));
      const level = found[0].level;
      if (found.some((f) => f.level !== level)) throw new OpError('Rooms to merge must be on the same level.');
      const region = union(...found.map((f) => roomMulti(f.room)));
      if (region.length !== 1) throw new OpError("Those rooms don't touch, so they can't be merged.");
      const keep = found[0].room;
      const others = found.slice(1).map((f) => f.room.id);
      setRoomShape(keep, region);
      keep.name = op.into.name;
      keep.type = op.into.type;
      if (op.into.kitchen) keep.kitchen = op.into.kitchen;
      if (op.into.bath) keep.bath = op.into.bath;
      level.rooms = level.rooms.filter((r) => !others.includes(r.id));
      level.openings = level.openings.filter((o) => !(others.includes(o.room) && (o.to === keep.id || others.includes(o.to ?? ''))) && !(o.room === keep.id && others.includes(o.to ?? '')));
      for (const o of level.openings) {
        if (others.includes(o.room)) o.room = keep.id;
        if (o.to && others.includes(o.to)) o.to = keep.id;
      }
      for (const f of level.fixtures) if (others.includes(f.room)) f.room = keep.id;
      for (const s of level.stairs) if (others.includes(s.room)) s.room = keep.id;
      d.changed.add(keep.id);
      d.log.push(`Merged into ${keep.name} (${Math.round(roomArea(keep))} sf).`);
      return;
    }
    case 'swap_rooms': {
      const a = d.room(op.a).room;
      const b = d.room(op.b).room;
      for (const k of ['name', 'type', 'kitchen', 'bath', 'floor', 'wallColor', 'ceiling', 'furnish'] as const) {
        const t = a[k];
        (a as Record<string, unknown>)[k] = b[k];
        (b as Record<string, unknown>)[k] = t;
        if (a[k] === undefined) delete (a as Record<string, unknown>)[k];
        if (b[k] === undefined) delete (b as Record<string, unknown>)[k];
      }
      for (const l of p.levels) l.fixtures = l.fixtures.filter((f) => !(f.auto && (f.room === a.id || f.room === b.id)));
      d.changed.add(a.id).add(b.id);
      d.log.push(`Swapped ${b.name} and ${a.name}.`);
      return;
    }
    case 'remove_room': {
      const { room, level } = d.room(op.room);
      const region = roomMulti(room);
      level.rooms = level.rooms.filter((r) => r.id !== room.id);
      level.stairs = level.stairs.filter((s) => s.room !== room.id);
      level.fixtures = level.fixtures.filter((f) => f.room !== room.id);
      if (op.fill === 'neighbor') {
        const into = op.into ? d.room(op.into).room : undefined;
        const got = giveToNeighbor(level, region, [], into);
        if (got) {
          for (const o of level.openings) {
            if (o.room === room.id) o.room = got.id;
            if (o.to === room.id) o.to = got.id;
          }
          level.openings = level.openings.filter((o) => o.room !== o.to);
          d.log.push(`Removed ${room.name}; ${got.name} takes its space.`);
          d.changed.add(got.id);
          return;
        }
      }
      d.log.push(`Removed ${room.name}.`);
      return;
    }

    case 'add_opening': {
      const { op: _, id, ...rest } = op;
      const { room, level } = d.room(rest.room);
      if (rest.to && rest.to !== 'outside' && !level.rooms.some((r) => r.id === rest.to)) throw new OpError(`"${rest.to}" isn't a room on ${level.name}.`);
      const prefix = isWindowType(rest.type) ? 'w' : isDoorType(rest.type) ? 'd' : 'o';
      const o = { ...rest, id: d.id(prefix, id), auto: false } as Opening;
      level.openings.push(o);
      d.changed.add(o.id);
      d.log.push(`Added a ${rest.type.replace('_', ' ')} to ${room.name}.`);
      return;
    }
    case 'update_opening': {
      const { o, level } = d.opening(op.opening);
      const { op: _, opening, ...rest } = op;
      const wasAuto = o.auto;
      Object.assign(o, clean(rest), { auto: false });
      // Pinned auto openings get a permanent id so later regenerations leave them alone.
      if (wasAuto) {
        if (!level.suppress.includes(o.id)) level.suppress.push(o.id);
        const fresh = d.id(isWindowType(o.type) ? 'w' : isDoorType(o.type) ? 'd' : 'o');
        d.log.push(`Updated ${opening} (now ${fresh}).`);
        o.id = fresh;
      } else d.log.push(`Updated ${opening}.`);
      d.changed.add(o.id);
      return;
    }
    case 'remove_opening': {
      const { o, level } = d.opening(op.opening);
      level.openings = level.openings.filter((x) => x !== o);
      // Automatic ones would come right back; remember that this one was turned down.
      if (o.auto && !level.suppress.includes(o.id)) level.suppress.push(o.id);
      d.log.push(`Removed ${op.opening}.`);
      return;
    }

    case 'set_kitchen': {
      const { room } = d.room(op.room);
      const { op: _, room: __, remove, ...spec } = op;
      if (remove) delete room.kitchen;
      else {
        room.kitchen = { shape: 'L', island: false, ...room.kitchen, ...clean(spec) };
        if (room.kitchen.sink === 'island' || room.kitchen.range === 'island') room.kitchen.island = true;
        if (room.type !== 'kitchen') room.type = 'kitchen';
      }
      d.changed.add(room.id);
      d.log.push(`Updated the kitchen in ${room.name}.`);
      return;
    }
    case 'set_bath': {
      const { room } = d.room(op.room);
      const { op: _, room: __, remove, ...spec } = op;
      if (remove) delete room.bath;
      else room.bath = { bathing: 'tub_shower', vanity: 'single', ...room.bath, ...clean(spec) };
      d.changed.add(room.id);
      d.log.push(`Updated the bath in ${room.name}.`);
      return;
    }
    case 'add_fixture': {
      const { op: _, id, ...rest } = op;
      const { level, room } = d.room(rest.room);
      const f = { ...rest, id: d.id('f', id), auto: false };
      level.fixtures.push(f as Level['fixtures'][number]);
      d.changed.add(f.id);
      d.log.push(`Added ${rest.kind.replace(/_/g, ' ')} to ${room.name}.`);
      return;
    }
    case 'update_fixture': {
      for (const level of p.levels) {
        const f = level.fixtures.find((x) => x.id === op.fixture);
        if (!f) continue;
        const { op: _, fixture, ...rest } = op;
        Object.assign(f, clean(rest), { auto: false });
        if (rest.room && rest.room !== f.room) d.room(rest.room);
        d.changed.add(f.id);
        d.log.push(`Updated ${fixture}.`);
        return;
      }
      throw new OpError(`Fixture "${op.fixture}" not found.`);
    }
    case 'remove_fixture': {
      for (const level of p.levels) {
        const n = level.fixtures.length;
        const gone = level.fixtures.find((f) => f.id === op.fixture);
        level.fixtures = level.fixtures.filter((f) => f.id !== op.fixture);
        // Auto pieces would come right back; remember that this one was taken out.
        if (gone?.auto && !level.suppress.includes(gone.id)) level.suppress.push(gone.id);
        if (level.fixtures.length < n) {
          d.log.push(`Removed ${op.fixture}.`);
          return;
        }
      }
      throw new OpError(`Fixture "${op.fixture}" not found.`);
    }
    case 'furnish': {
      const { room, level } = d.room(op.room);
      room.furnish = op.mode;
      level.fixtures = level.fixtures.filter((f) => !(f.room === room.id && f.auto));
      d.changed.add(room.id);
      d.log.push(op.mode === 'auto' ? `Re-furnished ${room.name}.` : `Cleared the furniture in ${room.name}.`);
      return;
    }
    case 'add_stairs': {
      const { op: _, id, ...rest } = op;
      const { room, level, li } = d.room(rest.room);
      if (li === p.levels.length - 1) throw new OpError('There is no level above for these stairs to reach. Add a level first.');
      const s = { ...rest, id: d.id('st', id) };
      level.stairs.push(s as Level['stairs'][number]);
      d.changed.add(s.id);
      d.log.push(`Added stairs in ${room.name}.`);
      return;
    }
    case 'update_stairs': {
      for (const level of p.levels) {
        const s = level.stairs.find((x) => x.id === op.stairs);
        if (!s) continue;
        const { op: _, stairs, ...rest } = op;
        Object.assign(s, clean(rest));
        d.changed.add(s.id);
        d.log.push(`Updated stairs ${stairs}.`);
        return;
      }
      throw new OpError(`Stairs "${op.stairs}" not found.`);
    }
    case 'remove_stairs': {
      for (const level of p.levels) {
        const n = level.stairs.length;
        level.stairs = level.stairs.filter((s) => s.id !== op.stairs);
        if (level.stairs.length < n) {
          d.log.push(`Removed stairs ${op.stairs}.`);
          return;
        }
      }
      throw new OpError(`Stairs "${op.stairs}" not found.`);
    }
  }
}

const clean = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Room names stay unique across the whole house ("Bedroom 3", not a second "Bedroom 2"). */
function uniqueName(d: Draft, name: string, type: RoomType): { name: string; type: RoomType } {
  const all = d.p.levels.flatMap((l) => l.rooms);
  if (type === 'primary_bedroom' && all.some((r) => r.type === 'primary_bedroom')) {
    type = 'bedroom';
    name = 'Bedroom';
  }
  if (type === 'bath' && /^primary bath/i.test(name) && all.some((r) => /^primary bath/i.test(r.name))) name = 'Bath';
  const taken = new Set(all.map((r) => r.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return { name, type };
  const base = name.replace(/\s+\d+$/, '');
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return { name: `${base} ${n}`, type };
}

function newRoom(d: Draft, given: { id?: string; name: string; type: RoomType; kitchen?: Room['kitchen']; bath?: Room['bath'] }, rect: Rect): Room {
  const spec = { ...given, ...uniqueName(d, given.name, given.type) };
  const r: Room = { id: d.id('r', spec.id), name: spec.name, type: spec.type, rect, ceiling: 'flat', furnish: 'auto' };
  if (spec.kitchen) r.kitchen = spec.kitchen;
  else if (spec.type === 'kitchen') r.kitchen = { shape: 'L', island: false };
  if (spec.bath) r.bath = spec.bath;
  else if (spec.type === 'bath') r.bath = { bathing: 'tub_shower', vanity: 'single' };
  else if (spec.type === 'half_bath') r.bath = { bathing: 'none', vanity: 'single' };
  if (isOutdoor(spec.type) && spec.type !== 'deck' && spec.type !== 'patio') r.covered = true;
  return r;
}

/** Give a freed region to the neighbor sharing the most boundary with it. */
function giveToNeighbor(level: Level, region: ReturnType<typeof roomMulti>, except: string[], prefer?: Room): Room | null {
  if (!region.length || multiArea(region) < 0.5) return null;
  const probe: Room = { id: '__probe', name: '', type: 'hall', ceiling: 'flat', furnish: 'none', poly: region[0][0] };
  const candidates = neighbors(level, probe).filter((n) => !except.includes(n.room.id) && isEnclosed(n.room.type) === true);
  const target = prefer && candidates.some((c) => c.room === prefer) ? prefer : candidates[0]?.room;
  if (!target) return null;
  const merged = union(roomMulti(target), region);
  if (merged.length !== 1) return null;
  setRoomShape(target, merged);
  return target;
}

/** After a split, openings that now sit on the new room's walls move to it. */
function reassignOpenings(level: Level, a: Room, b: Room) {
  const bRing = roomRing(b);
  const res = { x0: Math.min(...bRing.map((p) => p[0])), x1: Math.max(...bRing.map((p) => p[0])), y0: Math.min(...bRing.map((p) => p[1])), y1: Math.max(...bRing.map((p) => p[1])) };
  const aBox = roomBox(a);
  for (const o of level.openings) {
    if (o.room !== a.id || !o.side) continue;
    // Decide by which part owns the side the opening is on.
    const onB = (o.side === 'E' && res.x1 > aBox.x1) || (o.side === 'W' && res.x0 < aBox.x0) || (o.side === 'N' && res.y1 > aBox.y1) || (o.side === 'S' && res.y0 < aBox.y0);
    if (onB) o.room = b.id;
  }
}

function resizeRoom(d: Draft, id: string, side: Side, by: number, mode: 'take' | 'push') {
  const { room, level } = d.room(id);
  const b = roomBox(room);
  by = snap(by);
  if (!by) return;
  if (mode === 'push') {
    const axis = side === 'E' || side === 'W' ? 'x' : 'y';
    const at = side === 'E' ? b.x1 : side === 'W' ? b.x0 : side === 'N' ? b.y1 : b.y0;
    const dir = side === 'E' || side === 'N' ? 1 : -1;
    // Stacked floors move together so their outside walls stay lined up.
    const gone = stretchLevels(d.p.levels, axis, at, by, dir);
    if (gone.length) d.fixes.push(`Removed ${gone.length} room(s) squeezed to nothing.`);
    d.changed.add(room.id);
    d.log.push(`${by > 0 ? 'Grew' : 'Shrank'} ${room.name} ${by > 0 ? 'by' : 'by'} ${ftIn(Math.abs(by))} on the ${sideWord(side)}, shifting what's beyond.`);
    return;
  }
  const strip: Box =
    side === 'E'
      ? { x0: Math.min(b.x1, b.x1 + by), x1: Math.max(b.x1, b.x1 + by), y0: b.y0, y1: b.y1 }
      : side === 'W'
        ? { x0: Math.min(b.x0, b.x0 - by), x1: Math.max(b.x0, b.x0 - by), y0: b.y0, y1: b.y1 }
        : side === 'N'
          ? { y0: Math.min(b.y1, b.y1 + by), y1: Math.max(b.y1, b.y1 + by), x0: b.x0, x1: b.x1 }
          : { y0: Math.min(b.y0, b.y0 - by), y1: Math.max(b.y0, b.y0 - by), x0: b.x0, x1: b.x1 };
  const stripM = boxMulti(strip);
  if (by > 0) {
    const victims = overlapping(level, stripM, [room.id]);
    for (const v of victims) {
      const left = difference(roomMulti(v.room), stripM);
      const lb = multiArea(left) > 0 ? multiBox(left) : null;
      const minW = MIN_WIDTH[v.room.type] ?? 3;
      if (!lb || Math.min(lb.x1 - lb.x0, lb.y1 - lb.y0) < Math.min(minW, 3)) {
        throw new OpError(`Growing ${room.name} ${ftIn(by)} to the ${sideWord(side)} would squeeze ${v.room.name} to nothing. Try a smaller amount, mode "push", or remove ${v.room.name}.`);
      }
    }
    carve(level, stripM, [room.id]);
    setRoomShape(room, union(roomMulti(room), stripM));
    d.log.push(`Grew ${room.name} ${ftIn(by)} to the ${sideWord(side)}${victims.length ? ` (taking space from ${victims.map((v) => v.room.name).join(', ')})` : ''}.`);
    for (const v of victims) d.changed.add(v.room.id);
  } else {
    setRoomShape(room, difference(roomMulti(room), stripM));
    const got = giveToNeighbor(level, stripM, [room.id]);
    d.log.push(`Shrank ${room.name} ${ftIn(-by)} on the ${sideWord(side)}${got ? `; ${got.name} grows into the space` : ''}.`);
    if (got) d.changed.add(got.id);
  }
  d.changed.add(room.id);
}

const sideWord = (s: Side) => ({ N: 'north', E: 'east', S: 'south', W: 'west' })[s];

function addRoom(d: Draft, op: Extract<Op, { op: 'add_room' }>) {
  const level = d.level(op.level);
  if (op.rect || op.poly) {
    const r = newRoom(d, op, op.rect ? snapRect(op.rect) : [0, 0, 1, 1]);
    if (op.poly) {
      r.poly = op.poly;
      delete r.rect;
    }
    const region = roomMulti(r);
    const clash = overlapping(level, region);
    if (clash.length && !op.carve) throw new OpError(`That spot overlaps ${clash.map((c) => `${c.room.name} (${c.room.id})`).join(', ')}. Set carve: true to take the space, or pick another rect.`);
    if (clash.length) carve(level, region);
    level.rooms.push(r);
    d.changed.add(r.id);
    d.log.push(`Added ${r.name} (${Math.round(roomArea(r))} sf) on ${level.name}.`);
    return;
  }
  // No rect: attach outside the house like a one-room wing.
  addWing(d, { op: 'add_wing', level: level.id, side: op.side ?? bestSide(level, op.connectTo ? d.room(op.connectTo).room : undefined), rooms: [{ id: op.id, name: op.name, type: op.type, area: op.area, minWidth: op.minWidth, kitchen: op.kitchen, bath: op.bath }], connectTo: op.connectTo, corridor: 'no' });
}

/** The side of a room (or the level) with the most open exterior length. */
function bestSide(level: Level, near?: Room): Side {
  const foot = levelFootprint(level, (r) => isEnclosed(r.type));
  const fb = multiBox(foot);
  if (near) {
    const b = roomBox(near);
    const cands: [Side, number][] = [
      ['N', Math.abs(b.y1 - fb.y1) < 1e-6 ? b.x1 - b.x0 : 0],
      ['S', Math.abs(b.y0 - fb.y0) < 1e-6 ? b.x1 - b.x0 : 0],
      ['E', Math.abs(b.x1 - fb.x1) < 1e-6 ? b.y1 - b.y0 : 0],
      ['W', Math.abs(b.x0 - fb.x0) < 1e-6 ? b.y1 - b.y0 : 0],
    ];
    const best = cands.sort((a, c) => c[1] - a[1])[0];
    if (best[1] > 0) return best[0];
  }
  return fb.x1 - fb.x0 >= fb.y1 - fb.y0 ? 'E' : 'N';
}

function addWing(d: Draft, op: Extract<Op, { op: 'add_wing' }>) {
  const level = d.level(op.level);
  const foot = levelFootprint(level, (r) => isEnclosed(r.type) || r.type === 'open_to_below');
  if (!foot.length) throw new OpError(`${level.name} has no rooms to attach a wing to.`);
  const fb = multiBox(foot);
  const specs: PackRoom[] = op.rooms.map((r) => ({ ...r, area: r.area ?? DEFAULT_AREA[r.type] }));
  const total = op.area ?? specs.reduce((s, r) => s + (r.area ?? 0), 0);
  const many = specs.length >= 3 && op.corridor !== 'no';
  const corridor = op.corridor === 'yes' || many;
  const sideLen = op.side === 'N' || op.side === 'S' ? fb.x1 - fb.x0 : fb.y1 - fb.y0;

  // Wing box: along the side (len) by outward (depth).
  let len: number;
  let depth: number;
  if (corridor) {
    const strip = 12;
    len = Math.min(sideLen, 2 * strip + HALL_W);
    depth = snap(Math.max(op.depth ?? 0, (total + HALL_W * 20) / len));
  } else {
    depth = snap(op.depth ?? Math.max(10, Math.min(16, Math.sqrt(total / specs.length) * 1.1)));
    len = snap(Math.min(Math.max(total / depth, 8), Math.max(sideLen, 8)));
    depth = snap(Math.max(depth, total / len));
  }
  len = snap(len);
  // Center the wing on the connecting room's span when possible.
  let center = op.side === 'N' || op.side === 'S' ? (fb.x0 + fb.x1) / 2 : (fb.y0 + fb.y1) / 2;
  if (op.connectTo) {
    const cb = roomBox(d.room(op.connectTo).room);
    center = op.side === 'N' || op.side === 'S' ? (cb.x0 + cb.x1) / 2 : (cb.y0 + cb.y1) / 2;
  }
  const lo0 = op.side === 'N' || op.side === 'S' ? fb.x0 : fb.y0;
  const hi0 = op.side === 'N' || op.side === 'S' ? fb.x1 : fb.y1;
  let a = snap(center - len / 2);
  if (len <= hi0 - lo0) a = Math.min(Math.max(a, lo0), hi0 - len);
  // Attach to the actual footprint edge along that span.
  const edge = edgeCoord(foot, op.side, a, a + len);
  const box: Box =
    op.side === 'N'
      ? { x0: a, x1: a + len, y0: edge, y1: edge + depth }
      : op.side === 'S'
        ? { x0: a, x1: a + len, y0: edge - depth, y1: edge }
        : op.side === 'E'
          ? { y0: a, y1: a + len, x0: edge, x1: edge + depth }
          : { y0: a, y1: a + len, x0: edge - depth, x1: edge };
  const clash = overlapping(level, boxMulti(box));
  if (clash.length) {
    const outdoor = clash.filter((c) => isOutdoor(c.room.type));
    if (outdoor.length === clash.length) carve(level, boxMulti(box));
    else throw new OpError(`A wing there would overlap ${clash.map((c) => c.room.name).join(', ')}.`);
  }
  const axis: 'x' | 'y' = op.side === 'N' || op.side === 'S' ? 'y' : 'x';
  const { placed, hall } = corridor ? packAlongHall(box, specs, { axis, mode: 'yes' }) : { placed: packRow(box, specs, op.side), hall: null };
  const names: string[] = [];
  for (const pl of placed) {
    const r = newRoom(d, pl.spec as never, snapRect(pl.rect));
    level.rooms.push(r);
    d.changed.add(r.id);
    names.push(r.name);
  }
  if (hall) {
    const h = newRoom(d, { name: 'Hall', type: 'hall' }, snapRect(hall));
    level.rooms.push(h);
    d.changed.add(h.id);
  }
  d.log.push(`Added a ${Math.round(total)} sf wing on the ${sideWord(op.side)} side of ${level.name}: ${names.join(', ')}.`);
}

function packRow(box: Box, specs: PackRoom[], side: Side) {
  // Rooms side by side along the house wall, each touching it.
  const axis: 'x' | 'y' = side === 'N' || side === 'S' ? 'x' : 'y';
  return packAlongHall(box, specs, { axis, mode: 'no' }).placed;
}

function edgeCoord(foot: ReturnType<typeof roomMulti>, side: Side, a: number, b: number): number {
  const fb = multiBox(foot);
  // Walk outward from the far side until the strip [a,b] is clear of the footprint.
  const mid = (a + b) / 2;
  if (side === 'N') {
    for (let y = fb.y1; y >= fb.y0; y -= 0.5) if (pointInMulti([mid, y - 0.25], foot)) return y;
    return fb.y1;
  }
  if (side === 'S') {
    for (let y = fb.y0; y <= fb.y1; y += 0.5) if (pointInMulti([mid, y + 0.25], foot)) return y;
    return fb.y0;
  }
  if (side === 'E') {
    for (let x = fb.x1; x >= fb.x0; x -= 0.5) if (pointInMulti([x - 0.25, mid], foot)) return x;
    return fb.x1;
  }
  for (let x = fb.x0; x <= fb.x1; x += 0.5) if (pointInMulti([x + 0.25, mid], foot)) return x;
  return fb.x0;
}

function growLevel(d: Draft, levelId: string, addArea: number, axisPref: 'auto' | 'x' | 'y' | 'both') {
  const level = d.level(levelId);
  const foot = levelFootprint(level, (r) => isEnclosed(r.type));
  const area = multiArea(foot);
  if (area < 1) throw new OpError(`${level.name} has no rooms to grow.`);
  if (area + addArea < 150) throw new OpError(`That would leave ${level.name} too small.`);
  const fb = multiBox(foot);
  const W = fb.x1 - fb.x0;
  const D = fb.y1 - fb.y0;
  const plan: { axis: 'x' | 'y'; by: number }[] = [];
  const single = (axis: 'x' | 'y') => ({ axis, by: snap(addArea / (axis === 'x' ? D : W)) });
  if (axisPref === 'x' || axisPref === 'y') plan.push(single(axisPref));
  else {
    const s = single(W >= D ? 'x' : 'y');
    const long = W >= D ? W : D;
    if (axisPref === 'both' || Math.abs(s.by) > long * 0.35) {
      const f = Math.sqrt((area + addArea) / area);
      plan.push({ axis: 'x', by: snap(W * (f - 1)) }, { axis: 'y', by: snap(D * (f - 1)) });
    } else plan.push(s);
  }
  for (const step of plan) {
    if (!step.by) continue;
    const at = bestStretchLine(level, step.axis);
    stretchLevels([level], step.axis, at, step.by, 1);
  }
  const after = multiArea(levelFootprint(level, (r) => isEnclosed(r.type)));
  for (const r of level.rooms) d.changed.add(r.id);
  d.log.push(`${addArea >= 0 ? 'Grew' : 'Shrank'} ${level.name} from ${Math.round(area)} to ${Math.round(after)} sf by stretching its living spaces.`);
}

/** A stretch line through the rooms that grow most gracefully (living spaces, bedrooms), avoiding baths and stairs. */
function bestStretchLine(level: Level, axis: 'x' | 'y'): number {
  const weight: Partial<Record<RoomType, number>> = { living: 5, great_room: 5, family: 4, dining: 3, kitchen: 2, bedroom: 3, primary_bedroom: 4, office: 2, hall: 1, loft: 3, bonus: 3, garage: 1 };
  const avoid: ReadonlySet<RoomType> = new Set(['bath', 'half_bath', 'stair_hall', 'closet', 'walk_in_closet', 'pantry', 'laundry']);
  const stairRooms = new Set(level.stairs.map((s) => s.room));
  const cands = new Set<number>();
  for (const r of level.rooms) {
    const b = roomBox(r);
    cands.add(snap(axis === 'x' ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2));
  }
  let best = 0;
  let bestScore = -Infinity;
  for (const c of cands) {
    let s = 0;
    for (const r of level.rooms) {
      const b = roomBox(r);
      const lo = axis === 'x' ? b.x0 : b.y0;
      const hi = axis === 'x' ? b.x1 : b.y1;
      if (c <= lo + 1e-6 || c >= hi - 1e-6) continue;
      if (avoid.has(r.type) || stairRooms.has(r.id)) s -= 10;
      else s += weight[r.type] ?? 1;
    }
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

function addLevel(d: Draft, op: Extract<Op, { op: 'add_level' }>) {
  const p = d.p;
  const below = p.levels[p.levels.length - 1];
  const id = d.id('L', op.id);
  const level: Level = { id, name: op.name ?? levelName(p.levels.length), kind: op.kind, ceiling: op.kind === 'full' ? 9 : 8, kneeWall: 4, rooms: [], openings: [], fixtures: [], stairs: [], suppress: [] };
  p.levels.push(level);
  d.changed.add(id);
  // Stairs up from the level below, stacked over any stairs further down.
  if (op.stairs === 'extend') ensureStairs(d, below, p.levels.length - 2);
  if (op.footprint === 'empty') {
    d.log.push(`Added ${level.name} (empty).`);
    return;
  }
  let foot = levelFootprint(below, (r) => isEnclosed(r.type));
  const program = op.program?.length ? op.program : defaultProgram(multiArea(foot), op.kind);
  // A long ranch doesn't need a whole second floor for a few bedrooms: build over part of it, around the stair.
  const need = program.reduce((sum, r) => sum + (r.area ?? DEFAULT_AREA[r.type]), 0) * 1.3;
  let partial = false;
  if (op.footprint === 'same_as_below' && multiArea(foot) > need * 1.6) {
    const part = partialFootprint(d, foot, need, p.levels.length - 2);
    if (part) {
      foot = part;
      partial = true;
    }
  }
  planInto(d, level, foot, program, below, p.levels.length - 2);
  d.log.push(`Added ${level.name}${partial ? ` over part of ${below.name} (about ${Math.round(multiArea(foot) / 10) * 10} sf)` : ''} with ${level.rooms.filter((r) => r.type !== 'hall').map((r) => r.name).join(', ')}.`);
}

/** A full-depth slice of the floor below, long enough for `need` sf, centered on where the stairs arrive. */
function partialFootprint(d: Draft, foot: ReturnType<typeof roomMulti>, need: number, belowIndex: number): ReturnType<typeof roomMulti> | null {
  const fb = multiBox(foot);
  const alongX = fb.x1 - fb.x0 >= fb.y1 - fb.y0;
  const depth = alongX ? fb.y1 - fb.y0 : fb.x1 - fb.x0;
  const lo = alongX ? fb.x0 : fb.y0;
  const hi = alongX ? fb.x1 : fb.y1;
  const len = snap(Math.max(24, need / depth));
  if (len >= hi - lo - 6) return null;
  const st = resolve(d.p).levels[belowIndex]?.stairs[0];
  let start = lo + (hi - lo - len) / 2;
  if (st) {
    // Take in the stair and a landing at the top.
    const a = (alongX ? st.footprint.x0 : st.footprint.y0) - 3;
    const b = (alongX ? st.footprint.x1 : st.footprint.y1) + 3;
    start = (a + b) / 2 - len / 2;
    if (b - a > len) return null;
  }
  start = snap(Math.min(Math.max(start, lo), hi - len));
  const box = alongX ? { x0: start, x1: start + len, y0: fb.y0, y1: fb.y1 } : { y0: start, y1: start + len, x0: fb.x0, x1: fb.x1 };
  const part = intersection(foot, boxMulti(box));
  return multiArea(part) >= need * 0.8 ? part : null;
}

const levelName = (i: number) => ['Main Floor', 'Upper Floor', 'Third Floor', 'Fourth Floor'][i] ?? `Level ${i + 1}`;

function defaultProgram(area: number, kind: 'full' | 'half' | 'loft'): PackRoom[] {
  if (kind === 'loft') return [{ name: 'Loft', type: 'loft' }];
  const usable = kind === 'half' ? area * 0.6 : area;
  if (usable < 450) return [{ name: 'Loft', type: 'loft' }];
  if (usable < 900) return [
    { name: 'Bedroom', type: 'bedroom' },
    { name: 'Bedroom 2', type: 'bedroom' },
    { name: 'Bath', type: 'bath' },
  ];
  return [
    { name: 'Primary Bedroom', type: 'primary_bedroom' },
    { name: 'Bedroom', type: 'bedroom' },
    { name: 'Bedroom 2', type: 'bedroom' },
    { name: 'Bath', type: 'bath' },
    { name: 'Primary Bath', type: 'bath' },
  ];
}

/** Make sure there are stairs climbing from `level` (index li) to the level above. */
function ensureStairs(d: Draft, level: Level, li: number) {
  if (level.stairs.length) return;
  const p = d.p;
  // Prefer to stack over stairs from further down.
  const lower = li > 0 ? p.levels[li - 1].stairs[0] : undefined;
  const res = resolve(p);
  const rl = res.levels[li];
  const size = stairSize('straight', rl.floorToFloor, 3.5);
  let host: Room | undefined;
  let at: [number, number] | undefined;
  let dir: Side = 'N';
  if (lower && res.levels[li - 1]) {
    const ls = res.levels[li - 1].stairs.find((s) => s.id === lower.id);
    if (ls) {
      const cx = (ls.footprint.x0 + ls.footprint.x1) / 2;
      const cy = (ls.footprint.y0 + ls.footprint.y1) / 2;
      host = level.rooms.find((r) => pointInMulti([cx, cy], roomMulti(r)));
      dir = lower.dir;
      // Stacking only works if you can walk back past the opening to the foot of the next flight.
      if (host && ls.shape === 'straight') {
        const hb = roomBox(host);
        const fp = ls.footprint;
        const alongY = dir === 'N' || dir === 'S';
        const pass = alongY ? Math.max(fp.x0 - hb.x0, hb.x1 - fp.x1) : Math.max(fp.y0 - hb.y0, hb.y1 - fp.y1);
        const foot = dir === 'N' ? fp.y0 - hb.y0 : dir === 'S' ? hb.y1 - fp.y1 : dir === 'E' ? fp.x0 - hb.x0 : hb.x1 - fp.x1;
        if (pass < 2.7 || foot < 0.2) host = undefined;
      }
      if (host) {
        const fb = ls.footprint;
        at = dir === 'N' ? [cx, fb.y0] : dir === 'S' ? [cx, fb.y1] : dir === 'E' ? [fb.x0, cy] : [fb.x1, cy];
      }
    }
  }
  let wall: Side | undefined;
  let shape: 'straight' | 'L' | 'U' = lower?.shape ?? 'straight';
  if (!host) {
    // Find a room where a stair fits along a wall and still leaves room to walk past it.
    // Straight first; L and U stairs are more compact.
    const order: RoomType[] = ['stair_hall', 'foyer', 'hall', 'loft', 'living', 'great_room', 'family', 'dining', 'bonus', 'office', 'mudroom'];
    const shapes = (['straight', 'L', 'U'] as const).map((sh) => ({ sh, size: stairSize(sh, rl.floorToFloor, 3.5) }));
    const pick = (r: Room): { wall: Side; dir: Side; shape: 'straight' | 'L' | 'U' } | null => {
      const b = roomBox(r);
      // Not where the stairs from below come up.
      if (rl.stairHoles.some((h) => h.footprint.x0 < b.x1 && b.x0 < h.footprint.x1 && h.footprint.y0 < b.y1 && b.y0 < h.footprint.y1)) return null;
      const w = b.x1 - b.x0;
      const dd = b.y1 - b.y0;
      const walk = r.type === 'stair_hall' || r.type === 'foyer' ? 2.5 : 3;
      const exterior = new Set(rl.walls.filter((x) => x.kind === 'exterior' && (x.pos === r.id || x.neg === r.id)).map((x) => (x.axis === 'x' ? (x.pos === r.id ? 'S' : 'N') : x.pos === r.id ? 'W' : 'E')));
      for (const { sh, size: sz } of shapes) {
        const needLen = sz.along + (sh === 'straight' ? 3 : 1);
        const needDepth = sz.across + walk;
        const sides: { wall: Side; dir: Side; ok: boolean }[] = [
          { wall: 'W', dir: 'N', ok: dd >= needLen && w >= needDepth },
          { wall: 'E', dir: 'N', ok: dd >= needLen && w >= needDepth },
          { wall: 'S', dir: 'E', ok: w >= needLen && dd >= needDepth },
          { wall: 'N', dir: 'E', ok: w >= needLen && dd >= needDepth },
        ];
        // Prefer interior walls.
        const ok = sides.filter((x) => x.ok).sort((a, b) => Number(exterior.has(a.wall)) - Number(exterior.has(b.wall)));
        if (ok[0]) return { ...ok[0], shape: sh };
      }
      return null;
    };
    const candidates = [
      ...order.flatMap((t) => level.rooms.filter((x) => x.type === t).sort((a, b) => roomArea(b) - roomArea(a))),
      ...level.rooms.filter((x) => isEnclosed(x.type) && !order.includes(x.type) && !['bath', 'half_bath', 'closet', 'pantry', 'walk_in_closet'].includes(x.type)).sort((a, b) => roomArea(b) - roomArea(a)),
    ];
    for (const r of candidates) {
      const hit = pick(r);
      if (!hit) continue;
      host = r;
      wall = hit.wall;
      dir = hit.dir;
      shape = hit.shape;
      break;
    }
    if (!host) throw new OpError(`There's no room on ${level.name} big enough for stairs (even a compact U stair needs about ${Math.ceil(shapes[2].size.along + 1)}' × ${Math.ceil(shapes[2].size.across + 3)}'). Add a stair hall first, or make a room bigger.`);
  }
  const s = { id: d.id('st'), room: host.id, shape, dir, width: 3.5, ...(shape !== 'straight' ? { turn: 'right' as const } : {}), ...(at ? { at } : {}), ...(wall ? { wall } : {}) };
  level.stairs.push(s);
  d.changed.add(s.id);
  d.fixes.push(`Added stairs in ${host.name} to reach the new floor.`);
}

/** Lay out a program in a footprint along a hall that passes the stair landing from below. */
function planInto(d: Draft, level: Level, foot: ReturnType<typeof roomMulti>, program: PackRoom[], below: Level, belowIndex: number) {
  const fb = multiBox(foot);
  const p = d.p;
  // Where does the stair arrive?
  let through: number | undefined;
  let stairBox: Box | undefined;
  if (below.stairs.length) {
    const res = resolve(p);
    const st = res.levels[belowIndex].stairs[0];
    if (st) {
      stairBox = st.footprint;
    }
  }
  const W = fb.x1 - fb.x0;
  const D = fb.y1 - fb.y0;
  // Run the hall over the stairs (in the direction they climb) so you arrive into it.
  let axis: 'x' | 'y' = W >= D ? 'x' : 'y';
  let hallAt: number | undefined;
  const HW = stairBox ? 6.5 : HALL_W;
  if (stairBox) {
    const sx = stairBox.x1 - stairBox.x0;
    const sy = stairBox.y1 - stairBox.y0;
    axis = sy >= sx ? 'y' : 'x';
    through = axis === 'x' ? (stairBox.y0 + stairBox.y1) / 2 : (stairBox.x0 + stairBox.x1) / 2;
    // Keep the stair opening against one side of the hall so the other side is a walkway past it
    // (which also lets a flight to the next floor stack right on top). Pick the side nearer the middle.
    const s0 = axis === 'x' ? stairBox.y0 : stairBox.x0;
    const s1 = axis === 'x' ? stairBox.y1 : stairBox.x1;
    const mid = axis === 'x' ? (fb.y0 + fb.y1) / 2 : (fb.x0 + fb.x1) / 2;
    hallAt = [s0 - 0.25, s1 + 0.25 - HW].sort((a, b) => Math.abs(a + HW / 2 - mid) - Math.abs(b + HW / 2 - mid))[0];
  }
  const { placed, hall } = packAlongHall(fb, program, { axis, through, hallAt, mode: program.length >= 2 ? 'yes' : 'no', width: HW });
  for (const pl of placed) {
    const r = newRoom(d, pl.spec as never, snapRect(pl.rect));
    level.rooms.push(r);
    d.changed.add(r.id);
  }
  if (hall) {
    const h = newRoom(d, { name: 'Hall', type: 'hall' }, snapRect(hall));
    level.rooms.push(h);
    d.changed.add(h.id);
    if (stairBox) {
      // Carve the stair landing area out of whatever room it lands in, into the hall.
      const landing = boxMulti({ x0: snap(stairBox.x0 - 0.25), x1: snap(stairBox.x1 + 0.25), y0: snap(stairBox.y0 - 0.25), y1: snap(stairBox.y1 + 0.25) });
      const hallRoom = h;
      const extra = difference(intersection(landing, foot), roomMulti(hallRoom));
      if (multiArea(extra) > 1) {
        carve(level, extra, [hallRoom.id]);
        const merged = union(roomMulti(hallRoom), extra);
        if (merged.length === 1) setRoomShape(hallRoom, merged);
      }
    }
  }
  // Trim anything outside the footprint (non-rectangular footprints).
  for (const r of [...level.rooms]) {
    const inside = intersection(roomMulti(r), foot);
    if (multiArea(inside) < 4) level.rooms = level.rooms.filter((x) => x !== r);
    else setRoomShape(r, inside);
  }
}

function layoutLevel(d: Draft, levelId: string, rooms: PackRoom[], keep: string[]) {
  const li = d.p.levels.findIndex((l) => l.id === levelId);
  const level = d.level(levelId);
  const foot = levelFootprint(level, (r) => isEnclosed(r.type) || r.type === 'open_to_below');
  const kept = level.rooms.filter((r) => keep.includes(r.id) || isOutdoor(r.type));
  const keptRegion = union(...kept.filter((r) => !isOutdoor(r.type)).map(roomMulti));
  const region = difference(foot, keptRegion);
  level.rooms = kept;
  level.openings = level.openings.filter((o) => kept.some((r) => r.id === o.room));
  level.fixtures = level.fixtures.filter((f) => kept.some((r) => r.id === f.room));
  level.stairs = level.stairs.filter((s) => kept.some((r) => r.id === s.room));
  const below = li > 0 ? d.p.levels[li - 1] : level;
  planInto(d, level, region, rooms, below, Math.max(li - 1, 0));
  d.log.push(`Re-planned ${level.name}: ${rooms.map((r) => r.name).join(', ')}.`);
}
