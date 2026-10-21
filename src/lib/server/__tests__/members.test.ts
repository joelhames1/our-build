import { beforeEach, describe, expect, it } from 'vitest';
import { type AdminCtx, type AuthAdmin, HttpError, type Mailer, type Member, type MemberEvent, type MemberStore, admit, adminEmails, inviteEmail, runAdminAction } from '../members';
import { type Hit, finishSignIn, requestLink } from '../signin';

class MemoryStore implements MemberStore {
  rows: Member[] = [];
  log_: MemberEvent[] = [];
  private n = 0;
  async byId(id: string) {
    return this.rows.find((m) => m.id === id) ?? null;
  }
  async byEmail(email: string) {
    return this.rows.find((m) => m.email === email) ?? null;
  }
  async byUserId(userId: string) {
    return this.rows.find((m) => m.userId === userId) ?? null;
  }
  async list() {
    return [...this.rows];
  }
  async insert(m: Partial<Member> & { email: string }) {
    const row: Member = { id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, name: '', role: 'member', status: 'invited', userId: null, invitedBy: null, invitedAt: null, inviteSentAt: null, activatedAt: null, lastSignInAt: null, statusChangedAt: null, statusChangedBy: null, createdAt: new Date().toISOString(), ...m };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: Partial<Member>) {
    const row = this.rows.find((m) => m.id === id)!;
    Object.assign(row, patch);
    return { ...row };
  }
  async remove(id: string) {
    this.rows = this.rows.filter((m) => m.id !== id);
  }
  async log(e: Omit<MemberEvent, 'id' | 'at'>) {
    this.log_.push({ ...e, id: String(this.log_.length), at: new Date().toISOString() });
  }
  async events(limit: number) {
    return this.log_.slice(-limit).reverse();
  }
}

class FakeAuth implements AuthAdmin {
  users = new Map<string, string>(); // email -> id
  banned = new Set<string>();
  deleted: string[] = [];
  async signInToken(email: string) {
    if (!this.users.has(email)) this.users.set(email, `user-${this.users.size + 1}`);
    return { tokenHash: `hash-for-${email}`, userId: this.users.get(email)! };
  }
  async ban(id: string) {
    this.banned.add(id);
  }
  async unban(id: string) {
    this.banned.delete(id);
  }
  async deleteUser(id: string) {
    this.deleted.push(id);
  }
}

class Outbox implements Mailer {
  sent: { to: string; subject: string; text: string; html: string }[] = [];
  fail = false;
  async send(m: { to: string; subject: string; text: string; html: string }) {
    if (this.fail) throw new Error('domain not verified');
    this.sent.push(m);
  }
}

let store: MemoryStore;
let auth: FakeAuth;
let mail: Outbox;
let joel: Member;
const ORIGIN = 'https://ourbuild.example';
const ctx = (actor: Member = joel): AdminCtx => ({ store, auth, mail, origin: ORIGIN, actor });

beforeEach(async () => {
  store = new MemoryStore();
  auth = new FakeAuth();
  mail = new Outbox();
  const first = await admit(store, { userId: 'joel-login', email: 'Boss@Example.com', via: 'Google' }, { admins: ['boss@example.com'] });
  if (!first.ok) throw new Error('bootstrap failed');
  joel = first.member;
});

describe('the sign-in gate', () => {
  it('lets the ADMIN_EMAILS address in as an admin the first time, with no invite', () => {
    expect(joel).toMatchObject({ email: 'boss@example.com', role: 'admin', status: 'active', userId: 'joel-login' });
    expect(adminEmails('a@x.com, B@y.com;c@z.com')).toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });

  it('refuses a stranger and marks the login as stray', async () => {
    const r = await admit(store, { userId: 'u9', email: 'stranger@gmail.com', via: 'Google' }, { admins: [] });
    expect(r).toEqual({ ok: false, refusal: 'not-invited', stray: true });
    expect(store.log_.at(-1)).toMatchObject({ kind: 'refused', email: 'stranger@gmail.com' });
    // finishSignIn ends the session and removes that login.
    let signedOut = false;
    await finishSignIn({ store, auth, admins: [] }, { signOut: async () => (signedOut = true) }, { id: 'u9', email: 'stranger@gmail.com' }, 'Google');
    expect(signedOut).toBe(true);
    expect(auth.deleted).toContain('u9');
  });

  it('turns an invitee active on first sign-in, whichever login they use', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'Erin@Example.com', name: 'Erin' });
    const erin = (await store.byEmail('erin@example.com'))!;
    expect(erin.status).toBe('invited');
    // She uses Google, which Supabase made a different login for than the invite's.
    const r = await admit(store, { userId: 'google-erin', email: 'erin@example.com', via: 'Google' }, { admins: [] });
    expect(r.ok && r.member).toMatchObject({ status: 'active', userId: 'google-erin' });
    expect(store.log_.some((e) => e.kind === 'joined' && e.email === 'erin@example.com')).toBe(true);
  });

  it('refuses paused and archived accounts without deleting their login', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'erin@example.com' });
    await admit(store, { userId: 'e1', email: 'erin@example.com', via: 'Google' }, { admins: [] });
    const erin = (await store.byEmail('erin@example.com'))!;
    await runAdminAction(ctx(), { action: 'disable', id: erin.id });
    expect(await admit(store, { userId: 'e1', email: 'erin@example.com', via: 'Google' }, { admins: [] })).toEqual({ ok: false, refusal: 'disabled', stray: false });
    await runAdminAction(ctx(), { action: 'archive', id: erin.id });
    expect(await admit(store, { userId: 'e1', email: 'erin@example.com', via: 'Google' }, { admins: [] })).toEqual({ ok: false, refusal: 'archived', stray: false });
  });

  it('never locks out an ADMIN_EMAILS address', async () => {
    await store.update(joel.id, { status: 'disabled', role: 'member' });
    const r = await admit(store, { userId: 'joel-login', email: 'boss@example.com', via: 'email link' }, { admins: ['boss@example.com'] });
    expect(r.ok && r.member).toMatchObject({ status: 'active', role: 'admin' });
  });
});

describe('admin actions', () => {
  it('invites by email with a working link, and keeps the person listed if the email fails', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'erin@example.com', name: 'Erin <3' });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toBe('boss@example.com invited you to Our Build');
    expect(mail.sent[0].text).toContain(`${ORIGIN}/auth/confirm?token_hash=hash-for-erin%40example.com&type=magiclink`);
    expect(mail.sent[0].html).toContain('Hi Erin &lt;3,');
    expect((await store.byEmail('erin@example.com'))!.inviteSentAt).not.toBeNull();

    mail.fail = true;
    await expect(runAdminAction(ctx(), { action: 'invite', email: 'sam@example.com' })).rejects.toThrow(/on the list, but the email didn’t go out/);
    expect(await store.byEmail('sam@example.com')).not.toBeNull();
    const { link } = await runAdminAction(ctx(), { action: 'link', id: (await store.byEmail('sam@example.com'))!.id });
    expect(link).toBe(`${ORIGIN}/auth/confirm?token_hash=hash-for-sam%40example.com&type=magiclink`);
  });

  it('rejects bad addresses and people already in', async () => {
    await expect(runAdminAction(ctx(), { action: 'invite', email: 'not an email' })).rejects.toBeInstanceOf(HttpError);
    await expect(runAdminAction(ctx(), { action: 'invite', email: 'boss@example.com' })).rejects.toThrow(/already in/);
  });

  it('pauses with a ban and turns back on without one', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'erin@example.com' });
    await admit(store, { userId: 'e1', email: 'erin@example.com', via: 'Google' }, { admins: [] });
    const erin = (await store.byEmail('erin@example.com'))!;
    await runAdminAction(ctx(), { action: 'disable', id: erin.id });
    expect(auth.banned.has('e1')).toBe(true);
    expect((await store.byId(erin.id))!.status).toBe('disabled');
    await runAdminAction(ctx(), { action: 'enable', id: erin.id });
    expect(auth.banned.has('e1')).toBe(false);
    expect((await store.byId(erin.id))!.status).toBe('active');
  });

  it('restores someone who never signed in as invited', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'sam@example.com' });
    const sam = (await store.byEmail('sam@example.com'))!;
    await store.update(sam.id, { status: 'archived' });
    await runAdminAction(ctx(), { action: 'restore', id: sam.id });
    expect((await store.byId(sam.id))!.status).toBe('invited');
  });

  it('guards the keys: not yourself, not the last admin', async () => {
    await expect(runAdminAction(ctx(), { action: 'disable', id: joel.id })).rejects.toThrow(/your own account/);
    await expect(runAdminAction(ctx(), { action: 'role', id: joel.id, role: 'member' })).rejects.toThrow(/only admin/);
    await runAdminAction(ctx(), { action: 'invite', email: 'erin@example.com', role: 'admin' });
    await admit(store, { userId: 'e1', email: 'erin@example.com', via: 'Google' }, { admins: [] });
    // With a second active admin, Joel can step down.
    await runAdminAction(ctx(), { action: 'role', id: joel.id, role: 'member' });
    expect((await store.byId(joel.id))!.role).toBe('member');
    // And a member can't run admin actions.
    const member = (await store.byId(joel.id))!;
    await expect(runAdminAction(ctx(member), { action: 'invite', email: 'x@example.com' })).rejects.toThrow(/Only an admin/);
  });

  it('deletes only after a pause or archive, with the email typed', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'erin@example.com' });
    await admit(store, { userId: 'e1', email: 'erin@example.com', via: 'Google' }, { admins: [] });
    const erin = (await store.byEmail('erin@example.com'))!;
    await expect(runAdminAction(ctx(), { action: 'delete', id: erin.id, confirm: 'erin@example.com' })).rejects.toThrow(/Pause or archive/);
    await runAdminAction(ctx(), { action: 'archive', id: erin.id });
    await expect(runAdminAction(ctx(), { action: 'delete', id: erin.id, confirm: 'erin' })).rejects.toThrow(/Type erin@example.com/);
    await runAdminAction(ctx(), { action: 'delete', id: erin.id, confirm: ' Erin@Example.com ' });
    expect(await store.byId(erin.id)).toBeNull();
    expect(auth.deleted).toContain('e1');
    expect(store.log_.at(-1)).toMatchObject({ kind: 'deleted', email: 'erin@example.com' });
  });

  it('cancels a pending invite without the typing step', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'sam@example.com' });
    const sam = (await store.byEmail('sam@example.com'))!;
    await runAdminAction(ctx(), { action: 'delete', id: sam.id });
    expect(await store.byId(sam.id)).toBeNull();
    expect(store.log_.at(-1)).toMatchObject({ kind: 'invite-cancelled' });
  });
});

describe('email sign-in links', () => {
  const unlimited: Hit = async () => true;
  const deps = (hit: Hit = unlimited) => ({ store, auth, mail, hit, admins: ['boss@example.com'] });

  it('emails people on the list and nobody else, with the same outcome either way', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'erin@example.com' });
    mail.sent = [];
    await expect(requestLink(deps(), { email: 'Erin@example.com', ip: '1.1.1.1', origin: ORIGIN })).resolves.toBeUndefined();
    await expect(requestLink(deps(), { email: 'stranger@example.com', ip: '1.1.1.1', origin: ORIGIN })).resolves.toBeUndefined();
    expect(mail.sent.map((m) => m.to)).toEqual(['erin@example.com']);
    expect(mail.sent[0].text).toContain(`${ORIGIN}/auth/confirm?token_hash=`);
    expect(auth.users.has('stranger@example.com')).toBe(false);
  });

  it('sends nothing to paused accounts, and carries where to go next', async () => {
    await runAdminAction(ctx(), { action: 'invite', email: 'erin@example.com' });
    await admit(store, { userId: 'e1', email: 'erin@example.com', via: 'Google' }, { admins: [] });
    await runAdminAction(ctx(), { action: 'disable', id: (await store.byEmail('erin@example.com'))!.id });
    mail.sent = [];
    await requestLink(deps(), { email: 'erin@example.com', ip: '1.1.1.1', origin: ORIGIN });
    expect(mail.sent).toHaveLength(0);
    await requestLink(deps(), { email: 'boss@example.com', ip: '1.1.1.1', origin: ORIGIN, next: '/p/abc' });
    expect(mail.sent[0].text).toContain('&next=%2Fp%2Fabc');
  });

  it('stops at the limits', async () => {
    const counts = new Map<string, number>();
    const hit: Hit = async (key, limit) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts.get(key)! <= limit;
    };
    for (let i = 0; i < 5; i++) await requestLink(deps(hit), { email: 'boss@example.com', ip: `10.0.0.${i}`, origin: ORIGIN });
    await expect(requestLink(deps(hit), { email: 'boss@example.com', ip: '10.0.0.99', origin: ORIGIN })).rejects.toMatchObject({ status: 429 });
    await expect(requestLink(deps(hit), { email: 'nope', ip: '1.2.3.4', origin: ORIGIN })).rejects.toMatchObject({ status: 400 });
  });
});

describe('email templates', () => {
  it('escapes names and addresses in the HTML', () => {
    const m = inviteEmail({ to: { name: '<b>Erin</b>', email: 'e@x.com' }, from: { name: 'Jo & Co', email: 'j@x.com' }, link: 'https://x/auth/confirm?token_hash=a&type=magiclink', origin: 'https://x' });
    expect(m.html).toContain('Jo &amp; Co invited you');
    expect(m.html).not.toContain('<b>Erin</b>');
    expect(m.html).toContain('href="https://x/auth/confirm?token_hash=a&amp;type=magiclink"');
  });
});
