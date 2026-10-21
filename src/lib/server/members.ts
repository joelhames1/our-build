/**
 * Who gets in, and what an admin can do about it. Pure logic over three small interfaces (the
 * member list, Supabase's auth admin, and the mailer) so it can be tested without a live project.
 * The Supabase-backed implementations live in members.supabase.ts.
 */

export type Role = 'admin' | 'member';
export type Status = 'invited' | 'active' | 'disabled' | 'archived';

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: Status;
  userId: string | null;
  invitedBy: string | null;
  invitedAt: string | null;
  inviteSentAt: string | null;
  activatedAt: string | null;
  lastSignInAt: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  createdAt: string;
}

export type EventKind = 'invited' | 'invite-resent' | 'invite-link' | 'invite-cancelled' | 'joined' | 'signed-in' | 'refused' | 'role-changed' | 'disabled' | 'enabled' | 'archived' | 'restored' | 'deleted' | 'renamed';

export interface MemberEvent {
  id: string;
  at: string;
  kind: EventKind;
  email: string;
  memberId: string | null;
  actorId: string | null;
  detail: Record<string, unknown>;
}

export interface MemberStore {
  byId(id: string): Promise<Member | null>;
  byEmail(email: string): Promise<Member | null>;
  byUserId(userId: string): Promise<Member | null>;
  list(): Promise<Member[]>;
  insert(m: Partial<Member> & { email: string }): Promise<Member>;
  update(id: string, patch: Partial<Member>): Promise<Member>;
  remove(id: string): Promise<void>;
  log(e: Omit<MemberEvent, 'id' | 'at'>): Promise<void>;
  events(limit: number): Promise<MemberEvent[]>;
}

/** The slice of Supabase's auth admin API this needs. */
export interface AuthAdmin {
  /** A one-time sign-in token for this address, creating a confirmed login first if there isn't one. */
  signInToken(email: string, name: string): Promise<{ tokenHash: string; userId: string }>;
  ban(userId: string): Promise<void>;
  unban(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export interface Mailer {
  send(m: { to: string; subject: string; text: string; html: string }): Promise<void>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** ADMIN_EMAILS, comma or space separated. These people always get in, as admins. */
export function adminEmails(raw = process.env.ADMIN_EMAILS ?? ''): string[] {
  return raw
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

// --- signing in -----------------------------------------------------------------------------------

export type Refusal = 'not-invited' | 'disabled' | 'archived' | 'unverified';

export type Admission = { ok: true; member: Member } | { ok: false; refusal: Refusal; /** A login nobody invited: safe to delete. */ stray: boolean };

/**
 * The one gate every sign-in passes, right after Supabase has made the session (Google or an
 * email link). Strangers are refused, paused and retired accounts are refused, invitees become
 * active, and ADMIN_EMAILS can never be locked out.
 */
export async function admit(store: MemberStore, who: { userId: string; email: string | null | undefined; via: string }, opts: { admins: string[]; now?: Date }): Promise<Admission> {
  const now = (opts.now ?? new Date()).toISOString();
  if (!who.email) return { ok: false, refusal: 'unverified', stray: false };
  const email = normalizeEmail(who.email);
  const boss = opts.admins.includes(email);
  let m = (await store.byUserId(who.userId)) ?? (await store.byEmail(email));

  if (!m) {
    if (!boss) {
      await store.log({ kind: 'refused', email, memberId: null, actorId: null, detail: { why: 'not-invited', via: who.via } });
      return { ok: false, refusal: 'not-invited', stray: true };
    }
    m = await store.insert({ email, role: 'admin', status: 'active', userId: who.userId, activatedAt: now, lastSignInAt: now, statusChangedAt: now });
    await store.log({ kind: 'joined', email, memberId: m.id, actorId: m.id, detail: { via: who.via, admin: true } });
    return { ok: true, member: m };
  }

  if ((m.status === 'disabled' || m.status === 'archived') && !boss) {
    await store.log({ kind: 'refused', email, memberId: m.id, actorId: null, detail: { why: m.status, via: who.via } });
    return { ok: false, refusal: m.status, stray: false };
  }

  const joining = m.status !== 'active';
  const patch: Partial<Member> = { lastSignInAt: now, userId: who.userId };
  if (joining) Object.assign(patch, { status: 'active', activatedAt: m.activatedAt ?? now, statusChangedAt: now });
  if (boss) patch.role = 'admin';
  m = await store.update(m.id, patch);
  await store.log({ kind: joining ? 'joined' : 'signed-in', email, memberId: m.id, actorId: m.id, detail: { via: who.via } });
  return { ok: true, member: m };
}

/** Who may get a sign-in link by email: anyone on the list who isn't paused or retired, and the admins. */
export function mayGetLink(m: Member | null, email: string, admins: string[]): boolean {
  if (admins.includes(email)) return true;
  return !!m && (m.status === 'invited' || m.status === 'active');
}

// --- admin actions ----------------------------------------------------------------------------------

export interface AdminCtx {
  store: MemberStore;
  auth: AuthAdmin;
  mail: Mailer;
  /** Where links in emails point, e.g. https://our-build.vercel.app */
  origin: string;
  actor: Member;
  now?: Date;
}

export type AdminAction =
  | { action: 'invite'; email: string; name?: string; role?: Role }
  | { action: 'resend'; id: string }
  | { action: 'link'; id: string }
  | { action: 'role'; id: string; role: Role }
  | { action: 'rename'; id: string; name: string }
  | { action: 'disable'; id: string }
  | { action: 'enable'; id: string }
  | { action: 'archive'; id: string }
  | { action: 'restore'; id: string }
  | { action: 'delete'; id: string; confirm?: string };

export async function runAdminAction(ctx: AdminCtx, a: AdminAction): Promise<{ link?: string }> {
  if (ctx.actor.role !== 'admin' || ctx.actor.status !== 'active') throw new HttpError(403, 'Only an admin can do that.');
  switch (a.action) {
    case 'invite':
      return invite(ctx, a.email, a.name ?? '', a.role ?? 'member');
    case 'resend':
      await sendInvite(ctx, await target(ctx, a.id), 'invite-resent');
      return {};
    case 'link': {
      const m = await target(ctx, a.id);
      if (m.status === 'disabled' || m.status === 'archived') throw new HttpError(409, `${who(m)} is ${m.status}. Turn them back on first.`);
      const { tokenHash, userId } = await ctx.auth.signInToken(m.email, m.name);
      if (!m.userId) await ctx.store.update(m.id, { userId });
      await log(ctx, 'invite-link', m);
      return { link: confirmLink(ctx.origin, tokenHash) };
    }
    case 'role': {
      const m = await target(ctx, a.id);
      if (m.role === a.role) return {};
      if (m.role === 'admin') await keepAnAdmin(ctx, m, 'stop being an admin');
      await ctx.store.update(m.id, { role: a.role });
      await log(ctx, 'role-changed', m, { from: m.role, to: a.role });
      return {};
    }
    case 'rename': {
      const m = await target(ctx, a.id);
      await ctx.store.update(m.id, { name: a.name.trim().slice(0, 80) });
      await log(ctx, 'renamed', m, { name: a.name.trim().slice(0, 80) });
      return {};
    }
    case 'disable':
    case 'archive': {
      const m = await target(ctx, a.id);
      notYourself(ctx, m, a.action === 'disable' ? 'pause' : 'archive');
      if (m.status === (a.action === 'disable' ? 'disabled' : 'archived')) return {};
      await keepAnAdmin(ctx, m, a.action === 'disable' ? 'be paused' : 'be archived');
      // Banning the login ends their sessions as tokens come up for refresh; the data rules
      // already refuse anyone who isn't active, from the next request on.
      if (m.userId) await ctx.auth.ban(m.userId);
      await ctx.store.update(m.id, { status: a.action === 'disable' ? 'disabled' : 'archived', statusChangedAt: now(ctx), statusChangedBy: ctx.actor.id });
      await log(ctx, a.action === 'disable' ? 'disabled' : 'archived', m, { from: m.status });
      return {};
    }
    case 'enable':
    case 'restore': {
      const m = await target(ctx, a.id);
      if (m.status === 'active' || m.status === 'invited') return {};
      if (m.userId) await ctx.auth.unban(m.userId);
      await ctx.store.update(m.id, { status: m.activatedAt ? 'active' : 'invited', statusChangedAt: now(ctx), statusChangedBy: ctx.actor.id });
      await log(ctx, a.action === 'enable' ? 'enabled' : 'restored', m, { from: m.status });
      return {};
    }
    case 'delete': {
      const m = await target(ctx, a.id);
      notYourself(ctx, m, 'delete');
      const pending = m.status === 'invited' && !m.activatedAt;
      if (m.status === 'active') throw new HttpError(409, `Pause or archive ${who(m)} before deleting the account.`);
      if (!pending && normalizeEmail(a.confirm ?? '') !== m.email) throw new HttpError(400, `Type ${m.email} to confirm.`);
      await keepAnAdmin(ctx, m, 'be deleted');
      if (m.userId) await ctx.auth.deleteUser(m.userId);
      await log(ctx, pending ? 'invite-cancelled' : 'deleted', m, { name: m.name, role: m.role });
      await ctx.store.remove(m.id);
      return {};
    }
  }
}

async function invite(ctx: AdminCtx, rawEmail: string, name: string, role: Role): Promise<{ link?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) throw new HttpError(400, 'That doesn’t look like an email address.');
  const existing = await ctx.store.byEmail(email);
  if (existing) {
    if (existing.status === 'active') throw new HttpError(409, `${who(existing)} is already in.`);
    if (existing.status === 'disabled' || existing.status === 'archived') throw new HttpError(409, `${who(existing)} is ${existing.status}. Use Restore to bring them back.`);
    await sendInvite(ctx, existing, 'invite-resent');
    return {};
  }
  const m = await ctx.store.insert({ email, name: name.trim().slice(0, 80), role, status: 'invited', invitedBy: ctx.actor.id, invitedAt: now(ctx) });
  await sendInvite(ctx, m, 'invited');
  return {};
}

async function sendInvite(ctx: AdminCtx, m: Member, kind: 'invited' | 'invite-resent') {
  if (m.status === 'disabled' || m.status === 'archived') throw new HttpError(409, `${who(m)} is ${m.status}. Turn them back on first.`);
  const { tokenHash, userId } = await ctx.auth.signInToken(m.email, m.name);
  if (!m.userId) await ctx.store.update(m.id, { userId });
  const mail = inviteEmail({ to: m, from: ctx.actor, link: confirmLink(ctx.origin, tokenHash), origin: ctx.origin });
  try {
    await ctx.mail.send({ to: m.email, ...mail });
  } catch (e) {
    throw new HttpError(502, `${who(m)} is on the list, but the email didn’t go out (${e instanceof Error ? e.message : 'no reason given'}). Use “Copy invite link” to send it yourself.`);
  }
  await ctx.store.update(m.id, { inviteSentAt: now(ctx) });
  await log(ctx, kind, m);
}

async function target(ctx: AdminCtx, id: string): Promise<Member> {
  const m = await ctx.store.byId(id);
  if (!m) throw new HttpError(404, 'That person isn’t on the list any more.');
  return m;
}

function notYourself(ctx: AdminCtx, m: Member, what: string) {
  if (m.id === ctx.actor.id) throw new HttpError(409, `You can’t ${what} your own account.`);
}

/** Someone has to be left holding the keys. */
async function keepAnAdmin(ctx: AdminCtx, m: Member, what: string) {
  if (m.role !== 'admin' || m.status !== 'active') return;
  const others = (await ctx.store.list()).filter((x) => x.id !== m.id && x.role === 'admin' && x.status === 'active');
  if (!others.length) throw new HttpError(409, `${who(m)} is the only admin and can’t ${what}. Make someone else an admin first.`);
}

const now = (ctx: AdminCtx) => (ctx.now ?? new Date()).toISOString();
const who = (m: Member) => m.name || m.email;
const log = (ctx: AdminCtx, kind: EventKind, m: Member, detail: Record<string, unknown> = {}) => ctx.store.log({ kind, email: m.email, memberId: m.id, actorId: ctx.actor.id, detail });

/** The link in every sign-in email: a page with a button, so mail scanners that open links can't use it up. */
export function confirmLink(origin: string, tokenHash: string, next = '/') {
  return `${origin.replace(/\/$/, '')}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=magiclink${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}`;
}

// --- emails ---------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(heading: string, paragraphs: string[], button: { label: string; href: string }, footer: string): string {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#3b3833">${t}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f2ea;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:32px">
<tr><td>
<p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1f1d1a">Our Build</p>
<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.25;color:#1f1d1a">${heading}</h1>
${p}
<p style="margin:24px 0"><a href="${esc(button.href)}" style="display:inline-block;background:#1f1d1a;color:#fbfaf6;text-decoration:none;font-size:16px;padding:14px 26px;border-radius:999px">${esc(button.label)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#8a847a">${footer}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function inviteEmail({ to, from, link, origin }: { to: Pick<Member, 'name' | 'email'>; from: Pick<Member, 'name' | 'email'>; link: string; origin: string }) {
  const inviter = from.name || from.email;
  const hi = to.name ? `Hi ${to.name},` : 'Hi,';
  const subject = `${inviter} invited you to Our Build`;
  const text = [
    hi,
    '',
    `${inviter} invited you to Our Build, where you describe a house in plain words and then walk through it, change it by talking, and print plans.`,
    '',
    `Open Our Build: ${link}`,
    '',
    `If the link has expired by the time you get to it, go to ${origin} and choose "Continue with Google" using ${to.email}, or ask for a fresh email link there.`,
  ].join('\n');
  const html = layout(
    `${esc(inviter)} invited you to Our Build`,
    [esc(hi), 'Describe a house in plain words, then walk through it, change it by talking, and print plans when it feels right.'],
    { label: 'Open Our Build', href: link },
    `If the button has expired by the time you get to it, go to <a href="${esc(origin)}" style="color:#8a847a">${esc(origin.replace(/^https?:\/\//, ''))}</a> and choose “Continue with Google” using ${esc(to.email)}, or ask for a fresh email link there.`,
  );
  return { subject, text, html };
}

export function signInEmail({ link, origin }: { link: string; origin: string }) {
  const subject = 'Your Our Build sign-in link';
  const text = ['Here’s your link to sign in to Our Build:', '', link, '', 'It works once and expires soon. Didn’t ask for it? Ignore this email; nothing happens without the link.', '', origin].join('\n');
  const html = layout('Sign in to Our Build', ['Tap the button to sign in. It works once and expires soon.'], { label: 'Sign in', href: link }, 'Didn’t ask for this? Ignore it; nothing happens without the link.');
  return { subject, text, html };
}
