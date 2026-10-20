'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cloudEnabled, supabase } from '@/lib/supabase/client';

/** Who's signed in (cloud mode), or a note that designs live in this browser (local mode). */
export function AccountBadge() {
  const router = useRouter();
  const cloud = cloudEnabled();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!cloud) return;
    supabase()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null));
  }, [cloud]);
  if (!cloud) return <span className="rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-muted">Saved in this browser</span>;
  return (
    <div className="flex items-center gap-2 rounded-full border border-line bg-white/60 py-1 pl-3 pr-1 text-xs text-ink-2">
      <span className="max-w-[40vw] truncate">{email ?? ''}</span>
      <button
        onClick={async () => {
          await supabase().auth.signOut();
          router.replace('/login');
        }}
        className="rounded-full p-1.5 hover:bg-white"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
