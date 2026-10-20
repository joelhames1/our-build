import { describe, expect, it } from 'vitest';
import { pointInRing } from '@/core/geometry/polygon';
import { isEnclosed, parseProject, type Project } from '@/core/model/schema';
import { applyOps } from '@/core/ops/apply';
import type { OpInput } from '@/core/ops/schema';
import { resolve } from '@/core/resolve';
import { TEMPLATE_IDS } from '@/core/templates/params';
import { buildWalkWorld, floorAt, slide, walkableRooms } from '../world';

const blank = () => parseProject({ v: 1, name: 'Test', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });

function build(ops: OpInput[]): Project {
  const r = applyOps(blank(), ops);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.project;
}

/** Rooms you can't get into on foot, starting in the front yard. */
function unreachable(p: Project): string[] {
  const res = resolve(p);
  const reach = walkableRooms(buildWalkWorld(res));
  return res.levels.flatMap((rl) => [...rl.rooms.values()].filter((i) => isEnclosed(i.room.type) && !reach[rl.index].has(i.room.id)).map((i) => `${rl.level.name}/${i.room.name}`));
}

describe('walk mode', () => {
  it('walks from the front yard through the front door', () => {
    const res = resolve(build([{ op: 'use_template', template: 'farmhouse', params: { porch: 'wrap' } }]));
    const w = buildWalkWorld(res);
    let { x, y } = w.spawn;
    const fx = -Math.sin(w.spawn.yaw);
    const fy = Math.cos(w.spawn.yaw);
    // About 48' straight ahead: across the yard, up onto the porch, through the door.
    for (let i = 0; i < 600; i++) [x, y] = slide(w.levels[0].segs, x, y, fx * 0.08, fy * 0.08);
    const here = w.levels[0].floors.find((f) => pointInRing([x, y], f.ring));
    expect(here && isEnclosed(res.levels[0].rooms.get(here.room)!.room.type)).toBe(true);
    expect(floorAt(w, 0, x, y)?.z).toBe(res.levels[0].elevation);
  });

  for (const t of TEMPLATE_IDS) {
    it(`can reach every room of the ${t} on foot`, () => {
      expect(unreachable(build([{ op: 'use_template', template: t }]))).toEqual([]);
    });
  }

  for (const [t, stories] of [
    ['cottage', '1.5'],
    ['cottage', '2'],
    ['lake_house', '1.5'],
    ['modern', '2'],
  ] as const) {
    it(`can reach every room of a ${stories}-story ${t}`, () => {
      expect(unreachable(build([{ op: 'use_template', template: t, params: { stories } }]))).toEqual([]);
    });
  }

  for (const t of ['cottage', 'ranch', 'bungalow', 'farmhouse', 'cape_cod', 'lake_house', 'garage_studio'] as const) {
    it(`can climb to a story added to the ${t}`, () => {
      expect(unreachable(build([{ op: 'use_template', template: t }, { op: 'add_level' }]))).toEqual([]);
    });
  }

  it('can climb stacked stairs to a fourth floor', () => {
    expect(unreachable(build([{ op: 'use_template', template: 'farmhouse' }, { op: 'add_level' }, { op: 'add_level' }]))).toEqual([]);
  });
});
