import type { Selection } from '@/core/ai/types';
import { fixtureSpec } from '@/core/catalog/fixtures';
import { isWindowType } from '@/core/model/schema';
import { dims, ftIn } from '@/core/model/units';
import type { Resolved } from '@/core/resolve';

const sideWord = { N: 'north', E: 'east', S: 'south', W: 'west' } as const;

/** Turn whatever was tapped in 3D (an owner id) into a selection the user and Claude understand. */
export function describeOwner(res: Resolved, owner: string): Selection | null {
  for (const rl of res.levels) {
    const info = rl.rooms.get(owner);
    if (info) {
      return { kind: 'room', id: owner, label: info.room.name, detail: `${dims(info.clearW, info.clearD)}, ${Math.round(info.netArea)} sf, ${rl.level.name}` };
    }
    const o = rl.openings.find((x) => x.id === owner);
    if (o) {
      const host = rl.rooms.get(o.room)?.room.name ?? o.room;
      const what = isWindowType(o.type) ? (o.count > 1 ? `${o.count} windows` : 'Window') : o.type === 'cased_opening' ? 'Opening' : o.type === 'garage_door' ? 'Garage door' : o.type === 'french_door' ? 'French doors' : o.type === 'slider' ? 'Sliding door' : 'Door';
      const to = o.other ? rl.rooms.get(o.other)?.room.name : 'outside';
      return { kind: 'opening', id: o.id, label: `${what} in ${host}`, detail: `${ftIn(o.unitWidth)} × ${ftIn(o.height)} on the ${sideWord[o.side]} side${isWindowType(o.type) ? '' : `, to ${to}`}` };
    }
    const s = rl.stairs.find((x) => x.id === owner);
    if (s) return { kind: 'stairs', id: s.id, label: 'Stairs', detail: `${s.shape} stair in ${rl.rooms.get(s.room)?.room.name ?? s.room}, ${ftIn(s.width)} wide` };
    const f = rl.level.fixtures.find((x) => x.id === owner);
    if (f) return { kind: 'fixture', id: f.id, label: cap(fixtureSpec(f.kind).label), detail: `in ${rl.rooms.get(f.room)?.room.name ?? f.room}` };
    const w = rl.walls.find((x) => x.id === owner);
    if (w) {
      const a = w.pos ? rl.rooms.get(w.pos)?.room.name : null;
      const b = w.neg ? rl.rooms.get(w.neg)?.room.name : null;
      const label = a && b ? `Wall between ${b} and ${a}` : `Outside wall of ${a ?? b}`;
      return { kind: 'wall', id: w.id, label, detail: `${ftIn(w.b - w.a)} long, ${rl.level.name}` };
    }
  }
  if (/^M\d+\./.test(owner)) return { kind: 'roof', id: owner, label: 'Roof', detail: `${res.project.roof.form}, ${res.project.roof.pitch}/12` };
  const lv = res.levels.find((l) => owner.startsWith(`${l.level.id}:`));
  if (lv) return { kind: 'level', id: lv.level.id, label: lv.level.name };
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
