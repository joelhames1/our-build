'use client';

/** Shows who's signed in (cloud mode) or that designs live in this browser (local mode). */
export function AccountBadge() {
  const cloud = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!cloud) return <span className="rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-muted">Saved in this browser</span>;
  return null;
}
