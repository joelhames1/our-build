'use client';

import { create } from 'zustand';
import type { ChatTurn, Selection } from '@/core/ai/types';
import type { Issue } from '@/core/model/issues';
import { type Project, parseProject } from '@/core/model/schema';
import { applyOps } from '@/core/ops/apply';
import { resolve } from '@/core/resolve';
import { checkRules } from '@/core/rules';
import { streamDesign } from '@/lib/ai/client';
import type { RenderMode } from '@/viewer/materials';
import type { ViewMode } from '@/viewer/Scene';
import { getAuthToken } from '@/lib/supabase/token';
import { getRepo } from './repo';
import type { ChatMessage, ProjectMeta, Version } from './types';

export const blankProject = (name = 'Untitled'): Project =>
  parseProject({ v: 1, name, site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });

export const isEmpty = (p: Project | null) => !p || p.levels.every((l) => l.rooms.length === 0);

interface StudioState {
  status: 'idle' | 'loading' | 'ready' | 'missing';
  meta: ProjectMeta | null;
  versions: Version[];
  headId: string | null;
  project: Project | null;
  chat: ChatMessage[];
  selection: Selection | null;
  view: ViewMode;
  level: number;
  render: RenderMode;
  hour: number;
  busy: boolean;
  statuses: string[];
  liveReply: string;
  issues: Issue[];
  engine: 'claude' | 'mock' | null;
  error: string | null;
  panel: 'none' | 'chat' | 'details';
  detailsTab: 'overview' | 'notes' | 'history';
  /** Called after a turn finishes so the page can store a fresh thumbnail. */
  onSaved?: () => void;

  load(id: string): Promise<void>;
  send(text: string, source?: 'typed' | 'voice' | 'suggestion'): Promise<void>;
  stop(): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  restore(versionId: string): Promise<void>;
  quick(ops: unknown[], label: string): Promise<boolean>;
  rename(name: string): Promise<void>;
  setSelection(s: Selection | null): void;
  set(patch: Partial<Pick<StudioState, 'view' | 'level' | 'render' | 'hour' | 'panel' | 'detailsTab' | 'error' | 'onSaved'>>): void;
}

let abort: AbortController | null = null;

const headOf = (versions: Version[], headId: string | null) => versions.find((v) => v.id === headId) ?? versions[versions.length - 1] ?? null;

function computeIssues(p: Project | null): Issue[] {
  if (!p || isEmpty(p)) return [];
  const res = resolve(p);
  return [...res.issues, ...checkRules(res)];
}

export const useStudio = create<StudioState>((set, get) => ({
  status: 'idle',
  meta: null,
  versions: [],
  headId: null,
  project: null,
  chat: [],
  selection: null,
  view: 'exterior',
  level: 0,
  render: 'materials',
  hour: 15.5,
  busy: false,
  statuses: [],
  liveReply: '',
  issues: [],
  engine: null,
  error: null,
  panel: 'none',
  detailsTab: 'overview',

  async load(id) {
    set({ status: 'loading', error: null });
    const repo = await getRepo();
    const b = await repo.get(id);
    if (!b) return set({ status: 'missing' });
    const head = headOf(b.versions, b.meta.headVersionId);
    const project = head ? parseProject(head.model) : blankProject(b.meta.name);
    set({ status: 'ready', meta: b.meta, versions: b.versions, headId: head?.id ?? null, project, chat: b.chat, selection: null, issues: computeIssues(project), level: 0 });
  },

  async send(text, source = 'typed') {
    const s = get();
    if (!s.project || !s.meta || s.busy) return;
    const repo = await getRepo();
    const projectId = s.meta.id;
    const userMsg = await repo.addChat({ projectId, role: 'user', text });
    const history: ChatTurn[] = s.chat.slice(-10).map((m) => ({ role: m.role, text: m.text, changes: m.changes }));
    const mode = isEmpty(s.project) ? 'create' : 'edit';
    set({ chat: [...s.chat, userMsg], busy: true, statuses: [mode === 'create' ? 'Reading your description…' : 'Thinking it through…'], liveReply: '', error: null });
    abort = new AbortController();
    const start = s.project;
    let final: { project: Project; reply: string; changes: string[]; issues: Issue[] } | null = null;
    let failed: string | null = null;
    try {
      await streamDesign(
        { project: start, request: text, source, mode, selection: s.selection, history },
        (e) => {
          if (e.type === 'status') set((st) => ({ statuses: [...st.statuses.slice(-5), e.text] }));
          else if (e.type === 'project') {
            // An edited automatic window gets a new id; keep talking about the same one.
            const sel = get().selection;
            const to = sel && e.renamed?.[sel.id];
            set({ project: parseProject(e.project), ...(sel && to ? { selection: { ...sel, id: to } } : {}) });
          }
          else if (e.type === 'text') set((st) => ({ liveReply: st.liveReply + e.text }));
          else if (e.type === 'done') {
            final = { project: parseProject(e.project), reply: e.reply, changes: e.changes, issues: e.issues };
            set({ engine: e.engine });
          } else if (e.type === 'error') failed = e.message;
        },
        { signal: abort.signal, token: await getAuthToken() },
      );
    } catch (err) {
      failed = (err as Error)?.name === 'AbortError' ? 'Stopped. Nothing was changed.' : 'Lost the connection to the design assistant. Try again?';
    }
    abort = null;
    const done = final as { project: Project; reply: string; changes: string[]; issues: Issue[] } | null;
    if (done && done.changes.length) {
      const version = await repo.addVersion({ projectId, parentId: get().headId, model: done.project, summary: firstSentence(done.reply) || done.changes[0] || 'Updated', source: 'ai', changes: done.changes });
      const reply = await repo.addChat({ projectId, role: 'assistant', text: done.reply, changes: done.changes.join(' '), versionId: version.id });
      const res = resolve(done.project);
      await repo.update(projectId, { name: done.project.name, headVersionId: version.id, sqft: Math.round(res.grossArea), levels: done.project.levels.length });
      set((st) => ({
        project: done.project,
        versions: [...st.versions, version],
        headId: version.id,
        chat: [...st.chat, reply],
        issues: done.issues,
        busy: false,
        statuses: [],
        liveReply: '',
        meta: st.meta ? { ...st.meta, name: done.project.name, headVersionId: version.id } : st.meta,
        level: Math.min(st.level, done.project.levels.length - 1),
      }));
      get().onSaved?.();
      return;
    }
    // Nothing changed (a question, a refusal, or an error): put the head design back.
    const head = headOf(get().versions, get().headId);
    const msgText = failed ?? (done?.reply || "I didn't change anything.");
    const reply = await repo.addChat({ projectId, role: 'assistant', text: msgText });
    set((st) => ({ project: head ? parseProject(head.model) : st.project, chat: [...st.chat, reply], busy: false, statuses: [], liveReply: '', error: failed }));
  },

  stop() {
    abort?.abort();
  },

  async undo() {
    const { versions, headId, meta } = get();
    const i = versions.findIndex((v) => v.id === headId);
    if (i <= 0 || !meta) return;
    await moveHead(versions[i - 1], set, get);
  },

  async redo() {
    const { versions, headId } = get();
    const i = versions.findIndex((v) => v.id === headId);
    if (i < 0 || i >= versions.length - 1) return;
    await moveHead(versions[i + 1], set, get);
  },

  async restore(versionId) {
    const v = get().versions.find((x) => x.id === versionId);
    if (v) await moveHead(v, set, get);
  },

  async quick(ops, label) {
    const s = get();
    if (!s.project || !s.meta || s.busy) return false;
    const r = applyOps(s.project, ops);
    if (!r.ok) {
      set({ error: r.error?.message ?? "That change didn't fit." });
      return false;
    }
    const repo = await getRepo();
    const version = await repo.addVersion({ projectId: s.meta.id, parentId: s.headId, model: r.project, summary: label, source: 'user', changes: r.log });
    const res = resolve(r.project);
    await repo.update(s.meta.id, { name: r.project.name, headVersionId: version.id, sqft: Math.round(res.grossArea), levels: r.project.levels.length });
    set((st) => ({ project: r.project, versions: [...st.versions, version], headId: version.id, issues: r.issues, error: null, meta: st.meta ? { ...st.meta, name: r.project.name } : st.meta }));
    get().onSaved?.();
    return true;
  },

  async rename(name) {
    const s = get();
    if (!s.project || !name.trim()) return;
    await s.quick([{ op: 'set_name', name: name.trim() }], `Renamed to ${name.trim()}`);
  },

  setSelection(selection) {
    set({ selection });
  },

  set(patch) {
    set(patch);
  },
}));

async function moveHead(v: Version, set: (p: Partial<StudioState>) => void, get: () => StudioState) {
  const meta = get().meta;
  if (!meta) return;
  const project = parseProject(v.model);
  set({ headId: v.id, project, issues: computeIssues(project), selection: null, level: Math.min(get().level, project.levels.length - 1) });
  const repo = await getRepo();
  await repo.update(meta.id, { headVersionId: v.id, name: project.name });
  get().onSaved?.();
}

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim().slice(0, 140);
}
