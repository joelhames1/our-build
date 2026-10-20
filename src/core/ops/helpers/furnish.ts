import type { Project } from '../../model/schema';

/** Placeholder until the furniture catalog lands: keeps hand-placed pieces, clears auto ones for unfurnished rooms. */
export function furnishAll(p: Project) {
  for (const level of p.levels) {
    const rooms = new Map(level.rooms.map((r) => [r.id, r]));
    level.fixtures = level.fixtures.filter((f) => !f.auto || rooms.get(f.room)?.furnish !== 'none');
  }
}
