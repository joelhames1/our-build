'use client';

import { Box, FileDown, FileImage, FileText, X } from 'lucide-react';
import { useState } from 'react';
import type { Resolved } from '@/core/resolve';
import type { SceneHandle } from '@/viewer/Scene';

function download(blob: Blob | string, name: string) {
  const url = typeof blob === 'string' ? blob : URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof blob !== 'string') setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';

export function ExportDialog({ resolved, sceneRef, onClose }: { resolved: Resolved; sceneRef: React.RefObject<SceneHandle | null>; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [paper, setPaper] = useState<'tabloid' | 'archd'>('tabloid');
  const name = slug(resolved.project.name);

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      alert('Sorry, that export failed. Try again?');
    } finally {
      setBusy(null);
    }
  }

  async function go(kind: 'pdf' | 'dxf' | 'png' | 'glb') {
    await run(kind, async () => {
      const scene = sceneRef.current;
      if (kind === 'pdf') {
        const { exportPdf } = await import('@/export/pdf');
        download(await exportPdf(resolved, { paper, snapshot: scene?.snapshot() ?? null }), `${name}-plans.pdf`);
      } else if (kind === 'dxf') {
        const { exportDxf } = await import('@/export/dxf');
        download(new Blob([exportDxf(resolved)], { type: 'application/dxf' }), `${name}.dxf`);
      } else if (kind === 'png') {
        const url = scene?.snapshot();
        if (url) download(url, `${name}.png`);
      } else {
        const blob = await scene?.exportGLB();
        if (blob) download(blob, `${name}.glb`);
      }
    });
  }

  const items = [
    { id: 'pdf', icon: FileText, title: 'Plan set (PDF)', text: 'Cover, floor plans, elevations, a section and schedules on titled sheets.' },
    { id: 'dxf', icon: FileDown, title: 'CAD drawings (DXF)', text: 'Plans and elevations for AutoCAD, SketchUp and friends.' },
    { id: 'png', icon: FileImage, title: 'Picture (PNG)', text: 'A snapshot of the current view.' },
    { id: 'glb', icon: Box, title: '3D model (GLB)', text: 'The house as a 3D file for Blender, SketchUp or AR viewers.' },
  ] as const;

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg animate-rise rounded-3xl bg-paper p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-2xl text-ink">Take it with you</h2>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
          {items.map((it) => (
            <button key={it.id} onClick={() => go(it.id)} disabled={!!busy} className="flex w-full items-start gap-4 rounded-2xl border border-line bg-white/70 p-4 text-left transition hover:border-accent/50 hover:bg-white disabled:opacity-60" data-testid={`export-${it.id}`}>
              <it.icon className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
              <span>
                <span className="block font-medium text-ink">{busy === it.id ? 'Preparing…' : it.title}</span>
                <span className="block text-sm text-ink-2">{it.text}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-2">
          <span>Sheet size</span>
          {(['tabloid', 'archd'] as const).map((p) => (
            <button key={p} onClick={() => setPaper(p)} className={`rounded-full px-3 py-1 ${paper === p ? 'bg-ink text-paper' : 'bg-white/70'}`}>
              {p === 'tabloid' ? '11 × 17 (prints at home)' : '24 × 36'}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">Conceptual design drawings, not for construction. An architect or engineer should review before you build.</p>
      </div>
    </div>
  );
}
