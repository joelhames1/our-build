// ASCII map of where you can walk. Usage: [OPS='[...]'] npx tsx scripts/dev/walk-map.ts <template> [stories] [level] [x0] [x1]
import { applyOps } from '../../src/core/ops/apply';
import { parseProject } from '../../src/core/model/schema';
import { resolve } from '../../src/core/resolve';
import { pointInRing } from '../../src/core/geometry/polygon';
import { buildWalkWorld, walkableRooms } from '../../src/viewer/walk/world';

const [t, stories = '2', lv = '0', xa, xb] = process.argv.slice(2);
const blank = parseProject({ v: 1, name: 'Test', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
const extra = JSON.parse(process.env.OPS ?? '[]');
const r = applyOps(blank, [{ op: 'use_template', template: t as never, params: { stories: stories as never } }, ...extra]);
if (!r.ok) throw new Error(JSON.stringify(r.error));
const res = resolve(r.project);
const w = buildWalkWorld(res);
const L = Number(lv);
walkableRooms(w, 0.5, (g) => {
  const b = res.bounds;
  const rows: string[] = [];
  const legend = new Map<string, string>();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  w.levels[L].floors.forEach((f, k) => legend.set(f.room, letters[k]));
  for (let y = b.y1 + 1; y >= b.y0 - 2; y -= 0.5) {
    let row = `${y.toFixed(1).padStart(6)} `;
    for (let x = xa ? Number(xa) : b.x0 - 1; x <= (xb ? Number(xb) : b.x1 + 1); x += 0.5) {
      const i = Math.round((x - g.x0) / g.cell);
      const j = Math.round((y - g.y0) / g.cell);
      const k = i * g.ny + j;
      const f = w.levels[L].floors.find((fl) => pointInRing([x, y], fl.ring));
      const ch = f ? legend.get(f.room)! : ' ';
      row += !g.clear[L][k] ? '#' : g.seen[L][k] ? '.' : ch;
    }
    rows.push(row);
  }
  console.log(rows.join('\n'));
  console.log([...legend].map(([id, c]) => `${c}=${w.levels[L].floors.find((f) => f.room === id)!.name}`).join('  '));
  for (const s of [...w.levels[L].stairs, ...w.levels[L].holes]) console.log('stair', s.id, JSON.stringify(s.footprint), s.dir, 'arrival', s.arrival);
  for (const o of res.levels[L].openings) if (o.type !== 'window') console.log(' ', o.id, o.type, res.levels[L].rooms.get(o.room)?.room.name, '->', o.other ? res.levels[L].rooms.get(o.other)?.room.name : 'outside', o.axis, o.wall.coord, o.u0.toFixed(2), o.u1.toFixed(2));
});
