import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

/** Accounts are on when the project URL, the public key and the server key are all set. */
export const accountsEnabled = () => !!(URL && ANON && SERVICE);

/**
 * The signed-in person's client for this request, reading and writing the session cookies.
 * Make a new one per request. In a server component the cookies can't be written, which is fine:
 * the proxy has already refreshed them.
 */
export async function serverSupabase(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(URL!, ANON!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Rendering a server component: the proxy keeps the cookies fresh instead.
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;

/** The service-role client: bypasses row level security. Server only, never sent to a browser. */
export function adminSupabase(): SupabaseClient {
  if (!SERVICE) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  admin ??= createClient(URL!, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
