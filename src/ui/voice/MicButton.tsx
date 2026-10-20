'use client';

import { Mic, MicOff } from 'lucide-react';
import { useEffect } from 'react';
import { useSpeech } from './useSpeech';

/** Tap to talk; tap again (or pause) to finish. With `hotkey`, holding the spacebar talks too. */
export function MicButton({ onText, size = 'md', onListening, hotkey = false }: { onText: (text: string, final: boolean) => void; size?: 'md' | 'lg'; onListening?: (on: boolean) => void; hotkey?: boolean }) {
  const speech = useSpeech(onText);
  const { start, stop, supported } = speech;
  useEffect(() => {
    if (!hotkey || !supported) return;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target)) return;
      e.preventDefault();
      start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return;
      e.preventDefault();
      stop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [hotkey, supported, start, stop]);
  const dim = size === 'lg' ? 'h-14 w-14' : 'h-12 w-12';
  if (!speech.supported)
    return (
      <span className={`flex ${dim} items-center justify-center rounded-full text-muted/60`} title="Voice works in Chrome and Safari (in a browser tab)">
        <MicOff className="h-5 w-5" />
      </span>
    );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          speech.toggle();
          onListening?.(!speech.listening);
        }}
        className={`relative flex ${dim} items-center justify-center rounded-full transition ${speech.listening ? 'bg-accent text-white shadow-[0_0_0_6px_rgba(192,100,58,0.18)]' : 'bg-paper-2 text-ink hover:bg-line'}`}
        aria-label={speech.listening ? 'Stop listening' : 'Speak'}
        title={hotkey ? 'Tap to talk, or hold the spacebar' : 'Tap to talk'}
        aria-pressed={speech.listening}
        data-testid="mic"
      >
        {speech.listening && <span className="absolute inset-0 animate-ping rounded-full bg-accent/30" />}
        <Mic className="relative h-5 w-5" />
      </button>
      {speech.error && <div className="absolute bottom-full left-0 mb-2 w-60 rounded-xl bg-ink px-3 py-2 text-xs text-paper shadow-lg">{speech.error}</div>}
    </div>
  );
}
