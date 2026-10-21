import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthAdmin, Member, MemberEvent, MemberStore } from './members';

/** The member list in Supabase, through the service-role client. */
export class SupabaseMembers implements MemberStore {
  constructor(private db: SupabaseClient) {}

  async byId(id: string) {
    return this.one(this.db.from('members').select('*').eq('id', id).maybeSingle());
  }
  async byEmail(email: string) {
    return this.one(this.db.from('members').select('*').eq('email', email).maybeSingle());
  }
  async byUserId(userId: string) {
    return this.one(this.db.from('members').select('*').eq('user_id', userId).maybeSingle());
  }
  async list() {
    const { data, error } = await this.db.from('members').select('*').order('created_at');
    if (error) throw error;
    return (data as Row[]).map(toMember);
  }
  async insert(m: Partial<Member> & { email: string }) {
    const { data, error } = await this.db.from('members').insert(toRow(m)).select('*').single();
    if (error) throw error;
    return toMember(data as Row);
  }
  async update(id: string, patch: Partial<Member>) {
    const { data, error } = await this.db.from('members').update(toRow(patch)).eq('id', id).select('*').single();
    if (error) throw error;
    return toMember(data as Row);
  }
  async remove(id: string) {
    const { error } = await this.db.from('members').delete().eq('id', id);
    if (error) throw error;
  }
  async log(e: Omit<MemberEvent, 'id' | 'at'>) {
    const { error } = await this.db.from('member_events').insert({ kind: e.kind, email: e.email, member_id: e.memberId, actor_id: e.actorId, detail: e.detail });
    if (error) console.error('member event not logged', error.message);
  }
  async events(limit: number) {
    const { data, error } = await this.db.from('member_events').select('*').order('at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data as EventRow[]).map((r) => ({ id: r.id, at: r.at, kind: r.kind as MemberEvent['kind'], email: r.email, memberId: r.member_id, actorId: r.actor_id, detail: r.detail ?? {} }));
  }

  private async one(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ? toMember(data as Row) : null;
  }
}

/** Supabase's auth admin API: logins, one-time sign-in tokens, bans. */
export class SupabaseAuthAdmin implements AuthAdmin {
  constructor(private db: SupabaseClient) {}

  async signInToken(email: string, name: string) {
    // A confirmed login first, so Google sign-in with the same address joins this account.
    const created = await this.db.auth.admin.createUser({ email, email_confirm: true, user_metadata: name ? { name } : {} });
    if (created.error && !/already|registered|exists/i.test(created.error.message)) throw new Error(created.error.message);
    const { data, error } = await this.db.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !data.properties?.hashed_token || !data.user) throw new Error(error?.message ?? 'Supabase made no sign-in link.');
    return { tokenHash: data.properties.hashed_token, userId: data.user.id };
  }
  async ban(userId: string) {
    const { error } = await this.db.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
    if (error && !/not found/i.test(error.message)) throw new Error(error.message);
  }
  async unban(userId: string) {
    const { error } = await this.db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    if (error && !/not found/i.test(error.message)) throw new Error(error.message);
  }
  async deleteUser(userId: string) {
    const { error } = await this.db.auth.admin.deleteUser(userId);
    if (error && !/not found/i.test(error.message)) throw new Error(error.message);
  }
}

interface Row {
  id: string;
  email: string;
  name: string;
  role: Member['role'];
  status: Member['status'];
  user_id: string | null;
  invited_by: string | null;
  invited_at: string | null;
  invite_sent_at: string | null;
  activated_at: string | null;
  last_sign_in_at: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  created_at: string;
}

interface EventRow {
  id: string;
  at: string;
  kind: string;
  email: string;
  member_id: string | null;
  actor_id: string | null;
  detail: Record<string, unknown> | null;
}

const toMember = (r: Row): Member => ({
  id: r.id,
  email: r.email,
  name: r.name ?? '',
  role: r.role,
  status: r.status,
  userId: r.user_id,
  invitedBy: r.invited_by,
  invitedAt: r.invited_at,
  inviteSentAt: r.invite_sent_at,
  activatedAt: r.activated_at,
  lastSignInAt: r.last_sign_in_at,
  statusChangedAt: r.status_changed_at,
  statusChangedBy: r.status_changed_by,
  createdAt: r.created_at,
});

const COLUMNS: Record<keyof Omit<Member, 'id' | 'createdAt'>, keyof Row> = {
  email: 'email',
  name: 'name',
  role: 'role',
  status: 'status',
  userId: 'user_id',
  invitedBy: 'invited_by',
  invitedAt: 'invited_at',
  inviteSentAt: 'invite_sent_at',
  activatedAt: 'activated_at',
  lastSignInAt: 'last_sign_in_at',
  statusChangedAt: 'status_changed_at',
  statusChangedBy: 'status_changed_by',
};

function toRow(m: Partial<Member>): Partial<Row> {
  const out: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(COLUMNS)) if (k in m && (m as Record<string, unknown>)[k] !== undefined) out[col] = (m as Record<string, unknown>)[k];
  return out as Partial<Row>;
}
