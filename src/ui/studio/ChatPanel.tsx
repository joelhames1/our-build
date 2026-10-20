'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useStudio } from '@/lib/store/studio';

export function ChatPanel() {
  const { chat, panel, set, busy, liveReply, restore, headId } = useStudio();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [chat.length, liveReply, panel]);
  if (panel !== 'chat') return null;
  return (
    <aside className="pointer-events-auto absolute bottom-28 left-3 top-20 z-30 flex w-[min(400px,calc(100vw-1.5rem))] animate-rise flex-col rounded-3xl glass md:left-5" aria-label="Conversation">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="font-serif text-xl text-ink">Conversation</h2>
        <button onClick={() => set({ panel: 'none' })} className="rounded-full p-2 text-muted hover:bg-white/70" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {chat.length === 0 && <p className="px-1 text-sm text-muted">Your conversation with the design assistant will show up here.</p>}
        {chat.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ml-8 rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-paper">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="mr-4">
              <div className="rounded-2xl rounded-bl-md bg-white/80 px-4 py-2.5 font-serif text-[16px] leading-snug text-ink">{m.text}</div>
              {m.changes && <div className="mt-1 px-2 text-xs leading-snug text-muted">{m.changes}</div>}
              {m.versionId && m.versionId !== headId && (
                <button onClick={() => restore(m.versionId!)} className="mt-0.5 px-2 text-xs text-accent hover:underline">
                  Go back to this version
                </button>
              )}
            </div>
          ),
        )}
        {busy && liveReply && <div className="mr-4 rounded-2xl rounded-bl-md bg-white/80 px-4 py-2.5 font-serif text-[16px] leading-snug text-ink">{liveReply}</div>}
        <div ref={end} />
      </div>
    </aside>
  );
}
