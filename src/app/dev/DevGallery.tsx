'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { SAMPLES } from '@/core/samples';
import { resolve } from '@/core/resolve';
import { applyOps } from '@/core/ops/apply';
import { parseProject } from '@/core/model/schema';
import { TEMPLATE_IDS } from '@/core/templates';

const BLANK = () => parseProject({ v: 1, name: 'Template', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
const ALL: Record<string, () => ReturnType<typeof BLANK>> = {
  ...SAMPLES,
  ...Object.fromEntries(TEMPLATE_IDS.map((t) => [`t:${t}`, () => applyOps({ ...BLANK(), name: t }, [{ op: 'use_template', template: t }]).project])),
};
import type { RenderMode } from '@/viewer/materials';
import type { ViewMode } from '@/viewer/Scene';
import { PlanView } from '@/ui/studio/PlanView';

const Scene = dynamic(() => import('@/viewer/Scene').then((m) => m.Scene), { ssr: false });


/** A plain page for eyeballing geometry while developing: /dev?sample=sampleFarmhouse&mode=clay */
export function DevGallery() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [name, setName] = useState<string>(params.get('sample') ?? 'sampleCottage');
  const [mode, setMode] = useState<RenderMode>((params.get('mode') as RenderMode) ?? 'materials');
  const [view, setView] = useState<ViewMode>((params.get('view') as ViewMode) ?? 'exterior');
  const [level, setLevel] = useState(Number(params.get('level') ?? 0));
  const [hour, setHour] = useState(Number(params.get('hour') ?? 15));
  const [selected, setSelected] = useState<string | null>(null);
  const resolved = useMemo(() => resolve((ALL[name] ?? ALL.sampleCottage)()), [name]);
  const testMode = params.get('test') === '1';

  return (
    <div className="fixed inset-0">
      {view === 'plan' ? (
        <PlanView resolved={resolved} level={level} selected={selected} onPick={setSelected} />
      ) : (
        <Scene resolved={resolved} mode={mode} view={view} level={level} hour={hour} selected={selected} onPick={(o) => setSelected(o)} onMiss={() => setSelected(null)} testMode={testMode} orbit={Number(params.get('orbit') ?? 0)} ao={(params.get('ao') as 'on' | 'off' | null) ?? 'auto'} />
      )}
      <div className="glass absolute left-4 top-4 flex flex-wrap items-center gap-2 rounded-2xl p-2 text-sm">
        <select className="rounded-lg bg-white/70 px-2 py-1" value={name} onChange={(e) => setName(e.target.value)}>
          {Object.keys(ALL).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        {(['materials', 'clay'] as const).map((m) => (
          <button key={m} className={`rounded-lg px-2 py-1 ${mode === m ? 'bg-ink text-paper' : ''}`} onClick={() => setMode(m)}>
            {m}
          </button>
        ))}
        {(['exterior', 'dollhouse', 'plan'] as const).map((v) => (
          <button key={v} className={`rounded-lg px-2 py-1 ${view === v ? 'bg-ink text-paper' : ''}`} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        {resolved.levels.map((l) => (
          <button key={l.level.id} className={`rounded-lg px-2 py-1 ${level === l.index ? 'bg-accent text-white' : ''}`} onClick={() => setLevel(l.index)}>
            {l.level.name}
          </button>
        ))}
        <input type="range" min={6} max={20} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
        <span className="text-ink-2">{selected ?? ''}</span>
      </div>
    </div>
  );
}
