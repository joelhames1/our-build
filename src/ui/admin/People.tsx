'use client';

import { Archive, ArrowLeft, Check, Copy, Link2, MoreHorizontal, Pause, Pencil, Play, RotateCcw, Send, Share, Shield, ShieldOff, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountMenu } from '../AccountMenu';
import { Logo } from '../Logo';

type Role = 'admin' | 'member';
type Status = 'invited' | 'active' | 'disabled' | 'archived';

interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: Status;
  inviteSentAt: string | null;
  invitedAt: string | null;
  activatedAt: string | null;
  lastSignInAt: string | null;
  statusChangedAt: string | null;
  createdAt: string;
}

interface Event {
  id: string;
  at: string;
  kind: string;
  email: string;
  memberId: string | null;
  actorId: string | null;
  detail: Record<string, unknown>;
}

interface Snapshot {
  me: string;
  members: Member[];
  events: Event[];
  email: boolean;
  link?: string;
}

type Action = { action: 'invite'; email: string; name?: string; role?: Role } | { action: 'resend' | 'link' | 'disable' | 'enable' | 'archive' | 'restore'; id: string } | { action: 'role'; id: string; role: Role } | { action: 'rename'; id: string; name: string } | { action: 'delete'; id: string; confirm?: string };

/** The admin's people page: invite, and pause, archive, restore or delete accounts. */
export function People() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ who: string; url: string } | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const show = useCallback((r: Listing) => (r.ok ? setData(r.body as Snapshot) : setError((r.body as { error?: string }).error ?? 'Couldn’t load the list.')), []);
  const load = useCallback(async () => show(await listing()), [show]);
  useEffect(() => {
    let alive = true;
    listing().then((r) => alive && show(r));
    return () => {
      alive = false;
    };
  }, [show]);

  async function act(a: Action, done?: string): Promise<Snapshot | null> {
    setBusy('id' in a ? a.id : 'invite');
    setError(null);
    setNotice(null);
    try {
      const r = await fetch('/api/admin/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError((body as { error?: string }).error ?? 'That didn’t work. Try again?');
        await load();
        return null;
      }
      setData(body as Snapshot);
      if (done) setNotice(done);
      return body as Snapshot;
    } finally {
      setBusy(null);
    }
  }

  const members = useMemo(() => data?.members ?? [], [data]);
  const current = members.filter((m) => m.status !== 'archived').sort(byName);
  const archived = members.filter((m) => m.status === 'archived').sort(byName);
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name || members.find((m) => m.id === id)?.email) : null);

  return (
    <div className="min-h-dvh bg-[radial-gradient(1200px_600px_at_50%_-10%,#fffaf2,transparent),linear-gradient(#f7f4ee,#efe9df)] pb-24">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-5 pt-6 md:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <ArrowLeft className="h-4 w-4 text-ink-2" />
          <Logo className="h-8 w-8" />
          <span className="font-serif text-2xl tracking-tight">Our Build</span>
        </Link>
        <AccountMenu />
      </header>

      <main className="mx-auto max-w-4xl px-5 md:px-8">
        <h1 className="mt-10 font-serif text-4xl text-ink">People</h1>
        <p className="mt-2 text-ink-2">Everyone here can see and change every design. Invite someone and they can sign in with Google or an email link.</p>

        {error && (
          <p className="mt-6 rounded-2xl bg-accent/10 px-4 py-3 text-sm text-accent" role="alert" data-testid="admin-error">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-6 flex items-center gap-2 rounded-2xl bg-white/70 px-4 py-3 text-sm text-ink-2" role="status">
            <Check className="h-4 w-4 text-accent" /> {notice}
          </p>
        )}
        {data && !data.email && <p className="mt-6 rounded-2xl bg-white/70 px-4 py-3 text-sm text-ink-2">Email isn’t set up yet (RESEND_API_KEY), so invites can’t be sent by email. Add someone, then use “Copy invite link” and send it yourself.</p>}

        <InviteForm busy={busy === 'invite'} onInvite={async (email, name, role) => !!(await act({ action: 'invite', email, name, role }, `Invite sent to ${email}.`))} />

        <section className="mt-10">
          <h2 className="font-serif text-2xl text-ink">On the list</h2>
          <ul className="mt-4 divide-y divide-line overflow-visible rounded-3xl border border-line bg-white/70" data-testid="people">
            {!data && <li className="px-5 py-6 text-sm text-muted">Loading…</li>}
            {current.map((m) => (
              <Row key={m.id} m={m} me={data?.me ?? ''} busy={busy === m.id} act={act} onLink={(url) => setLink({ who: m.name || m.email, url })} onDelete={() => setDeleting(m)} />
            ))}
          </ul>
        </section>

        {archived.length > 0 && (
          <section className="mt-8">
            <button onClick={() => setShowArchived((s) => !s)} className="font-serif text-xl text-ink-2 hover:text-ink">
              Archived ({archived.length}) {showArchived ? '▾' : '▸'}
            </button>
            {showArchived && (
              <ul className="mt-3 divide-y divide-line rounded-3xl border border-line bg-white/50">
                {archived.map((m) => (
                  <Row key={m.id} m={m} me={data?.me ?? ''} busy={busy === m.id} act={act} onLink={(url) => setLink({ who: m.name || m.email, url })} onDelete={() => setDeleting(m)} />
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="mt-10">
          <h2 className="font-serif text-2xl text-ink">Recent activity</h2>
          <ul className="mt-4 space-y-2 text-sm" data-testid="activity">
            {(data?.events ?? []).slice(0, 40).map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-4 rounded-2xl bg-white/50 px-4 py-2.5">
                <span className="text-ink-2">{describe(e, nameOf)}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                  {e.kind === 'refused' && e.detail.why === 'not-invited' && !members.some((m) => m.email === e.email) && (
                    <button onClick={() => act({ action: 'invite', email: e.email }, `Invite sent to ${e.email}.`)} className="rounded-full bg-ink px-3 py-1 text-paper">
                      Invite
                    </button>
                  )}
                  {when(e.at)}
                </span>
              </li>
            ))}
            {data && !data.events.length && <li className="text-muted">Nothing yet.</li>}
          </ul>
        </section>
      </main>

      {link && <LinkDialog who={link.who} url={link.url} onClose={() => setLink(null)} />}
      {deleting && (
        <DeleteDialog
          m={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={async (confirm) => {
            const ok = await act({ action: 'delete', id: deleting.id, confirm }, deleting.status === 'invited' && !deleting.activatedAt ? `Invite for ${deleting.email} cancelled.` : `${deleting.name || deleting.email}’s account is deleted.`);
            if (ok) setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function InviteForm({ busy, onInvite }: { busy: boolean; onInvite: (email: string, name: string, role: Role) => Promise<boolean> }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  return (
    <form
      className="mt-8 rounded-3xl border border-line bg-white/80 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onInvite(email.trim(), name.trim(), role)) {
          setEmail('');
          setName('');
          setRole('member');
        }
      }}
      data-testid="invite-form"
    >
      <h2 className="font-serif text-xl text-ink">Invite someone</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-[1.4fr_1fr_auto_auto]">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their@email.com" aria-label="Email to invite" className="h-11 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none focus:border-accent" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Their name" className="h-11 rounded-2xl border border-line bg-white px-4 text-[16px] outline-none focus:border-accent" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role" className="h-11 rounded-2xl border border-line bg-white px-3 text-[15px] text-ink outline-none">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button disabled={busy} className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-ink px-5 text-paper transition hover:bg-ink-2 disabled:opacity-50">
          <Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">Admins can also invite people and manage accounts. They’ll get an email with a button; they can also just sign in with Google using that address.</p>
    </form>
  );
}

function Row({ m, me, busy, act, onLink, onDelete }: { m: Member; me: string; busy: boolean; act: (a: Action, done?: string) => Promise<Snapshot | null>; onLink: (url: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const you = m.id === me;
  const who = m.name || m.email;
  const pending = m.status === 'invited' && !m.activatedAt;
  const item = (icon: React.ReactNode, label: string, run: () => void, danger = false) => (
    <button
      key={label}
      onClick={() => {
        setOpen(false);
        run();
      }}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/70 ${danger ? 'text-accent' : 'text-ink'}`}
      role="menuitem"
    >
      {icon} {label}
    </button>
  );
  const items: React.ReactNode[] = [];
  if (m.status === 'invited') {
    items.push(item(<Send className="h-4 w-4" />, 'Resend invite', () => act({ action: 'resend', id: m.id }, `Invite sent to ${m.email} again.`)));
    items.push(
      item(<Link2 className="h-4 w-4" />, 'Copy invite link', async () => {
        const s = await act({ action: 'link', id: m.id });
        if (s?.link) onLink(s.link);
      }),
    );
  }
  if (m.status === 'active' || m.status === 'invited') items.push(item(m.role === 'admin' ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />, m.role === 'admin' ? 'Make member' : 'Make admin', () => act({ action: 'role', id: m.id, role: m.role === 'admin' ? 'member' : 'admin' }, `${who} is now ${m.role === 'admin' ? 'a member' : 'an admin'}.`)));
  items.push(
    item(<Pencil className="h-4 w-4" />, 'Rename', () => {
      const name = window.prompt(`Name for ${m.email}`, m.name);
      if (name !== null) void act({ action: 'rename', id: m.id, name });
    }),
  );
  if (!you) {
    if (m.status === 'active') items.push(item(<Pause className="h-4 w-4" />, 'Pause account', () => act({ action: 'disable', id: m.id }, `${who} is paused and signed out.`)));
    if (m.status === 'disabled') items.push(item(<Play className="h-4 w-4" />, 'Turn back on', () => act({ action: 'enable', id: m.id }, `${who} can sign in again.`)));
    if (m.status === 'archived') items.push(item(<RotateCcw className="h-4 w-4" />, 'Restore', () => act({ action: 'restore', id: m.id }, `${who} is back on the list.`)));
    if (m.status === 'active' || m.status === 'disabled') items.push(item(<Archive className="h-4 w-4" />, 'Archive', () => act({ action: 'archive', id: m.id }, `${who} is archived.`)));
    if (pending) items.push(item(<X className="h-4 w-4" />, 'Cancel invite', onDelete, true));
    else if (m.status === 'disabled' || m.status === 'archived') items.push(item(<Trash2 className="h-4 w-4" />, 'Delete account…', onDelete, true));
  }

  return (
    <li ref={wrap} className={`relative flex items-center gap-4 px-5 py-4 ${busy ? 'opacity-60' : ''}`} data-testid="person" data-email={m.email}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium ${m.status === 'active' ? 'bg-ink text-paper' : 'bg-line text-ink-2'}`}>{who.trim()[0]?.toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-ink">{m.name || m.email}</span>
          {you && <span className="text-xs text-muted">(you)</span>}
          {m.role === 'admin' && <span className="rounded-full bg-accent/12 px-2 py-0.5 text-xs text-accent">Admin</span>}
          <StatusPill m={m} />
        </div>
        <div className="truncate text-sm text-ink-2">
          {m.name ? `${m.email} · ` : ''}
          {detail(m)}
        </div>
      </div>
      {items.length > 0 && (
        <button onClick={() => setOpen((o) => !o)} className="rounded-full p-2 text-ink-2 hover:bg-white" aria-label={`Actions for ${who}`} aria-expanded={open} data-testid="person-actions">
          <MoreHorizontal className="h-5 w-5" />
        </button>
      )}
      {open && (
        <div className="absolute right-4 top-14 z-40 w-56 rounded-2xl glass p-2 shadow-xl" role="menu">
          {items}
        </div>
      )}
    </li>
  );
}

function StatusPill({ m }: { m: Member }) {
  const look: Record<Status, [string, string]> = {
    invited: ['Invited', 'bg-[#e9eef2] text-[#3f5868]'],
    active: ['Active', 'bg-[#e6efe4] text-[#3d6b3a]'],
    disabled: ['Paused', 'bg-[#f6ead9] text-[#8a5a1f]'],
    archived: ['Archived', 'bg-line text-ink-2'],
  };
  const [label, cls] = look[m.status];
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

function detail(m: Member): string {
  if (m.status === 'invited') return m.inviteSentAt ? `invite sent ${when(m.inviteSentAt)}` : 'invite not sent yet';
  if (m.status === 'active') return m.lastSignInAt ? `last signed in ${when(m.lastSignInAt)}` : 'active';
  if (m.status === 'disabled') return `paused ${m.statusChangedAt ? when(m.statusChangedAt) : ''}`;
  return `archived ${m.statusChangedAt ? when(m.statusChangedAt) : ''}`;
}

function LinkDialog({ who, url, onClose }: { who: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog onClose={onClose} label="Invite link">
      <h2 className="font-serif text-2xl text-ink">Invite link for {who}</h2>
      <p className="mt-2 text-sm text-ink-2">It signs them in once and expires after a while. Send it however you like; if it’s gone stale they can still sign in with Google using their address.</p>
      <input readOnly value={url} onFocus={(e) => e.target.select()} className="mt-4 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm text-ink-2" aria-label="Invite link" data-testid="invite-link" />
      <div className="mt-4 flex gap-2">
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(url).catch(() => {});
            setCopied(true);
          }}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink text-paper"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy link'}
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button onClick={() => navigator.share({ title: 'Our Build', text: 'Here’s your invite to Our Build', url }).catch(() => {})} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-line bg-white text-ink">
            <Share className="h-4 w-4" /> Share
          </button>
        )}
      </div>
    </Dialog>
  );
}

function DeleteDialog({ m, onClose, onConfirm }: { m: Member; onClose: () => void; onConfirm: (confirm: string) => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const pending = m.status === 'invited' && !m.activatedAt;
  const ok = pending || typed.trim().toLowerCase() === m.email;
  return (
    <Dialog onClose={onClose} label={pending ? 'Cancel invite' : 'Delete account'}>
      <h2 className="font-serif text-2xl text-ink">{pending ? `Cancel the invite for ${m.email}?` : `Delete ${m.name || m.email}’s account?`}</h2>
      {pending ? (
        <p className="mt-2 text-sm text-ink-2">The link in their email stops working, and they won’t be able to sign in.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-2">Their login is removed for good. The designs stay; everyone in the household can still open them. To confirm, type their email.</p>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={m.email} aria-label="Type their email to confirm" className="mt-4 h-11 w-full rounded-2xl border border-line bg-white px-4 text-[16px] outline-none focus:border-accent" data-testid="delete-confirm" />
        </>
      )}
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} className="flex h-11 flex-1 items-center justify-center rounded-2xl border border-line bg-white text-ink">
          Keep
        </button>
        <button
          disabled={!ok || working}
          onClick={async () => {
            setWorking(true);
            await onConfirm(typed.trim());
            setWorking(false);
          }}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-accent text-white disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" /> {pending ? 'Cancel invite' : 'Delete for good'}
        </button>
      </div>
    </Dialog>
  );
}

function Dialog({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-paper p-6 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

type Listing = { ok: boolean; body: unknown };

async function listing(): Promise<Listing> {
  const r = await fetch('/api/admin/members', { cache: 'no-store' });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}

const byName = (a: Member, b: Member) => (a.role === b.role ? (a.name || a.email).localeCompare(b.name || b.email) : a.role === 'admin' ? -1 : 1);

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

const VERB: Record<string, string> = {
  invited: 'invited',
  'invite-resent': 'resent the invite to',
  'invite-link': 'made an invite link for',
  'invite-cancelled': 'cancelled the invite for',
  'role-changed': 'changed the role of',
  renamed: 'renamed',
  disabled: 'paused',
  enabled: 'turned back on',
  archived: 'archived',
  restored: 'restored',
  deleted: 'deleted the account of',
};

function describe(e: Event, nameOf: (id: string | null) => string | null | undefined): string {
  const actor = nameOf(e.actorId) ?? 'Someone';
  // Deleted people keep their email in the log; everyone else shows by name.
  const who = (e.kind !== 'deleted' && nameOf(e.memberId)) || e.email;
  if (e.kind === 'joined') return `${who} joined${e.detail.via ? ` (${e.detail.via})` : ''}`;
  if (e.kind === 'signed-in') return `${who} signed in${e.detail.via ? ` with ${e.detail.via}` : ''}`;
  if (e.kind === 'refused') return `${who} tried to sign in (${e.detail.why === 'not-invited' ? 'not on the list' : e.detail.why})`;
  if (e.kind === 'role-changed') return `${actor} made ${who} ${e.detail.to === 'admin' ? 'an admin' : 'a member'}`;
  return `${actor} ${VERB[e.kind] ?? e.kind} ${who}`;
}
