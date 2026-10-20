import { describe, expect, it } from 'vitest';
import { applyOps } from '../ops/apply';
import { parseProject, type Project } from '../model/schema';
import { resolve } from '../resolve';
import { TEMPLATE_IDS } from '../templates';
import { sampleCottage } from '../samples';

const blank = () => parseProject({ v: 1, name: 'T', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
const ok = (p: Project, ops: unknown[]) => {
  const r = applyOps(p, ops);
  if (!r.ok) throw new Error(r.error?.message);
  return r;
};
const area = (p: Project, li = 0) => resolve(p).levels[li].rooms.size;

describe('templates', () => {
  for (const t of TEMPLATE_IDS) {
    it(`${t} builds with no errors or warnings`, () => {
      const r = ok(blank(), [{ op: 'use_template', template: t }]);
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(r.issues.filter((i) => i.severity === 'warning').map((i) => i.message)).toEqual([]);
    });
  }
  it('orients to the requested front', () => {
    const r = ok(blank(), [{ op: 'use_template', template: 'farmhouse', params: { front: 'E' } }]);
    expect(r.project.site.front).toBe('E');
    const doors = r.project.levels[0].openings.filter((o) => o.id.endsWith('front'));
    expect(doors[0]?.side).toBe('E');
  });
});

describe('ops', () => {
  it('rejects a whole batch atomically when one op fails', () => {
    const p = sampleCottage();
    const r = applyOps(p, [
      { op: 'set_name', name: 'Changed' },
      { op: 'update_room', room: 'nope', name: 'x' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error?.index).toBe(1);
    expect(r.project.name).toBe(p.name);
  });

  it('adds a third story with stairs and bedrooms', () => {
    const base = ok(blank(), [{ op: 'use_template', template: 'farmhouse' }]).project;
    const r = ok(base, [{ op: 'add_level', name: 'Third Floor' }]);
    expect(r.project.levels).toHaveLength(3);
    expect(r.project.levels[1].stairs.length).toBe(1);
    expect(r.project.levels[2].rooms.length).toBeGreaterThan(1);
    expect(r.issues.filter((i) => i.rule === 'reach')).toEqual([]);
  });

  it('removes the second story and grows the first by 1000 sf', () => {
    const base = ok(blank(), [{ op: 'use_template', template: 'farmhouse' }]).project;
    const before = resolve(base).levels[0].footprint;
    const r = ok(base, [{ op: 'remove_level', level: 'L2' }, { op: 'grow_level', level: 'L1', addArea: 1000 }]);
    expect(r.project.levels).toHaveLength(1);
    const res = resolve(r.project);
    const grown = res.levels[0].footprint;
    const a = (m: typeof grown) => m.reduce((s, p) => s + Math.abs(p[0].reduce((t, q, i) => t + q[0] * p[0][(i + 1) % p[0].length][1] - p[0][(i + 1) % p[0].length][0] * q[1], 0) / 2), 0);
    expect(a(grown) - a(before)).toBeGreaterThan(900);
    expect(r.project.levels[0].stairs).toEqual([]);
  });

  it('resize_room take: the neighbor gives up space', () => {
    const p = sampleCottage();
    const r = ok(p, [{ op: 'resize_room', room: 'r4', side: 'E', by: 2 }]);
    const bed = r.project.levels[0].rooms.find((x) => x.id === 'r4')!;
    const bath = r.project.levels[0].rooms.find((x) => x.id === 'r5')!;
    expect(bed.rect![2]).toBe(14);
    expect(bath.rect![0]).toBe(14);
  });

  it('add_wing attaches new rooms and connects them', () => {
    const base = ok(blank(), [{ op: 'use_template', template: 'cottage' }]).project;
    const r = ok(base, [{ op: 'add_wing', level: 'L1', side: 'E', rooms: [{ name: 'Studio', type: 'studio' }, { name: 'Guest Room', type: 'bedroom' }] }]);
    expect(r.project.levels[0].rooms.some((x) => x.name === 'Studio')).toBe(true);
    expect(r.issues.filter((i) => i.rule === 'reach')).toEqual([]);
    expect(area(r.project)).toBeGreaterThan(area(base));
  });

  it('pinning an automatic window keeps it', () => {
    const base = ok(blank(), [{ op: 'use_template', template: 'cottage' }]).project;
    const auto = base.levels[0].openings.find((o) => o.auto && o.type === 'window')!;
    const r = ok(base, [{ op: 'update_opening', opening: auto.id, width: 5 }]);
    const pinned = r.project.levels[0].openings.find((o) => !o.auto && o.width === 5);
    expect(pinned).toBeTruthy();
    const again = ok(r.project, [{ op: 'set_name', name: 'x' }]);
    expect(again.project.levels[0].openings.find((o) => o.id === pinned!.id)?.width).toBe(5);
  });

  it('kitchen sink to the island', () => {
    const base = ok(blank(), [{ op: 'use_template', template: 'farmhouse' }]).project;
    const k = base.levels[0].rooms.find((x) => x.type === 'kitchen')!;
    const r = ok(base, [{ op: 'set_kitchen', room: k.id, sink: 'island' }]);
    const k2 = r.project.levels[0].rooms.find((x) => x.id === k.id)!;
    expect(k2.kitchen?.island).toBe(true);
    expect(k2.kitchen?.sink).toBe('island');
  });
});

describe('adding stories to small houses', () => {
  for (const t of ['cottage', 'bungalow', 'ranch', 'tiny_house'] as const) {
    it(`${t}: stairs fit and every room is reachable`, () => {
      const base = ok(blank(), [{ op: 'use_template', template: t }]).project;
      const r = ok(base, [{ op: 'add_level' }]);
      const bad = r.issues.filter((i) => i.rule.startsWith('stair') || i.rule === 'reach' || i.rule === 'geo.overlap');
      expect(bad.map((i) => i.message)).toEqual([]);
      const names = r.project.levels.flatMap((l) => l.rooms.map((x) => x.name));
      expect(new Set(names).size).toBe(names.length);
    });
  }
});
