'use client';

import { ArrowUp, MessageCircle, Redo2, Square, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isEmpty, useStudio } from '@/lib/store/studio';
import { MicButton } from '../voice/MicButton';

/** The conversation bar: type or talk, with contextual suggestions and live narration. */
export function Composer() {
  const { send, stop, busy, statuses, liveReply, selection, setSelection, undo, redo, versions, headId, project, chat, panel, set, error } = useStudio();
  const [text, setText] = useState('');
  const [fromVoice, setFromVoice] = useState(false);
  const [lastShown, setLastShown] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const idx = versions.findIndex((v) => v.id === headId);
  const lastReply = [...chat].reverse().find((m) => m.role === 'assistant');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [text]);

  const suggestions = useMemo(() => suggest(selection?.kind, selection?.label, isEmpty(project)), [selection, project]);

  function submit(t = text, source: 'typed' | 'voice' | 'suggestion' = fromVoice ? 'voice' : 'typed') {
    if (!t.trim() || busy) return;
    send(t.trim(), source);
    setText('');
    setFromVoice(false);
    setLastShown(null);
  }

  const showReply = !busy && lastReply && lastShown !== lastReply.id && panel !== 'chat';

  // The reply bubble steps aside after a while; the conversation panel keeps it.
  useEffect(() => {
    if (!showReply || !lastReply) return;
    const t = setTimeout(() => setLastShown(lastReply.id), 14000);
    return () => clearTimeout(t);
  }, [showReply, lastReply]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-5">
      {busy && (
        <div className="pointer-events-auto w-full max-w-2xl animate-rise rounded-2xl glass px-4 py-3" aria-live="polite" data-testid="status-feed">
          <div className="space-y-1">
            {statuses.slice(-3).map((s, i, arr) => (
              <div key={`${i}-${s}`} className={`flex items-start gap-2 text-sm ${i === arr.length - 1 ? 'text-ink' : 'text-muted'}`}>
                {i === arr.length - 1 ? <span className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line" />}
                <span className="line-clamp-2">{s}</span>
              </div>
            ))}
          </div>
          {liveReply && <p className="mt-2 border-t border-line/70 pt-2 font-serif text-[17px] leading-snug text-ink">{liveReply}</p>}
        </div>
      )}
      {showReply && (
        <div className="pointer-events-auto relative w-full max-w-2xl animate-rise rounded-2xl glass px-4 py-3 pr-10" data-testid="assistant-reply">
          <p className="font-serif text-[17px] leading-snug text-ink">{lastReply.text}</p>
          {lastReply.versionId && idx > 0 && lastReply.versionId === headId && (
            <button onClick={() => undo()} className="mt-1 text-sm text-accent underline-offset-2 hover:underline">
              Undo this
            </button>
          )}
          <button onClick={() => setLastShown(lastReply.id)} className="absolute right-2 top-2 rounded-full p-1.5 text-muted hover:bg-white/70" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {error && !busy && !showReply && <div className="pointer-events-auto rounded-xl bg-ink px-4 py-2 text-sm text-paper">{error}</div>}

      {!busy && suggestions.length > 0 && (
        <div className="pointer-events-auto flex max-w-2xl flex-wrap justify-center gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => submit(s, 'suggestion')} className="rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-sm text-ink-2 shadow-sm backdrop-blur transition hover:bg-white hover:text-ink">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="pointer-events-auto w-full max-w-2xl rounded-[26px] glass p-1.5">
        {selection && (
          <div className="mx-2 mb-1 mt-1 flex items-center gap-2 text-xs text-ink-2">
            <span className="rounded-full bg-accent/12 px-2 py-0.5 text-accent">Talking about</span>
            <span className="truncate font-medium text-ink">{selection.label}</span>
            <button onClick={() => setSelection(null)} className="ml-auto rounded-full p-1 text-muted hover:bg-white/70" aria-label="Clear selection">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <div className="flex shrink-0 items-center">
            <button onClick={() => undo()} disabled={idx <= 0 || busy} className="flex h-12 w-10 items-center justify-center rounded-full text-ink-2 transition hover:bg-white/70 disabled:opacity-30" aria-label="Undo" data-testid="undo">
              <Undo2 className="h-5 w-5" />
            </button>
            <button onClick={() => redo()} disabled={idx < 0 || idx >= versions.length - 1 || busy} className="hidden h-12 w-10 items-center justify-center rounded-full text-ink-2 transition hover:bg-white/70 disabled:opacity-30 sm:flex" aria-label="Redo">
              <Redo2 className="h-5 w-5" />
            </button>
          </div>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFromVoice(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={busy ? 'Working on it…' : selection ? `Change ${selection.label.toLowerCase()}…` : isEmpty(project) ? 'Describe the place you’re imagining…' : 'Describe a change…'}
            className="min-h-12 flex-1 resize-none bg-transparent px-2 py-3 text-[16px] leading-6 text-ink outline-none placeholder:text-muted"
            aria-label="Describe a change"
            data-testid="composer-input"
          />
          <button onClick={() => set({ panel: panel === 'chat' ? 'none' : 'chat' })} className={`flex h-12 w-10 shrink-0 items-center justify-center rounded-full transition ${panel === 'chat' ? 'text-accent' : 'text-ink-2 hover:bg-white/70'}`} aria-label="Conversation">
            <MessageCircle className="h-5 w-5" />
          </button>
          <MicButton
            hotkey
            onText={(t, final) => {
              setText(t);
              setFromVoice(true);
              if (final) setTimeout(() => ref.current?.focus(), 0);
            }}
          />
          {busy ? (
            <button onClick={() => stop()} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-paper" aria-label="Stop">
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button onClick={() => submit()} disabled={!text.trim()} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:brightness-105 disabled:bg-line disabled:text-muted" aria-label="Send" data-testid="send">
              <ArrowUp className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function suggest(kind: string | undefined, label: string | undefined, empty: boolean): string[] {
  if (empty) return [];
  switch (kind) {
    case 'room':
      return ['Make this bigger', 'Vaulted ceiling here', 'Add a window'];
    case 'opening':
      return ['Make this bigger', 'Remove it'];
    case 'wall':
      return ['Add a window here', 'Remove this wall'];
    case 'roof':
      return ['Make the roof steeper', 'Try a hip roof', 'Metal roof'];
    case 'fixture':
      return ['Make it bigger', 'Remove it'];
    default:
      return ['Add a porch on the back', 'Make the kitchen bigger', 'Add a bedroom', 'Change the roof to a hip roof'];
  }
}
