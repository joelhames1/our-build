'use client';

import { AlertTriangle, Check, History, Info, Lightbulb, Wand2, X } from 'lucide-react';
import { useMemo } from 'react';
import { BEDROOM_TYPES, isEnclosed, isOutdoor } from '@/core/model/schema';
import { dims, ftIn } from '@/core/model/units';
import type { Resolved } from '@/core/resolve';
import { useStudio } from '@/lib/store/studio';
import { describeOwner } from '@/viewer/describe';

export function DetailsPanel({ resolved }: { resolved: Resolved | null }) {
  const { panel, set, detailsTab } = useStudio();
  if (panel !== 'details') return null;
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Info },
    { id: 'notes', label: 'Notes', icon: Lightbulb },
    { id: 'history', label: 'History', icon: History },
  ] as const;
  return (
    <aside className="pointer-events-auto absolute bottom-28 right-3 top-20 z-30 flex w-[min(380px,calc(100vw-1.5rem))] animate-rise flex-col rounded-3xl glass md:right-5" aria-label="Details">
      <div className="flex items-center gap-1 px-3 pt-3">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => set({ detailsTab: t.id })} className={`flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm transition ${detailsTab === t.id ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-white/70'}`} data-testid={`tab-${t.id}`}>
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
        <button onClick={() => set({ panel: 'none' })} className="ml-auto rounded-full p-2 text-muted hover:bg-white/70" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-5 pt-3">
        {detailsTab === 'overview' && resolved && <Overview res={resolved} />}
        {detailsTab === 'notes' && resolved && <Notes res={resolved} />}
        {detailsTab === 'history' && <HistoryList />}
      </div>
    </aside>
  );
}

function Overview({ res }: { res: Resolved }) {
  const { setSelection, set } = useStudio();
  const p = res.project;
  const beds = res.levels.reduce((s, l) => s + [...l.rooms.values()].filter((i) => BEDROOM_TYPES.has(i.room.type)).length, 0);
  const baths = res.levels.reduce((s, l) => s + [...l.rooms.values()].reduce((t, i) => t + (i.room.type === 'bath' ? 1 : i.room.type === 'half_bath' ? 0.5 : 0), 0), 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Heated" value={`${Math.round(res.grossArea).toLocaleString('en-US')} sf`} />
        <Stat label="Bedrooms" value={String(beds)} />
        <Stat label="Baths" value={String(baths)} />
      </div>
      {res.levels.map((rl) => (
        <div key={rl.level.id}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h3 className="font-serif text-lg text-ink">{rl.level.name}</h3>
            <span className="text-xs text-muted">ceiling {ftIn(rl.level.ceiling)}</span>
          </div>
          <div className="divide-y divide-line/70 overflow-hidden rounded-2xl bg-white/60">
            {[...rl.rooms.values()]
              .filter((i) => isEnclosed(i.room.type) || isOutdoor(i.room.type))
              .map((i) => (
                <button
                  key={i.room.id}
                  onClick={() => {
                    setSelection(describeOwner(res, i.room.id));
                    set({ level: rl.index });
                  }}
                  className="flex w-full items-baseline justify-between px-3 py-2 text-left text-sm transition hover:bg-white"
                >
                  <span className="text-ink">{i.room.name}</span>
                  <span className="text-xs text-muted">{isOutdoor(i.room.type) ? `${Math.round(i.area)} sf` : `${dims(i.clearW, i.clearD)} · ${Math.round(i.netArea)} sf`}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="rounded-2xl bg-white/60 p-3 text-sm text-ink-2">
        <div className="mb-1 font-medium text-ink">Style</div>
        {p.style.preset ? <span className="capitalize">{p.style.preset.replace(/_/g, ' ')} · </span> : null}
        {p.style.wall.replace(/_/g, ' ')} walls, {p.style.roofMaterial.replace(/_/g, ' ')} {p.roof.form} roof at {p.roof.pitch}/12, {p.style.windows.replace(/_/g, ' ')} windows.
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl bg-white/60 px-3 py-2.5">
    <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
    <div className="font-serif text-xl text-ink">{value}</div>
  </div>
);

function Notes({ res }: { res: Resolved }) {
  const { issues, quick, setSelection, busy } = useStudio();
  const list = useMemo(() => {
    const seen = new Set<string>();
    return issues.filter((i) => {
      const k = `${i.rule}:${i.ids.join(',')}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [issues]);
  if (!list.length)
    return (
      <div className="flex flex-col items-center py-10 text-center text-ink-2">
        <Check className="mb-2 h-8 w-8 text-sage" />
        <p className="font-serif text-lg text-ink">Everything checks out.</p>
        <p className="mt-1 text-sm">No guardrail notes for this design.</p>
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Friendly guidance based on common residential building codes. Not a substitute for an architect or code review.</p>
      {list.map((i, k) => (
        <div key={k} className="rounded-2xl bg-white/70 p-3">
          <div className="flex gap-2">
            {i.severity === 'tip' ? <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-sage" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
            <p className="text-sm leading-snug text-ink">{i.message}</p>
          </div>
          <div className="mt-2 flex gap-3 pl-6">
            {i.ids[0] && describeOwner(res, i.ids[0]) && (
              <button onClick={() => setSelection(describeOwner(res, i.ids[0]))} className="text-xs text-ink-2 underline-offset-2 hover:underline">
                Show me
              </button>
            )}
            {i.fix && (
              <button disabled={busy} onClick={() => quick(i.fix!, `Fixed: ${i.message}`)} className="flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-40">
                <Wand2 className="h-3 w-3" /> Fix it
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryList() {
  const { versions, headId, restore, busy } = useStudio();
  return (
    <ol className="space-y-1.5">
      {[...versions].reverse().map((v, i) => (
        <li key={v.id} className={`rounded-2xl p-3 ${v.id === headId ? 'bg-white ring-1 ring-accent/40' : 'bg-white/60'}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted">
              {versions.length - i}. {new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            {v.id === headId ? (
              <span className="text-xs font-medium text-accent">Current</span>
            ) : (
              <button disabled={busy} onClick={() => restore(v.id)} className="text-xs text-ink-2 hover:text-accent hover:underline">
                Restore
              </button>
            )}
          </div>
          <p className="mt-1 text-sm leading-snug text-ink">{v.summary}</p>
        </li>
      ))}
    </ol>
  );
}
