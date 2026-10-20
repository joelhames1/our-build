import { applyOps } from '../../src/core/ops/apply';
import { parseProject } from '../../src/core/model/schema';
const blank = parseProject({ v: 1, name: 'Test', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
const [t, params] = [process.argv[2], JSON.parse(process.argv[3] ?? '{}')];
const r = applyOps(blank, [{ op: 'use_template', template: t, params }]);
for (const l of r.project.levels) {
  console.log(l.id, l.name, l.kind);
  for (const x of l.rooms) console.log('  ', x.id, x.name.padEnd(16), JSON.stringify(x.rect ?? x.poly));
  console.log('   openings:', l.openings.map((o) => `${o.id}:${o.type}:${o.room}->${o.to ?? ''}${o.side ? '@' + o.side : ''}`).join(' '));
  console.log('   stairs:', JSON.stringify(l.stairs));
}
