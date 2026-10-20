/**
 * Eval harness: runs a set of briefs and follow-up edits through the design assistant and writes
 * an HTML gallery (plans, replies, guardrail findings, timing and token use) to eval-out/.
 *
 *   npm run eval               live Claude (needs ANTHROPIC_API_KEY)
 *   npm run eval -- --mock     the rule-based demo engine, to check the harness itself
 *   npm run eval -- --only 3   just the third case
 *
 * Token prices are not baked in; set EVAL_PRICE_IN / EVAL_PRICE_OUT (dollars per million tokens)
 * to get a cost column.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DesignEvent, DesignRequest, Usage } from '../src/core/ai/types';
import { type Project, parseProject } from '../src/core/model/schema';
import { resolve } from '../src/core/resolve';
import { floorPlan } from '../src/drawings/plan';
import { drawingSvg } from '../src/drawings/render/svg';
import { MODEL, runDesignTurn } from '../src/lib/ai/loop';
import { runMockTurn } from '../src/lib/ai/mock';

interface Case {
  brief: string;
  edits: string[];
}

const CASES: Case[] = [
  { brief: 'A stone cottage on a little island, two bedrooms, a porch facing the water and a big fireplace.', edits: ['Make the living room bigger', 'Add a screened porch on the back'] },
  { brief: 'An A-frame cabin in the pines with a sleeping loft and a wood stove.', edits: ['Add a deck off the front'] },
  { brief: 'A modern farmhouse, white board and batten, black windows, metal roof, four bedrooms, a mudroom and a big kitchen with an island.', edits: ['Add a third story', 'Move the sink to the island', 'Remove the third floor'] },
  { brief: 'A single-story ranch for retirement: three bedrooms, everything on one level, wide halls, a two-car garage.', edits: ['Make the primary bath bigger and give it a walk-in shower'] },
  { brief: 'A lake house with a wraparound porch, a great room facing the water and a stone chimney.', edits: ['Remove the second story and expand the first floor by 1,000 square feet'] },
  { brief: 'A tiny house, about 400 square feet, for a backyard studio.', edits: ['Add a loft for sleeping'] },
  { brief: 'A Cape Cod with dormers, three bedrooms, two and a half baths.', edits: ['Change the roof to a steeper pitch', 'Add a bay window to the dining room'] },
  { brief: 'A craftsman bungalow with a deep front porch, tapered columns and a reading nook.', edits: ['Add an office off the living room'] },
  { brief: 'A minimal Scandinavian cabin by a fjord with a vaulted great room and a sauna.', edits: ['Make the windows on the water side bigger'] },
  { brief: 'A two-car garage with a studio apartment above it.', edits: ['Add a small kitchen to the studio'] },
  { brief: 'A three-story narrow townhouse-style home, 22 feet wide, with a roof deck.', edits: ['Swap the kitchen and the dining room'] },
  { brief: 'Something cozy for two with room for grandkids to visit.', edits: ['Add a bunk room'] },
];

const args = process.argv.slice(2);
const mock = args.includes('--mock');
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null;
const priceIn = Number(process.env.EVAL_PRICE_IN ?? NaN);
const priceOut = Number(process.env.EVAL_PRICE_OUT ?? NaN);

interface Step {
  request: string;
  reply: string;
  ms: number;
  usage?: Usage;
  issues: { severity: string; message: string }[];
  plans: string[];
  error?: string;
  sf: number;
}

const blank = () => parseProject({ v: 1, name: 'New design', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });

async function turn(project: Project, request: string, mode: 'create' | 'edit', history: DesignRequest['history']): Promise<{ project: Project; step: Step }> {
  const t0 = Date.now();
  let done: Extract<DesignEvent, { type: 'done' }> | null = null;
  let error: string | undefined;
  const emit = (e: DesignEvent) => {
    if (e.type === 'done') done = e;
    if (e.type === 'error') error = e.message;
  };
  const req: DesignRequest = { project, request, source: 'typed', mode, history };
  try {
    if (mock) await runMockTurn(req, emit, { delay: 0 });
    else await runDesignTurn(req, emit);
  } catch (e) {
    error = String(e);
  }
  const d = done as Extract<DesignEvent, { type: 'done' }> | null;
  const next = d ? parseProject(d.project) : project;
  const res = resolve(next);
  const plans = res.levels.map((rl) => drawingSvg(floorPlan(res, rl.index, 8)));
  return {
    project: next,
    step: { request, reply: d?.reply ?? '', ms: Date.now() - t0, usage: d?.usage, issues: (d?.issues ?? []).map((i) => ({ severity: i.severity, message: i.message })), plans, error, sf: Math.round(res.grossArea) },
  };
}

async function main() {
  const out: { c: Case; steps: Step[] }[] = [];
  for (const [i, c] of CASES.entries()) {
    if (only !== null && only !== i + 1) continue;
    console.log(`\n[${i + 1}/${CASES.length}] ${c.brief}`);
    const steps: Step[] = [];
    let { project, step } = await turn(blank(), c.brief, 'create', []);
    steps.push(step);
    log(step);
    const history: NonNullable<DesignRequest['history']> = [
      { role: 'user', text: c.brief },
      { role: 'assistant', text: step.reply },
    ];
    for (const e of c.edits) {
      ({ project, step } = await turn(project, e, 'edit', history));
      steps.push(step);
      history.push({ role: 'user', text: e }, { role: 'assistant', text: step.reply });
      log(step);
    }
    out.push({ c, steps });
  }
  mkdirSync('eval-out', { recursive: true });
  writeFileSync('eval-out/index.html', html(out));
  const all = out.flatMap((o) => o.steps);
  const tokens = all.reduce((s, x) => ({ input: s.input + (x.usage?.input ?? 0), output: s.output + (x.usage?.output ?? 0) }), { input: 0, output: 0 });
  console.log(`\n${all.length} turns, ${all.filter((s) => s.error).length} errors, median ${median(all.map((s) => s.ms))} ms, ${tokens.input} in / ${tokens.output} out tokens. Gallery: eval-out/index.html`);
}

function log(s: Step) {
  const errs = s.issues.filter((i) => i.severity === 'error').length;
  console.log(`  > ${s.request}\n    ${s.error ? `ERROR ${s.error}` : s.reply.slice(0, 160)}\n    ${s.ms} ms, ${s.sf} sf, ${s.issues.length} findings (${errs} errors)`);
}

const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function cost(u?: Usage) {
  if (!u || Number.isNaN(priceIn) || Number.isNaN(priceOut)) return '';
  return ` · $${((u.input * priceIn + u.output * priceOut) / 1e6).toFixed(3)}`;
}

function html(rows: { c: Case; steps: Step[] }[]) {
  const cards = rows
    .map(({ steps }) =>
      steps
        .map(
          (s, k) => `<section class="${k ? 'edit' : 'brief'}"><h2>${k ? 'Edit' : 'Brief'}: ${esc(s.request)}</h2>
<p class="reply">${s.error ? `<b>Error:</b> ${esc(s.error)}` : esc(s.reply)}</p>
<p class="meta">${(s.ms / 1000).toFixed(1)} s · ${s.sf.toLocaleString('en-US')} sf${s.usage ? ` · ${s.usage.input} in / ${s.usage.output} out / ${s.usage.cacheRead} cached` : ''}${cost(s.usage)}</p>
<div class="plans">${s.plans.map((p) => `<div class="plan">${p.replace(/width="[^"]+in" height="[^"]+in"/, '')}</div>`).join('')}</div>
${s.issues.length ? `<ul>${s.issues.map((i) => `<li class="${i.severity}">${esc(i.message)}</li>`).join('')}</ul>` : ''}</section>`,
        )
        .join(''),
    )
    .join('<hr>');
  return `<!doctype html><meta charset="utf-8"><title>Our Build eval</title>
<style>body{font:14px/1.45 system-ui;margin:24px;background:#f6f2ea;color:#1f1d1a}h1{font-family:Georgia,serif}section{background:#fff;border-radius:14px;padding:16px;margin:12px 0}section.edit{margin-left:32px}h2{font:600 15px system-ui;margin:0 0 6px}.reply{margin:0 0 6px}.meta{color:#777;margin:0 0 8px}.plans{display:flex;gap:12px;flex-wrap:wrap}.plan{width:420px;border:1px solid #eee;border-radius:8px;padding:6px}.plan svg{width:100%;height:auto}li.error{color:#a33}li.warning{color:#a70}li.tip{color:#557}hr{border:0;border-top:1px solid #ddd;margin:24px 0}</style>
<h1>Our Build eval · ${mock ? 'demo engine' : esc(MODEL)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</h1>${cards}`;
}

void main();
