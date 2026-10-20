'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '@/lib/supabase/client';
import { Logo } from './Logo';

/** With cloud sync on, only signed-in household members get past this. Local mode passes straight through. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const cloud = cloudEnabled();
  const [state, setState] = useState<'checking' | 'in' | 'out'>(cloud ? 'checking' : 'in');

  useEffect(() => {
    if (!cloud) return;
    const sb = supabase();
    let alive = true;
    sb.auth.getSession().then(({ data }) => {
      if (alive) setState(data.session ? 'in' : 'out');
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setState(session ? 'in' : 'out'));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [cloud]);

  useEffect(() => {
    if (state === 'out') router.replace('/login');
  }, [state, router]);

  if (state !== 'in')
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper">
        <Logo className="h-10 w-10 animate-pulse text-ink" />
      </div>
    );
  return <>{children}</>;
}
