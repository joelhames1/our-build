// Furniture per room for a template, plus any overlaps or pieces outside their room.
// Usage: npx tsx scripts/dev/furnish-dump.ts <template> [params-json]
import { applyOps } from '../../src/core/ops/apply';
import { parseProject } from '../../src/core/model/schema';
import { resolve } from '../../src/core/resolve';

const blank = parseProject({ v: 1, name: 'T', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main' }] });
const r = applyOps(blank, [{ op: 'use_template', template: process.argv[2] as never, params: JSON.parse(process.argv[3] ?? '{}') }]);
const res = resolve(r.project);
const ov = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) => a.x0 < b.x1 - 0.09 && b.x0 < a.x1 - 0.09 && a.y0 < b.y1 - 0.09 && b.y0 < a.y1 - 0.09;
for (const rl of res.levels) {
  console.log(`== ${rl.level.name}`);
  for (const info of rl.rooms.values()) {
    const fx = rl.fixtures.filter((f) => f.room === info.room.id);
    console.log(`  ${info.room.name.padEnd(16)} ${info.inner.x1 - info.inner.x0 | 0}x${info.inner.y1 - info.inner.y0 | 0}: ${fx.map((f) => f.kind).join(', ') || '(empty)'}`);
    for (const f of fx) {
      const i = info.inner;
      if (f.box.x0 < i.x0 - 0.06 || f.box.x1 > i.x1 + 0.06 || f.box.y0 < i.y0 - 0.06 || f.box.y1 > i.y1 + 0.06) console.log(`    OUTSIDE: ${f.id} ${f.kind}`);
    }
    for (let a = 0; a < fx.length; a++)
      for (let b = a + 1; b < fx.length; b++) {
        const A = fx[a];
        const B = fx[b];
        if (!A.solid || !B.solid) continue;
        const z = A.z0 < B.z0 + B.h && B.z0 < A.z0 + A.h;
        if (z && ov(A.box, B.box)) console.log(`    OVERLAP: ${A.id} ${A.kind} / ${B.id} ${B.kind}`);
      }
  }
}
