import { HttpError } from '@/lib/server/members';
import { currentMember, respond } from '@/lib/server/session';
import { NO_STORE } from '@/lib/server/site';
import { accountsEnabled } from '@/lib/supabase/server';

/** Who's signed in and whether they're still let in. Disabled or archived people get a 403 saying which. */
export async function GET() {
  return respond(async () => {
    if (!accountsEnabled()) throw new HttpError(503, 'Accounts aren’t set up on this deployment (see SETUP.md).');
    const me = await currentMember();
    if (!me) throw new HttpError(401, 'Please sign in.');
    const m = me.member;
    if (!m || m.status !== 'active') return Response.json({ refusal: m && (m.status === 'disabled' || m.status === 'archived') ? m.status : 'not-invited' }, { status: 403, headers: NO_STORE });
    return { id: m.id, email: m.email, name: m.name, role: m.role };
  });
}
