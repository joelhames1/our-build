'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type Ctor = new () => Recognition;

const getCtor = (): Ctor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/**
 * Push-to-talk speech recognition. A fresh recognizer per press (iOS Safari is unreliable with
 * continuous mode). Interim text streams through onText(text, false); the final through (text, true).
 */
export function useSpeech(onText: (text: string, final: boolean) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef('');
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);
  useEffect(() => {
    setSupported(!!getCtor());
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const C = getCtor();
    if (!C || rec.current) return;
    setError(null);
    const r = new C();
    r.lang = navigator.language || 'en-US';
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    finalText.current = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      cb.current((finalText.current + interim).trim(), false);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('Microphone access is blocked. Allow it in your browser settings.');
      else if (e.error === 'no-speech') setError("Didn't catch that. Try again?");
      else if (e.error !== 'aborted') setError('Voice input stopped unexpectedly.');
    };
    r.onend = () => {
      const t = finalText.current.trim();
      if (t) cb.current(t, true);
      rec.current = null;
      setListening(false);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setListening(false);
    }
  }, []);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported, listening, error, start, stop, toggle };
}
