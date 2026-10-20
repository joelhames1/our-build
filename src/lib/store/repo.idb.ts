import { type IDBPDatabase, openDB } from 'idb';
import type { Project } from '@/core/model/schema';
import { type ChatMessage, type ProjectBundle, type ProjectMeta, type ProjectRepo, type Version, now, uid } from './types';

/** Browser-only storage (IndexedDB). Used when cloud sync isn't configured. */
export class LocalRepo implements ProjectRepo {
  kind = 'local' as const;
  private db: Promise<IDBPDatabase>;

  constructor() {
    this.db = openDB('our-build', 1, {
      upgrade(db) {
        db.createObjectStore('projects', { keyPath: 'id' });
        const v = db.createObjectStore('versions', { keyPath: 'id' });
        v.createIndex('project', 'projectId');
        const c = db.createObjectStore('chat', { keyPath: 'id' });
        c.createIndex('project', 'projectId');
      },
    });
  }

  async list(): Promise<ProjectMeta[]> {
    const all = (await (await this.db).getAll('projects')) as ProjectMeta[];
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(name: string, model: Project): Promise<ProjectBundle> {
    const db = await this.db;
    const id = uid();
    const t = now();
    const version: Version = { id: uid(), projectId: id, parentId: null, createdAt: t, model, summary: 'Started', source: 'template', changes: [] };
    const meta: ProjectMeta = { id, name, createdAt: t, updatedAt: t, headVersionId: version.id, thumbnail: null };
    const tx = db.transaction(['projects', 'versions'], 'readwrite');
    await tx.objectStore('projects').put(meta);
    await tx.objectStore('versions').put(version);
    await tx.done;
    return { meta, versions: [version], chat: [] };
  }

  async get(id: string): Promise<ProjectBundle | null> {
    const db = await this.db;
    const meta = (await db.get('projects', id)) as ProjectMeta | undefined;
    if (!meta) return null;
    const versions = ((await db.getAllFromIndex('versions', 'project', id)) as Version[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const chat = ((await db.getAllFromIndex('chat', 'project', id)) as ChatMessage[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { meta, versions, chat };
  }

  async addVersion(v: Omit<Version, 'id' | 'createdAt'>): Promise<Version> {
    const version: Version = { ...v, id: uid(), createdAt: now() };
    await (await this.db).put('versions', version);
    return version;
  }

  async addChat(m: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
    const msg: ChatMessage = { ...m, id: uid(), createdAt: now() };
    await (await this.db).put('chat', msg);
    return msg;
  }

  async update(id: string, patch: Partial<Omit<ProjectMeta, 'id'>>): Promise<void> {
    const db = await this.db;
    const meta = (await db.get('projects', id)) as ProjectMeta | undefined;
    if (!meta) return;
    await db.put('projects', { ...meta, ...patch, updatedAt: now() });
  }

  async remove(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['projects', 'versions', 'chat'], 'readwrite');
    await tx.objectStore('projects').delete(id);
    for (const k of await tx.objectStore('versions').index('project').getAllKeys(id)) await tx.objectStore('versions').delete(k);
    for (const k of await tx.objectStore('chat').index('project').getAllKeys(id)) await tx.objectStore('chat').delete(k);
    await tx.done;
  }
}
