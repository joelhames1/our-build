/** Access token for API calls when cloud sign-in is configured (filled in by the Supabase client). */
export async function getAuthToken(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const { supabase } = await import('./client');
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}
