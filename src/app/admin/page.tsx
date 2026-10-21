'use client';

import { cloudEnabled } from '@/lib/supabase/client';
import { AuthCard } from '@/ui/AuthCard';
import { AuthGate } from '@/ui/AuthGate';
import { People } from '@/ui/admin/People';

export default function AdminPage() {
  if (!cloudEnabled())
    return (
      <AuthCard>
        <h1 className="font-serif text-2xl text-ink">No accounts here</h1>
        <p className="mt-2 text-ink-2">This copy of Our Build saves designs in the browser and has no sign-in, so there are no people to manage. Accounts come with Supabase; SETUP.md walks through it.</p>
      </AuthCard>
    );
  return (
    <AuthGate admin>
      <People />
    </AuthGate>
  );
}
