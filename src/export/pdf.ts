import type { Resolved } from '@/core/resolve';
import { sheetsPdf } from '@/drawings/render/pdf';
import { buildSheets, type Paper } from '@/drawings/sheets';

type Snapshot = { href: string; w: number; h: number } | null;

/** The plan set as a PDF: cover (with the current 3D view), plans, roof, elevations, sections, schedules. */
export async function exportPdf(res: Resolved, opts: { paper: Paper; snapshot: string | null }): Promise<Blob> {
  const snapshot = opts.snapshot ? await imageSize(opts.snapshot) : null;
  try {
    return await inWorker(res, opts.paper, snapshot);
  } catch (e) {
    console.warn('PDF worker unavailable, building on the main thread', e);
    return sheetsPdf(buildSheets(res, { paper: opts.paper, snapshot }), { title: `${res.project.name} plan set` }).output('blob');
  }
}

function inWorker(res: Resolved, paper: Paper, snapshot: Snapshot): Promise<Blob> {
  return new Promise((done, fail) => {
    if (typeof Worker === 'undefined') return fail(new Error('no workers'));
    const w = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ ok: true; buf: ArrayBuffer } | { ok: false; error: string }>) => {
      w.terminate();
      if (e.data.ok) done(new Blob([e.data.buf], { type: 'application/pdf' }));
      else fail(new Error(e.data.error));
    };
    w.onerror = (e) => {
      w.terminate();
      fail(new Error(e.message));
    };
    w.postMessage({ project: res.project, paper, snapshot });
  });
}

function imageSize(href: string): Promise<Snapshot> {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done({ href, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = href;
  });
}
