import { multiArea, ringArea, roomRing } from '@/core/geometry/polygon';
import { isDoorType, isEnclosed, isOutdoor, isWindowType } from '@/core/model/schema';
import { dims, ftIn } from '@/core/model/units';
import type { Resolved } from '@/core/resolve';

/** A schedule as plain rows; the sheet builder draws it. Column widths are paper inches on 11×17. */
export interface Table {
  title: string;
  columns: { label: string; width: number; align?: 'left' | 'center' | 'right' }[];
  rows: string[][];
  /** Rows drawn bold with a rule above (totals). */
  totals?: number;
}

const DOOR_TYPE: Record<string, string> = {
  door: 'Swing door',
  double_door: 'Double door',
  french_door: 'French doors',
  slider: 'Sliding glass door',
  pocket_door: 'Pocket door',
  garage_door: 'Overhead garage door',
  cased_opening: 'Cased opening',
};

/**
 * Short marks for the drawing set: doors D1, D2… and windows W1, W2…, numbered level by level in
 * reading order (top to bottom, left to right). Plans tag with the same marks the schedules list.
 */
export function openingMarks(res: Resolved): Map<string, string> {
  const marks = new Map<string, string>();
  let d = 0;
  let w = 0;
  for (const rl of res.levels) {
    const list = [...rl.openings].sort((a, b) => {
      const ya = a.axis === 'x' ? a.wall.coord : (a.u0 + a.u1) / 2;
      const yb = b.axis === 'x' ? b.wall.coord : (b.u0 + b.u1) / 2;
      const xa = a.axis === 'x' ? (a.u0 + a.u1) / 2 : a.wall.coord;
      const xb = b.axis === 'x' ? (b.u0 + b.u1) / 2 : b.wall.coord;
      return Math.abs(ya - yb) > 0.5 ? yb - ya : xa - xb;
    });
    for (const o of list) {
      if (isDoorType(o.type) || o.type === 'cased_opening') marks.set(o.id, `D${++d}`);
      else if (isWindowType(o.type)) marks.set(o.id, `W${++w}`);
    }
  }
  return marks;
}

const markOrder = (a: string[], b: string[]) => Number(a[0].slice(1)) - Number(b[0].slice(1));

function roomName(res: Resolved, levelIndex: number, id: string | null) {
  if (!id) return 'Outside';
  return res.levels[levelIndex].rooms.get(id)?.room.name ?? id;
}

export function doorSchedule(res: Resolved, marks = openingMarks(res)): Table {
  const rows: string[][] = [];
  for (const rl of res.levels)
    for (const o of rl.openings) {
      if (!isDoorType(o.type) && o.type !== 'cased_opening') continue;
      const type = o.type === 'door' && o.exterior ? 'Exterior door' : DOOR_TYPE[o.type] ?? o.type;
      const where = `${roomName(res, rl.index, o.room)} to ${roomName(res, rl.index, o.other)}`;
      rows.push([marks.get(o.id) ?? o.id, type, `${ftIn(o.u1 - o.u0)} × ${ftIn(o.height)}`, where, rl.level.name]);
    }
  rows.sort(markOrder);
  return {
    title: 'Door Schedule',
    columns: [
      { label: 'MARK', width: 0.5, align: 'center' },
      { label: 'TYPE', width: 1.35 },
      { label: 'SIZE (W × H)', width: 1.1 },
      { label: 'FROM / TO', width: 2.15 },
      { label: 'LEVEL', width: 1.15 },
    ],
    rows,
  };
}

export function windowSchedule(res: Resolved, marks = openingMarks(res)): Table {
  const style = res.project.style.windows;
  const label = style === 'casement' ? 'Casement' : style === 'modern' ? 'Fixed / awning' : 'Double-hung';
  const rows: string[][] = [];
  for (const rl of res.levels)
    for (const o of rl.openings) {
      if (!isWindowType(o.type)) continue;
      const room = rl.rooms.get(o.room)?.room;
      const type = o.type === 'picture_window' ? 'Picture window' : o.type === 'transom' ? 'Transom' : label;
      // Egress: 5.7 sf clear, 20" wide, 24" high, sill no more than 44" (a rough check on the unit).
      const bedroom = room && (room.type === 'bedroom' || room.type === 'primary_bedroom');
      const operable = o.type === 'window' && style !== 'modern';
      const clearH = style === 'double_hung' ? o.height / 2 - 0.2 : o.height - 0.3;
      const egress = bedroom && operable && o.unitWidth - 0.3 >= 20 / 12 && clearH >= 2 && (o.unitWidth - 0.3) * clearH >= 5.7 && o.sill <= 44 / 12;
      rows.push([marks.get(o.id) ?? o.id, type, String(o.count), `${ftIn(o.unitWidth)} × ${ftIn(o.height)}`, ftIn(o.sill), room?.name ?? '', egress ? 'Egress' : '']);
    }
  rows.sort(markOrder);
  return {
    title: 'Window Schedule',
    columns: [
      { label: 'MARK', width: 0.5, align: 'center' },
      { label: 'TYPE', width: 1.15 },
      { label: 'UNITS', width: 0.45, align: 'center' },
      { label: 'UNIT (W × H)', width: 1.1 },
      { label: 'SILL', width: 0.55 },
      { label: 'ROOM', width: 1.5 },
      { label: 'NOTES', width: 0.6 },
    ],
    rows,
  };
}

const FLOOR_NAME: Record<string, string> = { oak: 'Oak', walnut: 'Walnut', pine: 'Pine', tile: 'Tile', stone: 'Stone', carpet: 'Carpet', concrete: 'Concrete' };

export function roomSchedule(res: Resolved): Table {
  const rows: string[][] = [];
  const p = res.project;
  for (const rl of res.levels)
    for (const info of rl.rooms.values()) {
      const r = info.room;
      if (r.type === 'open_to_below') continue;
      const outdoor = isOutdoor(r.type);
      const floor = outdoor ? (r.type === 'patio' ? 'Stone' : 'Decking') : FLOOR_NAME[r.floor ?? (r.type === 'bath' || r.type === 'half_bath' || r.type === 'laundry' || r.type === 'mudroom' ? 'tile' : r.type === 'garage' || r.type === 'mechanical' ? 'concrete' : p.style.floor)];
      const ceiling = outdoor ? (r.covered ? 'Covered' : 'Open') : r.ceiling === 'vaulted' ? 'Vaulted' : ftIn(rl.level.ceiling);
      rows.push([r.id.toUpperCase(), r.name, rl.level.name, dims(info.clearW, info.clearD), `${Math.round(info.netArea)} sf`, floor ?? '', ceiling]);
    }
  return {
    title: 'Room Schedule',
    columns: [
      { label: 'NO.', width: 0.45, align: 'center' },
      { label: 'ROOM', width: 1.5 },
      { label: 'LEVEL', width: 1.0 },
      { label: 'SIZE (CLEAR)', width: 1.55 },
      { label: 'AREA', width: 0.6, align: 'right' },
      { label: 'FLOOR', width: 0.65 },
      { label: 'CEILING', width: 0.65 },
    ],
    rows,
  };
}

/** Areas by level: heated (outside faces, garage excluded), outdoor (porches, decks) and garage. */
export function areaTable(res: Resolved): Table {
  const rows: string[][] = [];
  let heated = 0;
  let outdoor = 0;
  let garage = 0;
  const fmt = (v: number) => (v > 0.5 ? `${Math.round(v).toLocaleString('en-US')} sf` : '–');
  for (const rl of res.levels) {
    const rooms = rl.level.rooms;
    const g = rooms.filter((r) => r.type === 'garage').reduce((s, r) => s + Math.abs(ringArea(roomRing(r))), 0);
    const h = rooms.some((r) => isEnclosed(r.type) && r.type !== 'garage') ? Math.max(0, multiArea(rl.footprint) - g) : 0;
    const o = rooms.filter((r) => isOutdoor(r.type)).reduce((s, r) => s + Math.abs(ringArea(roomRing(r))), 0);
    heated += h;
    outdoor += o;
    garage += g;
    rows.push([rl.level.name, fmt(h), fmt(o), fmt(g)]);
  }
  rows.push(['Total', fmt(heated), fmt(outdoor), fmt(garage)]);
  return {
    title: 'Areas',
    columns: [
      { label: 'LEVEL', width: 1.5 },
      { label: 'HEATED', width: 0.9, align: 'right' },
      { label: 'PORCH / DECK', width: 1.0, align: 'right' },
      { label: 'GARAGE', width: 0.8, align: 'right' },
    ],
    rows,
    totals: 1,
  };
}

/** "3 bedrooms · 2.5 baths · 2,140 sf" */
export function programLine(res: Resolved): string {
  let beds = 0;
  let baths = 0;
  for (const rl of res.levels)
    for (const r of rl.level.rooms) {
      if (r.type === 'bedroom' || r.type === 'primary_bedroom') beds++;
      if (r.type === 'bath') baths += 1;
      if (r.type === 'half_bath') baths += 0.5;
    }
  const parts: string[] = [];
  if (beds) parts.push(`${beds} bedroom${beds === 1 ? '' : 's'}`);
  if (baths) parts.push(`${baths} bath${baths === 1 ? '' : 's'}`);
  parts.push(`${Math.round(res.grossArea).toLocaleString('en-US')} sf`);
  return parts.join('  ·  ');
}
