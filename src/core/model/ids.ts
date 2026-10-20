import type { Project } from './schema';

export const ID_PREFIX = {
  level: 'L',
  room: 'r',
  door: 'd',
  window: 'w',
  opening: 'o',
  fixture: 'f',
  stair: 'st',
} as const;

export function allIds(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const l of p.levels) {
    ids.add(l.id);
    for (const r of l.rooms) ids.add(r.id);
    for (const o of l.openings) ids.add(o.id);
    for (const f of l.fixtures) ids.add(f.id);
    for (const s of l.stairs) ids.add(s.id);
  }
  return ids;
}

/** Hands out fresh ids like r12, w7 that are unique across the whole project. */
export class IdMint {
  private used: Set<string>;
  private counters = new Map<string, number>();

  constructor(project?: Project) {
    this.used = project ? allIds(project) : new Set();
  }

  reserve(id: string) {
    this.used.add(id);
  }

  has(id: string) {
    return this.used.has(id);
  }

  next(prefix: string): string {
    let n = this.counters.get(prefix) ?? 1;
    while (this.used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    this.counters.set(prefix, n + 1);
    this.used.add(id);
    return id;
  }
}
