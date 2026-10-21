import { z } from 'zod';
import { emailEnabled, resendMailer } from '@/lib/server/email';
import { HttpError, runAdminAction } from '@/lib/server/members';
import { SupabaseAuthAdmin, SupabaseMembers } from '@/lib/server/members.supabase';
import { requireAdmin, respond } from '@/lib/server/session';
import { fromOwnSite, siteOrigin } from '@/lib/server/site';
import { accountsEnabled, adminSupabase } from '@/lib/supabase/server';

const Id = z.uuid();
const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), email: z.string().max(320), name: z.string().max(80).optional(), role: z.enum(['admin', 'member']).optional() }),
  z.object({ action: z.literal('resend'), id: Id }),
  z.object({ action: z.literal('link'), id: Id }),
  z.object({ action: z.literal('role'), id: Id, role: z.enum(['admin', 'member']) }),
  z.object({ action: z.literal('rename'), id: Id, name: z.string().max(80) }),
  z.object({ action: z.literal('disable'), id: Id }),
  z.object({ action: z.literal('enable'), id: Id }),
  z.object({ action: z.literal('archive'), id: Id }),
  z.object({ action: z.literal('restore'), id: Id }),
  z.object({ action: z.literal('delete'), id: Id, confirm: z.string().max(320).optional() }),
]);

async function snapshot(meId: string) {
  const store = new SupabaseMembers(adminSupabase());
  const [members, events] = await Promise.all([store.list(), store.events(80)]);
  return { me: meId, members, events, email: emailEnabled() };
}

/** Everyone on the list and the recent activity, for the admin page. */
export async function GET() {
  return respond(async () => {
    if (!accountsEnabled()) throw new HttpError(503, 'Accounts aren’t set up on this deployment (see SETUP.md).');
    const admin = await requireAdmin();
    return snapshot(admin.id);
  });
}

/** One admin action (invite, resend, link, role, rename, disable, enable, archive, restore, delete), then the fresh list. */
export async function POST(req: Request) {
  return respond(async () => {
    if (!fromOwnSite(req)) throw new HttpError(403, 'That request came from somewhere else.');
    if (!accountsEnabled()) throw new HttpError(503, 'Accounts aren’t set up on this deployment (see SETUP.md).');
    const actor = await requireAdmin();
    const parsed = Action.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, 'That request didn’t make sense.');
    const db = adminSupabase();
    const out = await runAdminAction({ store: new SupabaseMembers(db), auth: new SupabaseAuthAdmin(db), mail: resendMailer, origin: siteOrigin(req), actor }, parsed.data);
    return { ...out, ...(await snapshot(actor.id)) };
  });
}
