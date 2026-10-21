import { NextResponse } from 'next/server';
import { serverSupabase } from '@/lib/supabase/server';
import { NO_STORE, fromOwnSite } from '@/lib/server/site';

/**
 * Sign out: this device, or with scope=global every device (a lost iPad). Clears the session
 * cookies and lands on the sign-in page. Google itself stays signed in; the next sign-in asks
 * which Google account to use.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const scope = form?.get('scope') === 'global' ? 'global' : 'local';
  const why = String(form?.get('why') ?? '');
  if (fromOwnSite(req) && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const sb = await serverSupabase();
    await sb.auth.signOut({ scope }).catch(() => {});
  }
  const to = /^[a-z-]{1,24}$/.test(why) ? why : 'signed-out';
  return NextResponse.redirect(new URL(`/login?signin=${to}`, req.url), { status: 303, headers: NO_STORE });
}
