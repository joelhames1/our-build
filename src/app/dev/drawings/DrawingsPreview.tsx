'use client';

import { useState } from 'react';
import { parseProject } from '@/core/model/schema';
import { applyOps } from '@/core/ops/apply';
import { resolve } from '@/core/resolve';
import { SAMPLES } from '@/core/samples';
import { TEMPLATE_IDS } from '@/core/templates';
import { axonometric, elevation } from '@/drawings/elevation';
import { floorPlan } from '@/drawings/plan';
import { roofPlan } from '@/drawings/roofPlan';
import { openingMarks } from '@/drawings/schedules';
import { chooseCut, section } from '@/drawings/section';
import { drawingSvg, sheetSvg } from '@/drawings/render/svg';
import { buildSheets } from '@/drawings/sheets';

const BLANK = () => parseProject({ v: 1, name: 'Template', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });

/** Dev preview of single drawings: /dev/drawings?sample=t:farmhouse&d=plan&level=0 or d=elev&side=S */
export function DrawingsPreview() {
  const [svg] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const name = q.get('sample') ?? 't:farmhouse';
    const base = name.startsWith('t:') ? applyOps(BLANK(), [{ op: 'use_template', template: name.slice(2) as (typeof TEMPLATE_IDS)[number] }]).project : (SAMPLES[name as keyof typeof SAMPLES] ?? SAMPLES.sampleCottage)();
    const ops = q.get('ops');
    const res = resolve(ops ? applyOps(base, JSON.parse(ops)).project : base);
    const level = Number(q.get('level') ?? 0);
    const scale = Number(q.get('scale') ?? 4);
    const t0 = performance.now();
    const kind = q.get('d') ?? 'plan';
    if (kind === 'sheets') {
      const sheets = buildSheets(res, { paper: (q.get('paper') ?? 'tabloid') as 'tabloid' | 'archd', date: new Date(2026, 9, 20) });
      console.info(`[drawing] ${sheets.length} sheets in ${Math.round(performance.now() - t0)} ms`);
      const only = q.get('sheet');
      return sheets
        .filter((s) => !only || s.number === only)
        .map((s) => `<div style="margin:0 0 24px;box-shadow:0 2px 12px #0002">${sheetSvg(s).replace(/width="[^"]+in" height="[^"]+in"/, 'width="100%"')}</div>`)
        .join('');
    }
    const d = kind === 'elev' ? elevation(res, (q.get('side') ?? 'S') as 'N' | 'E' | 'S' | 'W', scale) : kind === 'axon' ? axonometric(res, scale) : kind === 'roof' ? roofPlan(res, scale) : kind === 'section' ? section(res, chooseCut(res), scale) : floorPlan(res, level, scale, { marks: openingMarks(res), cuts: [{ cut: chooseCut(res), label: 'A', sheet: 'A3.1' }] });
    console.info(`[drawing] ${kind} in ${Math.round(performance.now() - t0)} ms, ${d.items.length} items`);
    return drawingSvg(d);
  });
  return <div className="min-h-dvh bg-white p-6" data-testid="drawing" dangerouslySetInnerHTML={{ __html: svg }} />;
}
