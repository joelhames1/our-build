'use client';

import { LogOut, MonitorSmartphone, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cloudEnabled } from '@/lib/supabase/client';
import { signOut, useMe } from './AuthGate';

/**
 * Who's signed in, with sign-out and (for admins) the people page. `compact` is the round button
 * for the studio's top bar. In this-browser-only mode it's a quiet note instead.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!cloudEnabled()) return compact ? null : <span className="rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-muted">Saved in this browser</span>;
  if (!me) return null;
  const label = me.name || me.email;
  const initial = label.trim()[0]?.toUpperCase() ?? '?';

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={compact ? 'flex h-10 w-10 items-center justify-center rounded-xl text-ink-2 transition hover:bg-white/70' : 'flex items-center gap-2 rounded-full border border-line bg-white/60 py-1 pl-1 pr-3 text-sm text-ink-2 transition hover:bg-white'}
        aria-label="Account"
        aria-expanded={open}
        data-testid="account-menu"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-medium text-paper">{initial}</span>
        {!compact && <span className="max-w-[40vw] truncate">{label}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl glass p-2 text-sm shadow-xl" role="menu">
          <div className="px-3 py-2">
            {me.name && <div className="font-medium text-ink">{me.name}</div>}
            <div className="truncate text-ink-2">{me.email}</div>
            {me.role === 'admin' && <div className="mt-1 text-xs text-accent">Admin</div>}
          </div>
          {me.role === 'admin' && (
            <Link href="/admin" className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-ink hover:bg-white/70" role="menuitem" data-testid="admin-link">
              <Users className="h-4 w-4 text-ink-2" /> People
            </Link>
          )}
          <button onClick={() => signOut()} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-ink hover:bg-white/70" role="menuitem" data-testid="sign-out">
            <LogOut className="h-4 w-4 text-ink-2" /> Sign out
          </button>
          <button onClick={() => signOut({ everywhere: true })} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-ink-2 hover:bg-white/70" role="menuitem">
            <MonitorSmartphone className="h-4 w-4" /> Sign out on every device
          </button>
        </div>
      )}
    </div>
  );
}
