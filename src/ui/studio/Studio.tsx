'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolve } from '@/core/resolve';
import { getRepo } from '@/lib/store/repo';
import { isEmpty, useStudio } from '@/lib/store/studio';
import { describeOwner } from '@/viewer/describe';
import type { SceneHandle } from '@/viewer/Scene';
import { Logo } from '../Logo';
import { PENDING_KEY } from '../NewDesign';
import { ChatPanel } from './ChatPanel';
import { Composer } from './Composer';
import { DetailsPanel } from './DetailsPanel';
import { ExportDialog } from './ExportDialog';
import { PlanView } from './PlanView';
import { TopBar } from './TopBar';

const Scene = dynamic(() => import('@/viewer/Scene').then((m) => m.Scene), { ssr: false, loading: () => <Sketching text="Setting up the 3D view…" /> });

export function Studio({ id }: { id: string }) {
  const { status, project, view, level, render, hour, selection, load, send, setSelection, set, statuses, busy, meta } = useStudio();
  const sceneRef = useRef<SceneHandle>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const testMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1';

  useEffect(() => {
    load(id);
  }, [id, load]);

  // A brief typed on the home screen starts the first design automatically.
  useEffect(() => {
    if (status !== 'ready') return;
    let brief: string | null = null;
    try {
      brief = sessionStorage.getItem(PENDING_KEY(id));
      if (brief) sessionStorage.removeItem(PENDING_KEY(id));
    } catch {
      brief = null;
    }
    if (brief) send(brief);
  }, [status, id, send]);

  const resolved = useMemo(() => (project && !isEmpty(project) ? resolve(project) : null), [project]);

  // Keep a small thumbnail of the latest design for the gallery.
  const saveThumb = useCallback(() => {
    setTimeout(async () => {
      const m = useStudio.getState().meta;
      const url = sceneRef.current?.snapshot();
      if (!url || !m) return;
      const thumb = await shrink(url, 640, 400);
      if (thumb) await (await getRepo()).update(m.id, { thumbnail: thumb });
    }, 900);
  }, []);
  useEffect(() => set({ onSaved: saveThumb }), [saveThumb, set]);

  const onPick = useCallback(
    (owner: string | null) => {
      if (!owner || !resolved) return setSelection(null);
      setSelection(describeOwner(resolved, owner));
    },
    [resolved, setSelection],
  );

  if (status === 'missing')
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-paper text-center">
        <Logo className="h-10 w-10 text-ink" />
        <p className="font-serif text-2xl text-ink">We couldn&apos;t find that design.</p>
        <Link href="/" className="rounded-full bg-ink px-5 py-2 text-paper">
          Back to your designs
        </Link>
      </div>
    );

  return (
    <div className="fixed inset-0 overflow-hidden bg-[linear-gradient(#e9eef1,#e4e7e0)]" style={{ touchAction: 'none' }}>
      {resolved && project ? (
        view === 'plan' ? (
          <PlanView resolved={resolved} level={level} selected={selection?.id} onPick={onPick} />
        ) : (
          <Scene ref={sceneRef} resolved={resolved} mode={render} view={view} level={level} hour={hour} selected={selection?.id} onPick={(o) => onPick(o)} onMiss={() => setSelection(null)} testMode={testMode} />
        )
      ) : (
        <Sketching text={status === 'ready' ? (busy ? statuses[statuses.length - 1] ?? 'Sketching…' : 'Describe your design below to begin.') : 'Opening your design…'} />
      )}
      {status === 'ready' && (
        <>
          <TopBar onExport={() => setExportOpen(true)} />
          <ChatPanel />
          <DetailsPanel resolved={resolved} />
          <Composer />
          {exportOpen && resolved && meta && <ExportDialog resolved={resolved} sceneRef={sceneRef} onClose={() => setExportOpen(false)} />}
        </>
      )}
    </div>
  );
}

function Sketching({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
      <svg viewBox="0 0 120 90" className="h-28 w-36 text-ink/70">
        <path d="M10 48 60 10l50 38" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-[dash_2.4s_ease-in-out_infinite]" style={{ strokeDasharray: 140, strokeDashoffset: 0 }} />
        <path d="M22 40v42h76V40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M52 82V60h16v22" fill="none" stroke="#c0643a" strokeWidth="2" />
      </svg>
      <p className="max-w-sm px-6 font-serif text-xl text-ink-2">{text}</p>
    </div>
  );
}

async function shrink(dataUrl: string, w: number, h: number): Promise<string | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (!g) return res(null);
      const s = Math.max(w / img.width, h / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      res(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
}
