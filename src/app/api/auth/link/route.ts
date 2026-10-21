import { emailEnabled } from '@/lib/server/email';
import { HttpError } from '@/lib/server/members';
import { respond, signInDeps } from '@/lib/server/session';
import { requestLink } from '@/lib/server/signin';
import { clientIp, fromOwnSite, safeNext, siteOrigin } from '@/lib/server/site';
import { accountsEnabled } from '@/lib/supabase/server';

/** "Email me a sign-in link." The same answer, at about the same speed, whether or not the address is on the list. */
export async function POST(req: Request) {
  return respond(async () => {
    if (!fromOwnSite(req)) throw new HttpError(403, 'That request came from somewhere else.');
    if (!accountsEnabled() || !emailEnabled()) throw new HttpError(503, 'Email sign-in isn’t set up yet. Use Google, or see SETUP.md.');
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; next?: unknown };
    const started = Date.now();
    try {
      await requestLink(signInDeps(), { email: String(body.email ?? ''), ip: clientIp(req), origin: siteOrigin(req), next: safeNext(typeof body.next === 'string' ? body.next : null) });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error('sign-in link failed', e);
      throw new HttpError(502, 'The email didn’t go out. Try again in a moment, or use Google.');
    } finally {
      await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - started))));
    }
    return { ok: true };
  });
}
