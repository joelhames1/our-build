'use client';

import { Box, Download, Footprints, Home, Layers, LayoutPanelLeft, Map as MapIcon, Palette, PanelRight, Sun } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useStudio } from '@/lib/store/studio';
import type { ViewMode } from '@/viewer/Scene';
import { AccountMenu } from '../AccountMenu';
import { Logo } from '../Logo';

const VIEWS: { id: ViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'exterior', label: 'Exterior', icon: Home },
  { id: 'dollhouse', label: 'Dollhouse', icon: LayoutPanelLeft },
  { id: 'walk', label: 'Walk', icon: Footprints },
  { id: 'plan', label: 'Plan', icon: MapIcon },
];

export function TopBar({ onExport }: { onExport: () => void }) {
  const { meta, project, view, level, render, hour, panel, set, rename } = useStudio();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [sunOpen, setSunOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  const levels = project?.levels ?? [];
  // Walking, the floor you're on shows in the walk HUD instead.
  const showLevels = (view === 'dollhouse' || view === 'plan') && levels.length > 1;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3 md:p-4">
      <div className="pointer-events-auto flex min-w-0 items-center gap-1 rounded-2xl glass p-1.5">
        <Link href="/" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink transition hover:bg-white/70" aria-label="All designs">
          <Logo className="h-6 w-6" />
        </Link>
        {editing ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name !== project?.name) rename(name);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="h-10 w-52 rounded-xl bg-white/80 px-3 font-serif text-lg text-ink outline-none"
          />
        ) : (
          <button
            onClick={() => {
              setName(project?.name ?? meta?.name ?? '');
              setEditing(true);
            }}
            className="h-10 max-w-[46vw] truncate rounded-xl px-3 font-serif text-lg text-ink transition hover:bg-white/60 md:max-w-xs" title="Rename">
            {project?.name ?? meta?.name ?? ''}
          </button>
        )}
        {showLevels && (
          <div className="ml-1 flex items-center gap-0.5 border-l border-line/80 pl-1.5">
            <Layers className="mr-1 hidden h-4 w-4 text-muted sm:block" />
            {levels.map((l, i) => (
              <button
                key={l.id}
                onClick={() => set({ level: i })}
                className={`h-9 rounded-lg px-2.5 text-sm transition ${level === i ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-white/70'}`}
              >
                <span className="hidden sm:inline">{l.name}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pointer-events-auto flex items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-2xl glass p-1.5" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => set({ view: v.id })}
              className={`flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm transition ${view === v.id ? 'bg-ink text-paper shadow' : 'text-ink-2 hover:bg-white/70'}`}
              data-testid={`view-${v.id}`}
            >
              <v.icon className="h-4 w-4" />
              <span className="hidden lg:inline">{v.label}</span>
            </button>
          ))}
        </div>
        <div className="relative flex items-center gap-0.5 rounded-2xl glass p-1.5">
          <button
            onClick={() => set({ render: render === 'clay' ? 'materials' : 'clay' })}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-2 transition hover:bg-white/70"
            title={render === 'clay' ? 'Show materials' : 'Clay model'}
            aria-label={render === 'clay' ? 'Show materials' : 'Clay model'}
          >
            {render === 'clay' ? <Palette className="h-5 w-5" /> : <Box className="h-5 w-5" />}
          </button>
          <button onClick={() => setSunOpen((o) => !o)} className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${sunOpen ? 'bg-white text-accent' : 'text-ink-2 hover:bg-white/70'}`} aria-label="Time of day">
            <Sun className="h-5 w-5" />
          </button>
          <button onClick={() => set({ panel: panel === 'details' ? 'none' : 'details' })} className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${panel === 'details' ? 'bg-white text-ink' : 'text-ink-2 hover:bg-white/70'}`} aria-label="Details" data-testid="details-toggle">
            <PanelRight className="h-5 w-5" />
          </button>
          <button onClick={onExport} className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm text-ink-2 transition hover:bg-white/70" aria-label="Export" data-testid="export">
            <Download className="h-4 w-4" />
            <span className="hidden xl:inline">Export</span>
          </button>
          <AccountMenu compact />
          {sunOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl glass p-4">
              <div className="mb-2 flex items-baseline justify-between text-sm text-ink-2">
                <span>Time of day</span>
                <span className="font-medium text-ink">{fmtHour(hour)}</span>
              </div>
              <input type="range" min={6} max={20} step={0.25} value={hour} onChange={(e) => set({ hour: Number(e.target.value) })} className="w-full accent-[#c0643a]" />
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>Sunrise</span>
                <span>Noon</span>
                <span>Sunset</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtHour(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ampm = hh >= 12 ? 'pm' : 'am';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ampm}`;
}
