import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type RoofLevelInput, buildRoof, planeZ, roofZAt } from '../geometry/roof';
import { type MultiPoly, boxMulti, multiArea, union } from '../geometry/polygon';
import { Roof } from '../model/schema';

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
