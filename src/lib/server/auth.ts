import { serverSupabase } from '@/lib/supabase/server';

/**
 * Gate for the design endpoint. With Supabase configured, the caller must be a signed-in, active
 * member (see 0002_members.sql). Without it, only local development (or an explicit shared
 * secret) is allowed, so a deployed app never exposes an open endpoint that spends the API key.
 */
type Result = { ok: true; user?: string } | { ok: false; status: number; message: string };

const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 60;

/** Best-effort per-user rate limit (per server instance). */
function limited(key: string): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(key, list);
  return list.length > MAX_PER_WINDOW;
}

export async function authorize(req: Request): Promise<Result> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && anon) {
    // The studio sends its access token; anything else signed in on this site has the session cookie.
    let token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) token = (await (await serverSupabase()).auth.getSession()).data.session?.access_token;
    if (!token) return { ok: false, status: 401, message: 'Please sign in.' };
    const headers = { apikey: anon, Authorization: `Bearer ${token}` };
    const u = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
    if (!u.ok) return { ok: false, status: 401, message: 'Your session expired. Please sign in again.' };
    const user = (await u.json()) as { id?: string };
    const member = await fetch(`${supabaseUrl}/rest/v1/rpc/is_member`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
    if (!member.ok || (await member.json()) !== true) return { ok: false, status: 403, message: 'Your account isn’t active. Ask whoever runs Our Build.' };
    if (limited(user.id ?? token.slice(-16))) return { ok: false, status: 429, message: 'That’s a lot of changes in a short time. Take a breather and try again in a few minutes.' };
    return { ok: true, user: user.id };
  }
  const secret = process.env.DESIGN_API_SECRET;
  if (secret) return req.headers.get('x-design-secret') === secret ? { ok: true } : { ok: false, status: 401, message: 'Not allowed.' };
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_OPEN_DESIGN_API !== '1' && process.env.AI_MODE !== 'mock') {
    return { ok: false, status: 503, message: 'This deployment has no sign-in configured. Set up Supabase (see SETUP.md).' };
  }
  if (limited('local')) return { ok: false, status: 429, message: 'Too many requests. Try again in a few minutes.' };
  return { ok: true };
}
