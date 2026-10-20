import type { Project } from '@/core/model/schema';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  headVersionId: string | null;
  /** Small JPEG data URL. */
  thumbnail?: string | null;
  sqft?: number;
  levels?: number;
  createdBy?: string | null;
}

export interface Version {
  id: string;
  projectId: string;
  parentId: string | null;
  createdAt: string;
  model: Project;
  summary: string;
  source: 'ai' | 'user' | 'template' | 'restore';
  changes: string[];
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  text: string;
  changes?: string;
  versionId?: string | null;
  createdAt: string;
}

export interface ProjectBundle {
  meta: ProjectMeta;
  versions: Version[];
  chat: ChatMessage[];
}

/** Storage for projects, their version history and conversation. */
export interface ProjectRepo {
  kind: 'local' | 'cloud';
  list(): Promise<ProjectMeta[]>;
  create(name: string, model: Project): Promise<ProjectBundle>;
  get(id: string): Promise<ProjectBundle | null>;
  addVersion(v: Omit<Version, 'id' | 'createdAt'>): Promise<Version>;
  addChat(m: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage>;
  update(id: string, patch: Partial<Omit<ProjectMeta, 'id'>>): Promise<void>;
  remove(id: string): Promise<void>;
}

export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
export const now = () => new Date().toISOString();
