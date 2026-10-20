import { describe, expect, it } from 'vitest';
import type { DesignEvent, Selection } from '@/core/ai/types';
import { type Project, parseProject } from '@/core/model/schema';
import { resolve } from '@/core/resolve';
import { runMockTurn } from '../mock';

const blank = () => parseProject({ v: 1, name: 'New design', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });

async function turn(project: Project, request: string, mode: 'create' | 'edit' = 'edit', selection: Selection | null = null) {
  const events: DesignEvent[] = [];
  await runMockTurn({ project, request, source: 'typed', mode, selection }, (e) => events.push(e), { delay: 0 });
  const done = events.find((e) => e.type === 'done') as Extract<DesignEvent, { type: 'done' }>;
  return { project: parseProject(done.project), reply: done.reply, events };
}

describe('demo assistant', () => {
  it('handles the headline requests', async () => {
    let { project, reply } = await turn(blank(), 'A white two-story farmhouse with a metal roof and a big kitchen with an island', 'create');
    // A kitchen island is not an island site, and the brief is kept.
    expect(project.site.setting).not.toBe('island');
    expect(project.brief).toMatch(/farmhouse/);
    expect(reply).toMatch(/4 bedrooms/);
    expect(project.levels).toHaveLength(2);

    ({ project } = await turn(project, 'Add a third story'));
    expect(project.levels.map((l) => l.name)).toContain('Third Floor');
    expect(project.levels[2].rooms.filter((r) => r.type === 'bedroom').every((r) => /\d$/.test(r.name))).toBe(true);

    ({ project } = await turn(project, 'Move the sink to the island'));
    const kinds = project.levels[0].fixtures.map((f) => f.kind);
    expect(kinds).toContain('island_sink');
    expect(kinds).not.toContain('sink');

    const window = resolve(project).levels[0].openings.find((o) => o.type === 'window' && o.auto)!;
    const bigger = await turn(project, 'Make this bigger', 'edit', { kind: 'opening', id: window.id, label: 'Window in Family' });
    expect(bigger.reply).toMatch(/bigger/);
    expect(bigger.reply).not.toMatch(/aw_|_r\d/);
    // Pinning the automatic window gave it a new id, and the turn says which.
    const renamed = bigger.events.find((e) => e.type === 'project' && e.renamed?.[window.id]) as Extract<DesignEvent, { type: 'project' }>;
    const fresh = renamed.renamed![window.id];
    const after = resolve(bigger.project).levels[0].openings.find((o) => o.id === fresh)!;
    expect(after.unitWidth).toBeCloseTo(window.unitWidth + 1);

    ({ project } = await turn(bigger.project, 'Remove the third floor'));
    const firstFloor = resolve(project).grossArea / 2;
    ({ project } = await turn(project, 'Remove the second story and expand the first floor by 1,000 square feet'));
    expect(project.levels).toHaveLength(1);
    // The upstairs rooms move down into a wing of about 1,000 sf.
    expect(resolve(project).grossArea).toBeGreaterThan(firstFloor + 850);
  });

  it('puts a cottage on an island when asked', async () => {
    const { project } = await turn(blank(), 'A stone cottage on a little island with two bedrooms', 'create');
    expect(project.site.setting).toBe('island');
  });
});
