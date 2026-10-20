import { applyOps } from '../../src/core/ops/apply';
import { TEMPLATE_IDS } from '../../src/core/templates';
import { parseProject } from '../../src/core/model/schema';
import { resolve } from '../../src/core/resolve';

const blank = parseProject({ v: 1, name: 'Test', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
for (const t of TEMPLATE_IDS) {
  for (const params of [{}, { bedrooms: 3, porch: 'wrap' as const, front: 'E' as const }]) {
    const t0 = performance.now();
    const r = applyOps(blank, [{ op: 'use_template', template: t, params }]);
    const ms = performance.now() - t0;
    if (!r.ok) { console.log(`✗ ${t} ${JSON.stringify(params)}: ${r.error?.message}`); continue; }
    const res = resolve(r.project);
    const rooms = r.project.levels.map((l) => `${l.id}[${l.rooms.map((x) => x.name).join(', ')}]`).join(' ');
    console.log(`✓ ${t} ${JSON.stringify(params)} ${Math.round(res.grossArea)}sf ${ms.toFixed(0)}ms openings=${r.project.levels.reduce((s, l) => s + l.openings.length, 0)}`);
    console.log('   ' + rooms);
    for (const i of r.issues.filter((i) => i.severity !== 'tip')) console.log(`   ! ${i.severity} ${i.rule}: ${i.message}`);
  }
}
