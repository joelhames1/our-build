import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { accountsEnabled, serverSupabase } from '@/lib/supabase/server';
import { signInDeps } from '@/lib/server/session';
import { finishSignIn } from '@/lib/server/signin';
import { NO_STORE, fromOwnSite, safeNext } from '@/lib/server/site';

const TYPES = new Set<EmailOtpType>(['magiclink', 'invite', 'email', 'signup']);

/** The button on /auth/confirm: use the one-time token from an email link, then the members gate. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(String(form?.get('next') ?? ''));
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url), { status: 303, headers: NO_STORE });
  const refuse = (why: string) => go(`/login?signin=${why}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`);

  if (!fromOwnSite(req)) return refuse('failed');
  if (!accountsEnabled()) return refuse('setup');
  const tokenHash = String(form?.get('token_hash') ?? '');
  const type = String(form?.get('type') ?? 'magiclink') as EmailOtpType;
  if (!tokenHash || !TYPES.has(type)) return refuse('expired');

  const sb = await serverSupabase();
  const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) return refuse('expired');
  const result = await finishSignIn(signInDeps(), sb.auth, data.user, 'email link');
  return result.ok ? go(next) : refuse(result.refusal);
}
