import { createHash } from 'node:crypto';
import { type Admission, type AuthAdmin, HttpError, type Mailer, type MemberStore, admit, confirmLink, looksLikeEmail, mayGetLink, normalizeEmail, signInEmail } from './members';

/** Counts a request against a limit; true while it's still under. */
export type Hit = (key: string, limit: number, windowSeconds: number) => Promise<boolean>;

export interface SignInDeps {
  store: MemberStore;
  auth: AuthAdmin;
  mail: Mailer;
  hit: Hit;
  admins: string[];
}

/**
 * "Email me a sign-in link". Only people on the list get an email; everyone gets the same answer,
 * so the form can't be used to find out who's invited. Limited per address and per network.
 */
export async function requestLink(d: SignInDeps, input: { email: string; ip: string; origin: string; next?: string }): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!looksLikeEmail(email)) throw new HttpError(400, 'That doesn’t look like an email address.');
  if (!(await d.hit(`link-ip:${input.ip}`, 20, 3600))) throw new HttpError(429, 'Lots of sign-in links from here lately. Try again in an hour.');
  const key = createHash('sha256').update(email).digest('hex').slice(0, 32);
  if (!(await d.hit(`link-email:${key}`, 5, 3600))) throw new HttpError(429, 'Several links have gone to that address already. Check your inbox (and spam), or try again in an hour.');
  const m = await d.store.byEmail(email);
  if (!mayGetLink(m, email, d.admins)) return;
  const { tokenHash, userId } = await d.auth.signInToken(email, m?.name ?? '');
  if (m && !m.userId) await d.store.update(m.id, { userId });
  await d.mail.send({ to: email, ...signInEmail({ link: confirmLink(input.origin, tokenHash, input.next), origin: input.origin }) });
}

/**
 * After Supabase has made a session (Google callback or an email link): run the gate, and if the
 * person isn't let in, end the session and remove a login nobody invited.
 */
export async function finishSignIn(d: Pick<SignInDeps, 'store' | 'auth' | 'admins'>, session: { signOut: () => Promise<unknown> }, user: { id: string; email?: string | null }, via: string): Promise<Admission> {
  const result = await admit(d.store, { userId: user.id, email: user.email, via }, { admins: d.admins });
  if (result.ok) return result;
  try {
    await session.signOut();
  } catch {
    // The cookies go either way.
  }
  if (result.stray) await d.auth.deleteUser(user.id).catch((e) => console.error('could not remove stray login', e));
  return result;
}
