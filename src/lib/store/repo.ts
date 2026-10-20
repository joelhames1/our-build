import { LocalRepo } from './repo.idb';
import type { ProjectRepo } from './types';

let repo: ProjectRepo | null = null;

/** The active project store: Supabase when configured, the browser's IndexedDB otherwise. */
export async function getRepo(): Promise<ProjectRepo> {
  if (repo) return repo;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const { CloudRepo } = await import('./repo.supabase');
    repo = new CloudRepo();
  } else repo = new LocalRepo();
  return repo;
}
