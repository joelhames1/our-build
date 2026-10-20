import { describe, expect, it } from 'vitest';
import { parseProject } from '../model/schema';
import { applyOps } from '../ops/apply';
import type { OpInput } from '../ops/schema';
import { resolve } from '../resolve';
import { TEMPLATE_IDS } from '../templates/params';

const blank = () => parseProject({ v: 1, name: 'T', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main' }] });
const build = (ops: OpInput[]) => {
  const r = applyOps(blank(), ops);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.project;
};
const overlap = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a) => a.x0 < b.x1 - 0.09 && b.x0 < a.x1 - 0.09 && a.y0 < b.y1 - 0.09 && b.y0 < a.y1 - 0.09;

describe('furnishing', () => {
  for (const t of TEMPLATE_IDS) {
    it(`keeps every piece of the ${t} inside its room and out of the others' way`, () => {
      const res = resolve(build([{ op: 'use_template', template: t }]));
      for (const rl of res.levels) {
        for (const f of rl.fixtures) {
          const i = rl.rooms.get(f.room)!.inner;
          expect(f.box.x0 >= i.x0 - 0.06 && f.box.x1 <= i.x1 + 0.06 && f.box.y0 >= i.y0 - 0.06 && f.box.y1 <= i.y1 + 0.06, `${f.id} in ${f.room}`).toBe(true);
        }
        const solid = rl.fixtures.filter((f) => f.solid);
        for (let a = 0; a < solid.length; a++)
          for (let b = a + 1; b < solid.length; b++) {
            const A = solid[a];
            const B = solid[b];
            const stacked = A.z0 < B.z0 + B.h && B.z0 < A.z0 + A.h;
            expect(stacked && overlap(A.box, B.box), `${A.id} / ${B.id}`).toBe(false);
          }
      }
    });
  }

  it('gives every kitchen a sink, a range, a fridge and counters, and every bath its fixtures', () => {
    for (const t of TEMPLATE_IDS) {
      const res = resolve(build([{ op: 'use_template', template: t }]));
      for (const rl of res.levels)
        for (const info of rl.rooms.values()) {
          const kinds = rl.fixtures.filter((f) => f.room === info.room.id).map((f) => f.kind);
          if (info.room.type === 'kitchen') for (const k of ['sink', 'range', 'fridge', 'base_cabinet']) expect(kinds, `${t} ${info.room.name}`).toContain(k);
          if (info.room.type === 'bath') {
            expect(kinds, `${t} ${info.room.name}`).toContain('toilet');
            expect(kinds.some((k) => k.startsWith('vanity')), `${t} ${info.room.name} vanity`).toBe(true);
          }
          if (info.room.type === 'bedroom' || info.room.type === 'primary_bedroom') expect(kinds.some((k) => k.startsWith('bed_')), `${t} ${info.room.name} bed`).toBe(true);
        }
    }
  });

  it('puts the sink in the island when asked', () => {
    const base = build([{ op: 'use_template', template: 'farmhouse' }]);
    const kitchen = base.levels[0].rooms.find((r) => r.type === 'kitchen')!;
    const r = applyOps(base, [{ op: 'set_kitchen', room: kitchen.id, sink: 'island' }]);
    expect(r.ok).toBe(true);
    const kinds = r.project.levels[0].fixtures.filter((f) => f.room === kitchen.id).map((f) => f.kind);
    expect(kinds).toContain('island');
    expect(kinds).toContain('island_sink');
    expect(kinds).not.toContain('sink');
  });

  it('remembers a removed piece and works around an edited one', () => {
    const base = build([{ op: 'use_template', template: 'cottage' }]);
    const bed = base.levels[0].fixtures.find((f) => f.kind.startsWith('bed_'))!;
    const gone = applyOps(base, [{ op: 'remove_fixture', fixture: bed.id }]);
    expect(gone.project.levels[0].fixtures.some((f) => f.id === bed.id)).toBe(false);
    // Still gone after an unrelated change.
    const later = applyOps(gone.project, [{ op: 'set_style', wallColor: '#ffffff' }]);
    expect(later.project.levels[0].fixtures.some((f) => f.id === bed.id)).toBe(false);

    const sofa = base.levels[0].fixtures.find((f) => f.kind === 'sofa' || f.kind === 'loveseat')!;
    const moved = applyOps(base, [{ op: 'update_fixture', fixture: sofa.id, kind: 'sectional' }]);
    expect(moved.ok).toBe(true);
    const pinned = moved.project.levels[0].fixtures.find((f) => f.id === sofa.id)!;
    expect(pinned.auto).toBe(false);
    expect(pinned.kind).toBe('sectional');
  });
});
