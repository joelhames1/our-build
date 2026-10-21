'use client';

import { ArrowRight, Mail } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '@/lib/supabase/client';
import { AuthCard } from '@/ui/AuthCard';

const MESSAGES: Record<string, { text: string; tone: 'note' | 'alert' }> = {
  'signed-out': { text: 'You’re signed out.', tone: 'note' },
  'not-invited': { text: 'That account isn’t on the list. Use the email you were invited with, or ask whoever runs Our Build to invite this one.', tone: 'alert' },
  disabled: { text: 'Your account is paused. Ask whoever runs Our Build to turn it back on.', tone: 'alert' },
  archived: { text: 'That account has been archived. Ask whoever runs Our Build if you’d like back in.', tone: 'alert' },
  unverified: { text: 'Google hasn’t confirmed that address yet, so it can’t be used to sign in.', tone: 'alert' },
  cancelled: { text: 'Sign-in was canceled. Try again whenever you like.', tone: 'note' },
  expired: { text: 'That link has expired or was already used. Ask for a fresh one below.', tone: 'alert' },
  failed: { text: 'Sign-in didn’t work that time. Try again in a moment.', tone: 'alert' },
  setup: { text: 'Sign-in isn’t fully set up on this deployment yet (see SETUP.md).', tone: 'alert' },
};

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const q = useSearchParams();
  const next = q.get('next') ?? '';
  const said = MESSAGES[q.get('signin') ?? ''];
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'google' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!cloudEnabled()) {
      router.replace('/');
      return;
    }
    // Already in? Skip the form.
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.ok && router.replace(next || '/'));
  }, [router, next]);

  async function google() {
    setState('google');
    const back = `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    const { error } = await supabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back, queryParams: { prompt: 'select_account' } } });
    if (error) {
      setState('error');
      setMessage('Google sign-in isn’t available right now. Try the email link instead.');
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('sending');
    const res = await fetch('/api/auth/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), next }) }).catch(() => null);
    if (res?.ok) return setState('sent');
    setState('error');
    setMessage(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Couldn’t reach Our Build. Check the connection and try again.');
  }

  return (
    <AuthCard>
      {state === 'sent' ? (
        <div data-testid="link-sent">
          <Mail className="mb-3 h-8 w-8 text-accent" />
          <h1 className="font-serif text-2xl text-ink">Check your email</h1>
          <p className="mt-2 text-ink-2">If {email.trim()} is on the list, a sign-in link is on its way. It works on any device; tap the button in the email.</p>
          <button onClick={() => setState('idle')} className="mt-5 text-sm text-ink-2 underline underline-offset-4">
            Use a different address
          </button>
        </div>
      ) : (
        <div>
          <h1 className="font-serif text-3xl text-ink">Welcome home</h1>
          <p className="mt-2 text-ink-2">Sign in to see your designs. Our Build is invite-only.</p>
          {said && (
            <p className={`mt-4 rounded-2xl px-4 py-3 text-sm ${said.tone === 'alert' ? 'bg-accent/10 text-accent' : 'bg-paper text-ink-2'}`} role={said.tone === 'alert' ? 'alert' : 'status'} data-testid="signin-message">
              {said.text}
            </p>
          )}
          <button onClick={google} disabled={state === 'google'} className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-line bg-white text-[16px] font-medium text-ink transition hover:border-ink/25 disabled:opacity-60" data-testid="google-sign-in">
            <GoogleMark />
            {state === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            or get a link by email
            <span className="h-px flex-1 bg-line" />
          </div>
          <form onSubmit={sendLink}>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              className="h-12 w-full rounded-2xl border border-line bg-white px-4 text-[16px] text-ink outline-none focus:border-accent"
            />
            <button disabled={state === 'sending'} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-paper transition hover:bg-ink-2 disabled:opacity-50" data-testid="email-link">
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'} <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          {state === 'error' && (
            <p className="mt-3 text-sm text-accent" role="alert">
              {message}
            </p>
          )}
        </div>
      )}
    </AuthCard>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
