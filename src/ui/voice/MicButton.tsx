'use client';

import { Mic, MicOff } from 'lucide-react';
import { useSpeech } from './useSpeech';

/** Tap to talk; tap again (or pause) to finish. */
export function MicButton({ onText, size = 'md', onListening }: { onText: (text: string, final: boolean) => void; size?: 'md' | 'lg'; onListening?: (on: boolean) => void }) {
  const speech = useSpeech(onText);
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
