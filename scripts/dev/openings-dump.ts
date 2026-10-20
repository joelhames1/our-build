// Print resolved openings and stairs for a brief. Usage: npx tsx scripts/dev/openings-dump.ts "<brief>"
import { applyOps } from '../../src/core/ops/apply';
import { parseProject } from '../../src/core/model/schema';
import { resolve } from '../../src/core/resolve';
import { planFromBrief } from '../../src/lib/ai/mock';

const blank = parseProject({ v: 1, name: 'Test', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
const r = applyOps(blank, planFromBrief(process.argv[2] ?? 'A white two-story farmhouse with a wraparound porch').ops);
const res = resolve(r.project);
for (const rl of res.levels) {
  console.log(rl.level.name);
  for (const s of rl.stairs) console.log('  stair', s.id, s.room, JSON.stringify(s.footprint), s.dir, 'arrival', s.arrival);
  for (const o of rl.openings) console.log('  ', o.id.padEnd(16), o.type.padEnd(12), (rl.rooms.get(o.room)?.room.name ?? o.room).padEnd(14), '->', (o.other ? rl.rooms.get(o.other)?.room.name : 'outside')?.padEnd(14), o.axis, 'coord', o.wall.coord, 'u', o.u0.toFixed(2), o.u1.toFixed(2));
}
