import type { Project } from '@/core/model/schema';
import { supabase } from '@/lib/supabase/client';
import type { ChatMessage, ProjectBundle, ProjectMeta, ProjectRepo, Version } from './types';

interface ProjectRow {
  id: string;
  name: string;
  head_version_id: string | null;
  thumbnail: string | null;
  sqft: number | null;
  levels: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
interface VersionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  model: Project;
  summary: string;
  source: Version['source'];
  changes: string[];
  created_at: string;
}
interface ChatRow {
  id: string;
  project_id: string;
  role: 'user' | 'assistant';
  text: string;
  changes: string | null;
  version_id: string | null;
  created_at: string;
}

const meta = (r: ProjectRow): ProjectMeta => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at, headVersionId: r.head_version_id, thumbnail: r.thumbnail, sqft: r.sqft ?? undefined, levels: r.levels ?? undefined, createdBy: r.created_by });
const version = (r: VersionRow): Version => ({ id: r.id, projectId: r.project_id, parentId: r.parent_id, createdAt: r.created_at, model: r.model, summary: r.summary, source: r.source, changes: r.changes ?? [] });
const chat = (r: ChatRow): ChatMessage => ({ id: r.id, projectId: r.project_id, role: r.role, text: r.text, changes: r.changes ?? undefined, versionId: r.version_id, createdAt: r.created_at });

function check(res: { data: unknown; error: { message: string } | null }): unknown {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Projects shared by the household in Supabase (Postgres + row level security). */
export class CloudRepo implements ProjectRepo {
  kind = 'cloud' as const;
  private db = supabase();

  async list(): Promise<ProjectMeta[]> {
    const rows = check(await this.db.from('projects').select('*').order('updated_at', { ascending: false }));
    return (rows as ProjectRow[]).map(meta);
  }

  async create(name: string, model: Project): Promise<ProjectBundle> {
    const p = check(await this.db.from('projects').insert({ name }).select('*').single()) as ProjectRow;
    const v = check(await this.db.from('project_versions').insert({ project_id: p.id, model, summary: 'Started', source: 'template', changes: [] }).select('*').single()) as VersionRow;
    const updated = check(await this.db.from('projects').update({ head_version_id: v.id }).eq('id', p.id).select('*').single()) as ProjectRow;
    return { meta: meta(updated), versions: [version(v)], chat: [] };
  }

  async get(id: string): Promise<ProjectBundle | null> {
    const p = await this.db.from('projects').select('*').eq('id', id).maybeSingle();
    if (p.error) throw new Error(p.error.message);
    if (!p.data) return null;
    const [vs, cs] = await Promise.all([this.db.from('project_versions').select('*').eq('project_id', id).order('created_at'), this.db.from('chat_messages').select('*').eq('project_id', id).order('created_at')]);
    return { meta: meta(p.data as ProjectRow), versions: (check(vs) as VersionRow[]).map(version), chat: (check(cs) as ChatRow[]).map(chat) };
  }

  async addVersion(v: Omit<Version, 'id' | 'createdAt'>): Promise<Version> {
    const row = check(await this.db.from('project_versions').insert({ project_id: v.projectId, parent_id: v.parentId, model: v.model, summary: v.summary, source: v.source, changes: v.changes }).select('*').single());
    return version(row as VersionRow);
  }

  async addChat(m: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
    const row = check(await this.db.from('chat_messages').insert({ project_id: m.projectId, role: m.role, text: m.text, changes: m.changes ?? null, version_id: m.versionId ?? null }).select('*').single());
    return chat(row as ChatRow);
  }

  async update(id: string, patch: Partial<Omit<ProjectMeta, 'id'>>): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.headVersionId !== undefined) row.head_version_id = patch.headVersionId;
    if (patch.thumbnail !== undefined) row.thumbnail = patch.thumbnail;
    if (patch.sqft !== undefined) row.sqft = patch.sqft;
    if (patch.levels !== undefined) row.levels = patch.levels;
    if (!Object.keys(row).length) return;
    check(await this.db.from('projects').update(row).eq('id', id).select('id'));
  }

  async remove(id: string): Promise<void> {
    check(await this.db.from('projects').delete().eq('id', id).select('id'));
  }
}
