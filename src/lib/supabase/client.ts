import { type SupabaseClient, createClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export const cloudEnabled = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
