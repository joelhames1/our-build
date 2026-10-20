import type { DesignRequest } from './types';

/** The first description of a new design becomes its brief, which rides along with every later request. */
export function withBrief(req: DesignRequest) {
  if (req.mode !== 'create' || req.project.brief.trim()) return req.project;
  return { ...req.project, brief: req.request.trim().slice(0, 1200) };
}
