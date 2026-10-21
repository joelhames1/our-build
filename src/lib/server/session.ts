import 'server-only';
import { adminSupabase, serverSupabase } from '@/lib/supabase/server';
import { resendMailer } from './email';
import { HttpError, type Member, adminEmails, normalizeEmail } from './members';
import { SupabaseAuthAdmin, SupabaseMembers } from './members.supabase';
import { NO_STORE } from './site';
import type { Hit, SignInDeps } from './signin';

/** The real dependencies: Supabase (service role) for members and logins, Resend for email. */
export function signInDeps(): SignInDeps {
  const db = adminSupabase();
  return { store: new SupabaseMembers(db), auth: new SupabaseAuthAdmin(db), mail: resendMailer, admins: adminEmails(), hit: supabaseHit() };
}

/** Rate limits kept in Supabase (rate_hit), so they hold across serverless instances. */
function supabaseHit(): Hit {
  return async (key, limit, windowSeconds) => {
    const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const expires = new Date((bucket + 1) * windowSeconds * 1000).toISOString();
    const { data, error } = await adminSupabase().rpc('rate_hit', { p_key: `${key}:${bucket}`, p_expires: expires });
    // Without the counter, refuse rather than run uncounted.
    if (error) throw new HttpError(503, 'Sign-in links are unavailable for a moment. Try Google, or try again shortly.');
    return Number(data) <= limit;
  };
}

/** The signed-in person and their place on the list, checked with Supabase (not just the cookie). */
export async function currentMember(): Promise<{ userId: string; email: string; member: Member | null } | null> {
  const sb = await serverSupabase();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;
  const store = new SupabaseMembers(adminSupabase());
  const member = (await store.byUserId(user.id)) ?? (await store.byEmail(normalizeEmail(user.email)));
  return { userId: user.id, email: user.email, member };
}

export async function requireAdmin(): Promise<Member> {
  const me = await currentMember();
  if (!me) throw new HttpError(401, 'Please sign in again.');
  if (!me.member || me.member.status !== 'active' || me.member.role !== 'admin') throw new HttpError(403, 'Only an admin can see this.');
  return me.member;
}

/** JSON out, friendly errors in, nothing cached. */
export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const out = await fn();
    if (out instanceof Response) return out;
    return Response.json(out ?? { ok: true }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    console.error(e);
    return Response.json({ error: 'Something went wrong. Try again in a moment?' }, { status: 500, headers: NO_STORE });
  }
}
