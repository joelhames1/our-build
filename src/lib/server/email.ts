import 'server-only';
import type { Mailer } from './members';

/**
 * Our Build's email, sent through Resend's API from EMAIL_FROM (an address on a domain verified
 * there). Supabase's own mailer is deliberately left unconfigured: every email comes from here.
 */
export const RESEND = 'https://api.resend.com/emails';

export const emailEnabled = () => !!process.env.RESEND_API_KEY;

export const resendMailer: Mailer = {
  async send({ to, subject, text, html }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set, so no email can go out.');
    const from = process.env.EMAIL_FROM || 'Our Build <onboarding@resend.dev>';
    const res = await fetch(RESEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (res.ok) return;
    let said = '';
    try {
      said = ((await res.json()) as { message?: string }).message ?? '';
    } catch {
      // No reason given.
    }
    throw new Error(`Resend refused the email (${res.status})${said ? `: ${said}` : ''}`);
  },
};
