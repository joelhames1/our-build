'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '@/lib/supabase/client';
import { Logo } from './Logo';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
}

const MeContext = createContext<Me | null>(null);

/** The signed-in member (cloud mode), or null in this-browser-only mode. */
export const useMe = () => useContext(MeContext);

/**
 * With accounts on, only active members get past this: the server says who's signed in and
 * whether they're still allowed (paused or archived people are signed out with a note). Local
 * mode passes straight through.
 */
export function AuthGate({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const router = useRouter();
  const cloud = cloudEnabled();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'checking' | 'in' | 'not-admin'>(cloud ? 'checking' : 'in');

  useEffect(() => {
    if (!cloud) return;
    let alive = true;
    fetch('/api/me', { cache: 'no-store' })
      .then(async (r) => {
        if (!alive) return;
        if (r.ok) {
          const m = (await r.json()) as Me;
          setMe(m);
          setState(admin && m.role !== 'admin' ? 'not-admin' : 'in');
        } else if (r.status === 403) {
          // Still holding a session but no longer let in: end it on the server, with the reason.
          const { refusal } = (await r.json().catch(() => ({}))) as { refusal?: string };
          signOut({ why: refusal ?? 'not-invited' });
        } else if (r.status === 503) router.replace('/login?signin=setup');
        else router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      })
      .catch(() => alive && router.replace('/login?signin=failed'));
    const { data: sub } = supabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/login?signin=signed-out');
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [cloud, admin, router]);

  useEffect(() => {
    if (state === 'not-admin') router.replace('/');
  }, [state, router]);

  if (state !== 'in')
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper">
        <Logo className="h-10 w-10 animate-pulse text-ink" />
      </div>
    );
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

/** Sign out through the server (it clears the session cookies), landing on the sign-in page. */
export function signOut({ everywhere = false, why = '' }: { everywhere?: boolean; why?: string } = {}) {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/api/auth/signout';
  for (const [k, v] of Object.entries({ scope: everywhere ? 'global' : 'local', why })) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
