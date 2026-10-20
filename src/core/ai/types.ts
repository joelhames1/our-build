import type { Issue } from '../model/issues';
import type { Project } from '../model/schema';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** For assistant turns: what changed, one line. */
  changes?: string;
}

/** What the user has tapped (or where they stand in walk mode). */
export interface Selection {
  kind: 'room' | 'opening' | 'fixture' | 'stairs' | 'wall' | 'roof' | 'level' | 'standing';
  id: string;
  label: string;
  detail?: string;
}

export interface DesignRequest {
  project: Project;
  request: string;
  source: 'typed' | 'voice' | 'suggestion';
  mode: 'create' | 'edit';
  selection?: Selection | null;
  history?: ChatTurn[];
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type DesignEvent =
  | { type: 'status'; text: string }
  | { type: 'project'; project: Project; log: string[] }
  | { type: 'text'; text: string }
  | { type: 'done'; project: Project; reply: string; changes: string[]; issues: Issue[]; usage?: Usage; engine: 'claude' | 'mock' }
  | { type: 'error'; message: string };
