/** Request helpers shared by the auth and admin routes. */

/** True when a write came from a page on this site (not a form or script on someone else's). */
export function fromOwnSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Where this site lives, for links in emails: SITE_URL if set, otherwise the request's own origin. */
export function siteOrigin(req: Request): string {
  const fixed = process.env.SITE_URL;
  if (fixed) return fixed.replace(/\/$/, '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/** Only paths on this site, so a crafted link can't bounce someone elsewhere after signing in. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next.startsWith('/login') || next.startsWith('/auth/') || next.startsWith('/api/')) return '/';
  return next;
}

export const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/** The caller's address, for rate limits. */
export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}
