'use client';

import { ArrowRight, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getRepo } from '@/lib/store/repo';
import { blankProject } from '@/lib/store/studio';
import { MicButton } from './voice/MicButton';
import { STARTERS } from './starters';

export const PENDING_KEY = (id: string) => `our-build:pending:${id}`;

/** "Describe the place you're imagining…" */
export function NewDesign({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function begin(brief = text) {
    if (!brief.trim() || busy) return;
    setBusy(true);
    const repo = await getRepo();
    const b = await repo.create('New design', blankProject('New design'));
    try {
      sessionStorage.setItem(PENDING_KEY(b.meta.id), brief.trim());
    } catch {
      // private mode: the studio will just open empty
    }
    router.push(`/p/${b.meta.id}`);
  }

  return (
    <div className={`w-full ${compact ? '' : 'max-w-3xl'}`}>
      <div className="rounded-[28px] border border-line bg-white/80 p-3 shadow-[0_20px_60px_-30px_rgba(35,33,30,0.45)] backdrop-blur">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              begin();
            }
          }}
          rows={compact ? 2 : 3}
          placeholder="Describe the place you're imagining… a stone cottage on a little island, two bedrooms, a porch facing the water."
          className="w-full resize-none bg-transparent px-3 py-2 font-serif text-xl leading-snug text-ink outline-none placeholder:text-muted/80 md:text-2xl"
          aria-label="Describe your design"
        />
        <div className="flex items-center justify-between gap-2 px-1">
          <MicButton onText={(t, final) => setText((prev) => (final ? (prev ? `${prev} ${t}` : t) : prev))} size="md" />
          <button
            onClick={() => begin()}
            disabled={!text.trim() || busy}
            className="flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-paper transition hover:bg-ink-2 disabled:opacity-40"
          >
            {busy ? 'Opening…' : 'Begin'} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {STARTERS.map((s) => (
          <button
            key={s.title}
            onClick={() => begin(s.text)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-full border border-line bg-white/60 px-4 py-2 text-sm text-ink-2 transition hover:border-accent/40 hover:bg-white hover:text-ink"
            title={s.text}
          >
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            {s.title}
          </button>
        ))}
      </div>
    </div>
  );
}
