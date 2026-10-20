/**
 * Gate for the design endpoint. With Supabase configured, a signed-in household member is
 * required. Without it, only local development is allowed, so a deployed app never exposes
 * an open endpoint that spends the API key.
 */
export async function authorize(req: Request): Promise<{ ok: true; user?: string } | { ok: false; status: number; message: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && anon) {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return { ok: false, status: 401, message: 'Please sign in.' };
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return { ok: false, status: 401, message: 'Your session expired. Please sign in again.' };
    const user = (await r.json()) as { id?: string };
    return { ok: true, user: user.id };
  }
  const secret = process.env.DESIGN_API_SECRET;
  if (secret) {
    return req.headers.get('x-design-secret') === secret ? { ok: true } : { ok: false, status: 401, message: 'Not allowed.' };
  }
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_OPEN_DESIGN_API !== '1' && process.env.AI_MODE !== 'mock') {
    return { ok: false, status: 503, message: 'This deployment has no sign-in configured. Set up Supabase (see SETUP.md).' };
  }
  return { ok: true };
}
