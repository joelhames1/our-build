import type { Project } from '../model/schema';
import { resolve } from '../resolve';
import { bath } from './bath';
import { RoomCtx, unblockRegion } from './context';
import { kitchen } from './kitchen';
import { bedroom, closet, deck, dining, entry, garage, laundry, living, mudroom, office, porch } from './rooms';

/**
 * "Auto until touched", for furniture: every room with furnish 'auto' gets a full set of pieces for
 * its type, rebuilt after each change. Pieces edited by hand (auto=false) stay put and the rest work
 * around them; pieces removed by hand stay gone (their ids sit in the level's suppress list).
 */
export function furnishAll(p: Project) {
  for (const level of p.levels) level.fixtures = level.fixtures.filter((f) => !f.auto);
  const res = resolve(p);
  p.levels.forEach((level, li) => {
    const rl = res.levels[li];
    const pinnedIds = new Set(level.fixtures.map((f) => f.id));
    const skip = new Set([...level.suppress, ...pinnedIds]);
    const ctxs: RoomCtx[] = [];
    for (const room of level.rooms) {
      if (room.furnish === 'none') continue;
      const info = rl.rooms.get(room.id);
      if (!info) continue;
      const ctx = new RoomCtx(rl, info, { pinned: rl.fixtures.filter((f) => f.room === room.id), skip });
      ctxs.push(ctx);
      const hasCloset = rl.openings.some((o) => (o.room === room.id && isCloset(rl.rooms.get(o.other ?? '')?.room.type)) || (o.other === room.id && isCloset(rl.rooms.get(o.room)?.room.type)));
      try {
        switch (room.type) {
          case 'kitchen':
            kitchen(ctx, room.kitchen ?? { shape: 'L', island: false });
            break;
          case 'bath':
            bath(ctx, room.bath ?? { bathing: 'tub_shower', vanity: 'single' }, false);
            break;
          case 'half_bath':
            bath(ctx, room.bath ?? { bathing: 'none', vanity: 'single' }, true);
            break;
          case 'primary_bedroom':
            bedroom(ctx, 'primary', hasCloset);
            break;
          case 'bedroom':
            bedroom(ctx, 'bedroom', hasCloset);
            break;
          case 'nursery':
            bedroom(ctx, 'nursery', true);
            break;
          case 'living':
          case 'family':
          case 'great_room':
          case 'media':
          case 'sunroom': {
            const ch = res.chimney?.room === room.id ? res.chimney : null;
            living(ctx, { fireplace: ch ? { side: ch.side, u: (ch.along.a + ch.along.b) / 2 } : undefined, big: room.type === 'great_room' });
            break;
          }
          case 'loft':
          case 'studio':
            living(ctx, {});
            break;
          case 'dining':
            dining(ctx);
            break;
          case 'office':
            office(ctx, false);
            break;
          case 'library':
            office(ctx, true);
            break;
          case 'laundry':
            laundry(ctx);
            break;
          case 'mudroom':
            mudroom(ctx);
            break;
          case 'foyer':
          case 'stair_hall':
            entry(ctx);
            break;
          case 'garage':
            garage(ctx);
            break;
          case 'walk_in_closet':
            closet(ctx, false);
            break;
          case 'pantry':
            closet(ctx, true);
            break;
          case 'porch':
            porch(ctx, false);
            break;
          case 'screened_porch':
            porch(ctx, true);
            break;
          case 'deck':
          case 'patio':
          case 'balcony':
            deck(ctx);
            break;
        }
      } catch {
        // A room that can't be furnished is simply left empty.
        ctx.out.length = 0;
      }
    }
    // Never let furniture cut the way between doorways. Rooms that open into each other are one space.
    for (const zone of openZones(ctxs)) unblockRegion(zone);
    level.fixtures.push(...ctxs.flatMap((c) => c.out));
  });
}

/** Group rooms joined by open connections (no wall between them). */
function openZones(ctxs: RoomCtx[]): RoomCtx[][] {
  const byId = new Map(ctxs.map((c) => [c.room.id, c]));
  const parent = new Map(ctxs.map((c) => [c.room.id, c.room.id]));
  const find = (a: string): string => (parent.get(a) === a ? a : find(parent.get(a)!));
  for (const c of ctxs)
    for (const o of c.openings) {
      if (o.type !== 'open') continue;
      const other = o.room === c.room.id ? o.other : o.room;
      if (other && byId.has(other)) parent.set(find(c.room.id), find(other));
    }
  const zones = new Map<string, RoomCtx[]>();
  for (const c of ctxs) {
    const k = find(c.room.id);
    if (!zones.has(k)) zones.set(k, []);
    zones.get(k)!.push(c);
  }
  return [...zones.values()];
}

const isCloset = (t?: string) => t === 'closet' || t === 'walk_in_closet';
