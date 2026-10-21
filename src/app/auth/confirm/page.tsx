import Link from 'next/link';
import { AuthCard } from '@/ui/AuthCard';

export const metadata = { title: 'Sign in · Our Build', referrer: 'no-referrer' as const };

/**
 * Where email links land. Signing in takes a tap on the button (a POST), so the link scanners some
 * mail services run can open the page without using up the one-time token.
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : '');
  const tokenHash = one('token_hash');
  return (
    <AuthCard>
      {tokenHash ? (
        <form method="post" action="/api/auth/confirm">
          <h1 className="font-serif text-3xl text-ink">Welcome in</h1>
          <p className="mt-2 text-ink-2">One tap and you’re signed in.</p>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={one('type') || 'magiclink'} />
          <input type="hidden" name="next" value={one('next') || '/'} />
          <button autoFocus className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-ink text-paper transition hover:bg-ink-2" data-testid="confirm-sign-in">
            Sign in to Our Build
          </button>
        </form>
      ) : (
        <div>
          <h1 className="font-serif text-2xl text-ink">That link is missing a piece</h1>
          <p className="mt-2 text-ink-2">Some email apps cut long links short. Ask for a fresh one and tap the button in the email.</p>
          <Link href="/login" className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-ink text-paper">
            Back to sign in
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
