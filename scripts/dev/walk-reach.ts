// Which rooms can't you walk into? Checks every template at 1, 1.5, 2 and 3 stories (where supported).
import { applyOps } from '../../src/core/ops/apply';
import { isEnclosed, parseProject } from '../../src/core/model/schema';
import { resolve } from '../../src/core/resolve';
import { TEMPLATE_IDS } from '../../src/core/templates/params';
import { buildWalkWorld, walkableRooms } from '../../src/viewer/walk/world';

const blank = parseProject({ v: 1, name: 'Test', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
const only = process.argv[2];
for (const t of TEMPLATE_IDS) {
  if (only && t !== only) continue;
  for (const stories of ['1', '1.5', '2', '3'] as const) {
    for (const porch of ['front', 'wrap'] as const) {
      const r = applyOps(blank, [{ op: 'use_template', template: t, params: { stories, porch } }]);
      if (!r.ok) continue;
      const res = resolve(r.project);
      const t0 = performance.now();
      const reach = walkableRooms(buildWalkWorld(res));
      const ms = performance.now() - t0;
      const missing = res.levels.flatMap((rl) => [...rl.rooms.values()].filter((i) => isEnclosed(i.room.type) && !reach[rl.index].has(i.room.id)).map((i) => `${rl.level.name}/${i.room.name}`));
      console.log(`${t.padEnd(14)} ${stories.padEnd(3)} ${porch.padEnd(5)} levels=${res.levels.length} ${missing.length ? 'UNREACHABLE: ' + missing.join(', ') : 'ok'} (${ms.toFixed(0)}ms)`);
    }
  }
}
