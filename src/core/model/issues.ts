export type Severity = 'error' | 'warning' | 'tip';

/** A guardrail finding or a hard-invariant violation, phrased for a non-architect. */
export interface Issue {
  rule: string;
  severity: Severity;
  message: string;
  level?: string;
  /** Elements involved; the first is the one to highlight. */
  ids: string[];
  /** Ready-made ops that would fix it (JSON objects matching the Op schema). */
  fix?: Record<string, unknown>[];
}

export const issueKey = (i: Issue) => `${i.rule}:${i.ids.join(',')}`;
