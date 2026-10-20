// Usage: npx tsx scripts/dev/pdf.ts <template> <out.pdf> [tabloid|archd]
import { writeFileSync } from 'node:fs';
import { parseProject } from '../../src/core/model/schema';
import { applyOps } from '../../src/core/ops/apply';
import { resolve } from '../../src/core/resolve';
import { sheetsPdf } from '../../src/drawings/render/pdf';
import { buildSheets } from '../../src/drawings/sheets';

const [t = 'farmhouse', out = 'out.pdf', paper = 'tabloid'] = process.argv.slice(2);
const blank = parseProject({ v: 1, name: 'Hillside Farmhouse', brief: 'A modern farmhouse for a meadow with a deep front porch, a big kitchen for cooking together and a wood stove.', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
const r = applyOps(blank, [{ op: 'use_template', template: t as never }]);
const res = resolve(r.project);
const t0 = Date.now();
const sheets = buildSheets(res, { paper: paper as 'tabloid' | 'archd', date: new Date(2026, 9, 20) });
const t1 = Date.now();
const doc = sheetsPdf(sheets);
writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log(`${sheets.length} sheets: layout ${t1 - t0} ms, pdf ${Date.now() - t1} ms`);
