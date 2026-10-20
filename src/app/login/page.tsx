'use client';

import { ArrowRight, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '@/lib/supabase/client';
import { Logo } from '@/ui/Logo';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!cloudEnabled()) {
      router.replace('/');
      return;
    }
    supabase()
      .auth.getSession()
      .then(({ data }) => data.session && router.replace('/'));
    const { data: sub } = supabase().auth.onAuthStateChange((_e, s) => s && router.replace('/'));
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('sending');
    const { error } = await supabase().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: false } });
    if (error) {
      setState('error');
      setMessage(/signups not allowed|not found|user/i.test(error.message) ? "That email isn't on the household list yet. Ask whoever set up Our Build to invite you." : error.message);
    } else setState('sent');
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[radial-gradient(900px_500px_at_50%_0%,#fffaf2,transparent),linear-gradient(#f7f4ee,#efe9df)] p-6">
      <div className="w-full max-w-md rounded-[28px] border border-line bg-white/80 p-8 shadow-[0_30px_80px_-40px_rgba(35,33,30,0.5)]">
        <div className="mb-6 flex items-center gap-2.5 text-ink">
          <Logo className="h-8 w-8" />
          <span className="font-serif text-2xl">Our Build</span>
        </div>
        {state === 'sent' ? (
          <div>
            <Mail className="mb-3 h-8 w-8 text-accent" />
            <h1 className="font-serif text-2xl text-ink">Check your email</h1>
            <p className="mt-2 text-ink-2">We sent a sign-in link to {email}. Open it on this device and you&apos;ll land right back here.</p>
          </div>
        ) : (
          <form onSubmit={send}>
            <h1 className="font-serif text-3xl text-ink">Welcome home</h1>
            <p className="mt-2 text-ink-2">Sign in with your email. No password needed.</p>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-6 h-12 w-full rounded-2xl border border-line bg-white px-4 text-[16px] text-ink outline-none focus:border-accent"
            />
            <button disabled={state === 'sending'} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-paper transition hover:bg-ink-2 disabled:opacity-50">
              {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'} <ArrowRight className="h-4 w-4" />
            </button>
            {state === 'error' && <p className="mt-3 text-sm text-accent">{message}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
