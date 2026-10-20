import type { Project } from '@/core/model/schema';
import { resolve } from '@/core/resolve';
import { sheetsPdf } from '@/drawings/render/pdf';
import { buildSheets, type Paper } from '@/drawings/sheets';

/** Builds the plan set off the main thread so the studio stays responsive. */
self.onmessage = (e: MessageEvent<{ project: Project; paper: Paper; snapshot: { href: string; w: number; h: number } | null }>) => {
  try {
    const { project, paper, snapshot } = e.data;
    const res = resolve(project);
    const buf = sheetsPdf(buildSheets(res, { paper, snapshot }), { title: `${project.name} plan set` }).output('arraybuffer');
    (self as unknown as Worker).postMessage({ ok: true, buf }, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(err) });
  }
};
