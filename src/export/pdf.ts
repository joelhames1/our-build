import type { Resolved } from '@/core/resolve';

/** Filled in with the drawing engine. */
export async function exportPdf(_res: Resolved, _opts: { paper: 'tabloid' | 'archd'; snapshot: string | null }): Promise<Blob> {
  throw new Error('PDF export is not ready yet');
}
