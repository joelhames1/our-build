import { type NextRequest, NextResponse } from 'next/server';
import { accountsEnabled, serverSupabase } from '@/lib/supabase/server';
import { signInDeps } from '@/lib/server/session';
import { finishSignIn } from '@/lib/server/signin';
import { NO_STORE, safeNext } from '@/lib/server/site';

/** Back from Google (through Supabase): swap the code for a session, then the members gate. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const next = safeNext(q.get('next'));
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url), { status: 303, headers: NO_STORE });
  const refuse = (why: string) => go(`/login?signin=${why}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`);

  if (q.get('error')) return refuse(q.get('error') === 'access_denied' ? 'cancelled' : 'failed');
  const code = q.get('code');
  if (!code) return refuse('failed');
  if (!accountsEnabled()) return refuse('setup');

  const sb = await serverSupabase();
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.user) return refuse(/verifier|expired|invalid/i.test(error?.message ?? '') ? 'expired' : 'failed');
  const result = await finishSignIn(signInDeps(), sb.auth, data.user, 'Google');
  return result.ok ? go(next) : refuse(result.refusal);
}
