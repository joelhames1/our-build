import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type RoofLevelInput, buildRoof, planeZ, roofZAt } from '../geometry/roof';
import { type MultiPoly, boxMulti, multiArea, union } from '../geometry/polygon';
import { Roof, parseProject } from '../model/schema';
import { applyOps } from '../ops/apply';
import { resolve } from '../resolve';

const roof = (o: Partial<Roof> = {}) => Roof.parse(o);
const lvl = (footprint: MultiPoly, extra: Partial<RoofLevelInput> = {}): RoofLevelInput => ({ index: 0, footprint, upper: null, upperFloor: null, plate: 10, porches: [], ...extra });

describe('roof envelope', () => {
  it('a gable on a box has two faces meeting at the ridge', () => {
    const r = buildRoof([lvl(boxMulti({ x0: 0, y0: 0, x1: 40, y1: 24 }))], roof({ form: 'gable', pitch: 12 }), 'S');
    expect(r.faces).toHaveLength(2);
    // Ridge height: half the depth at 12/12 above the plate.
    expect(roofZAt(r.faces, 0, 20, 12)).toBeCloseTo(22, 5);
    // Eave line sits on the plate.
    expect(roofZAt(r.faces, 0, 20, 0)).toBeCloseTo(10, 5);
  });

  it('a hip roof has four faces', () => {
    const r = buildRoof([lvl(boxMulti({ x0: 0, y0: 0, x1: 40, y1: 24 }))], roof({ form: 'hip' }), 'S');
    expect(r.faces).toHaveLength(4);
  });

  it('an L-shape makes a wing whose ridge stays below the main ridge', () => {
    const foot = union(boxMulti({ x0: 0, y0: 0, x1: 40, y1: 20 }), boxMulti({ x0: 24, y0: 20, x1: 40, y1: 34 }));
    const r = buildRoof([lvl(foot)], roof({ form: 'gable', pitch: 8 }), 'S');
    expect(r.masses.map((m) => m.kind)).toEqual(['main', 'wing']);
    const mainRidge = roofZAt(r.faces, 0, 10, 10)!;
    const wingRidge = roofZAt(r.faces, 0, 32, 28)!;
    expect(wingRidge).toBeLessThan(mainRidge);
  });

  it('the roof covers every rectilinear footprint, with continuous height', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: fc.integer({ min: 0, max: 30 }), y: fc.integer({ min: 0, max: 30 }), w: fc.integer({ min: 10, max: 30 }), d: fc.integer({ min: 10, max: 24 }) }), { minLength: 1, maxLength: 3 }),
        fc.constantFrom('gable', 'hip'),
        (boxes, form) => {
          const foot = union(...boxes.map((b) => boxMulti({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.d })));
          if (foot.length !== 1) return true; // only connected footprints
          const r = buildRoof([lvl(foot)], roof({ form, pitch: 8 }), 'S');
          const covered = union(...r.faces.map((f) => f.visible));
          // Everything under the walls is roofed.
          const missing = multiArea(foot) - multiArea(union(covered, foot)) + multiArea(covered);
          expect(missing).toBeGreaterThanOrEqual(multiArea(foot) - 1e-3);
          for (const f of r.faces) for (const poly of f.visible) for (const [x, y] of poly[0]) expect(planeZ(f.plane, x, y)).toBeGreaterThan(5);
          return true;
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('chimney', () => {
  it('clears the roof and keeps windows beside it', () => {
    for (const t of ['cottage', 'cape_cod', 'farmhouse', 'bungalow', 'lake_house'] as const) {
      const r = applyOps(parseProject({ v: 1, name: 'T', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main' }] }), [{ op: 'use_template', template: t }]);
      const res = resolve(r.project);
      const ch = res.chimney!;
      expect(ch, t).toBeTruthy();
      expect(ch.exterior, t).toBe(true);
      const stack = ch.blocks.find((b) => b.part === 'stack')!;
      // 2' above any roof within 10'.
      for (let x = stack.box.x0 - 10; x <= stack.box.x1 + 10; x += 2)
        for (let y = stack.box.y0 - 10; y <= stack.box.y1 + 10; y += 2) {
          if (Math.hypot(Math.max(stack.box.x0 - x, 0, x - stack.box.x1), Math.max(stack.box.y0 - y, 0, y - stack.box.y1)) > 10) continue;
          for (const rl of res.levels) {
            const z = roofZAt(res.roof.faces, rl.roofLevel, x, y);
            if (z !== null) expect(stack.z1, t).toBeGreaterThanOrEqual(z + 2 - 1e-6);
          }
        }
      // No window hides behind it.
      const rl = res.levels[0];
      for (const o of rl.openings) {
        if (o.axis !== ch.along.axis || Math.abs(o.wall.coord - ch.along.coord) > 0.5) continue;
        expect(o.u1 <= ch.along.a || o.u0 >= ch.along.b, `${t} ${o.id}`).toBe(true);
      }
    }
  });

  it('goes away with its room', () => {
    const base = applyOps(parseProject({ v: 1, name: 'T', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main' }] }), [{ op: 'use_template', template: 'cottage' }]).project;
    const r = applyOps(base, [{ op: 'remove_room', room: base.roof.chimney!.room }]);
    expect(r.ok).toBe(true);
    expect(r.project.roof.chimney).toBeNull();
  });
});
