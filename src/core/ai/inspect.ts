import type { Resolved } from '../resolve';

/** Read-only detail lookup for the inspect tool. */
export function inspect(res: Resolved, input: { ids?: string[]; level?: string }): string {
  const out: Record<string, unknown> = {};
  const want = new Set(input.ids ?? []);
  for (const rl of res.levels) {
    const all = input.level === rl.level.id;
    for (const info of rl.rooms.values()) {
      if (!all && !want.has(info.room.id)) continue;
      const walls = rl.walls
        .filter((w) => w.pos === info.room.id || w.neg === info.room.id)
        .map((w) => {
          const host = w.pos === info.room.id ? 1 : -1;
          const side = w.axis === 'x' ? (host === 1 ? 'S' : 'N') : host === 1 ? 'W' : 'E';
          const other = host === 1 ? w.neg : w.pos;
          const used = rl.openings.filter((o) => o.wall.id === w.id).map((o) => [round(o.u0), round(o.u1), o.id]);
          return { side, kind: w.kind, other: other ?? 'outside', from: round(w.a), to: round(w.b), openings: used };
        });
      out[info.room.id] = {
        level: rl.level.id,
        room: info.room,
        clear: [round(info.clearW), round(info.clearD)],
        area: Math.round(info.netArea),
        walls,
        fixtures: rl.level.fixtures.filter((f) => f.room === info.room.id),
      };
    }
    for (const o of rl.openings) {
      if (!all && !want.has(o.id)) continue;
      out[o.id] = { level: rl.level.id, ...rl.level.openings.find((x) => x.id === o.id), resolved: { side: o.side, along: [round(o.u0), round(o.u1)], sill: o.sill, head: o.head, other: o.other ?? 'outside' } };
    }
    for (const s of rl.stairs) if (all || want.has(s.id)) out[s.id] = { level: rl.level.id, ...rl.level.stairs.find((x) => x.id === s.id), footprint: s.footprint, risers: s.risers, riser: round(s.riser * 12) + '"' };
    for (const f of rl.level.fixtures) if (want.has(f.id)) out[f.id] = { level: rl.level.id, ...f };
  }
  const missing = [...want].filter((id) => !(id in out));
  if (missing.length) out.notFound = missing;
  return JSON.stringify(out);
}

const round = (v: number) => Math.round(v * 100) / 100;
