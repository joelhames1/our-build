import { describe, expect, it } from 'vitest';
import { deriveWalls, labelBoundaries } from '../geometry/walls';
import { parseProject } from '../model/schema';
import { resolve } from '../resolve';
import { SAMPLES } from '../samples';

const level = (rooms: { id: string; name: string; type: string; rect: [number, number, number, number] }[], openings: unknown[] = []) =>
  parseProject({ v: 1, name: 't', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'L1', rooms, openings }] }).levels[0];

describe('boundary labeling', () => {
  it('finds shared and exterior edges of two rooms', () => {
    const l = level([
      { id: 'a', name: 'A', type: 'living', rect: [0, 0, 10, 10] },
      { id: 'b', name: 'B', type: 'bedroom', rect: [10, 0, 10, 10] },
    ]);
    const { spans, issues } = labelBoundaries(l.rooms);
    expect(issues).toHaveLength(0);
    const shared = spans.filter((s) => s.pos && s.neg);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ axis: 'y', coord: 10, a: 0, b: 10, pos: 'b', neg: 'a' });
  });

  it('splits an edge at T-junctions', () => {
    const l = level([
      { id: 'a', name: 'A', type: 'living', rect: [0, 0, 20, 10] },
      { id: 'b', name: 'B', type: 'bedroom', rect: [0, 10, 10, 10] },
      { id: 'c', name: 'C', type: 'bedroom', rect: [10, 10, 10, 10] },
    ]);
    const { walls } = deriveWalls({ level: l, levelIndex: 0, floorAboveGrade: 2, style: { wall: 'lap_siding' } });
    const between = walls.filter((w) => w.axis === 'x' && w.coord === 10);
    expect(between.map((w) => [w.a, w.b, w.pos]).sort()).toEqual([
      [0, 10, 'b'],
      [10, 20, 'c'],
    ]);
    expect(walls.filter((w) => w.kind === 'exterior').length).toBeGreaterThanOrEqual(6);
  });

  it('reports overlapping rooms', () => {
    const l = level([
      { id: 'a', name: 'A', type: 'living', rect: [0, 0, 10, 10] },
      { id: 'b', name: 'B', type: 'bedroom', rect: [5, 0, 10, 10] },
    ]);
    expect(labelBoundaries(l.rooms).issues.length).toBeGreaterThan(0);
  });

  it("removes the wall between rooms joined by an 'open' opening", () => {
    const l = level(
      [
        { id: 'a', name: 'A', type: 'kitchen', rect: [0, 0, 10, 10] },
        { id: 'b', name: 'B', type: 'dining', rect: [10, 0, 10, 10] },
      ],
      [{ id: 'o1', type: 'open', room: 'a', to: 'b' }],
    );
    const { walls } = deriveWalls({ level: l, levelIndex: 0, floorAboveGrade: 2, style: { wall: 'lap_siding' } });
    expect(walls.find((w) => w.axis === 'y' && w.coord === 10)?.kind).toBe('none');
  });

  it('gives porches no walls to the outside at grade', () => {
    const l = level([
      { id: 'a', name: 'A', type: 'living', rect: [0, 0, 10, 10] },
      { id: 'p', name: 'P', type: 'porch', rect: [0, -6, 10, 6] },
    ]);
    const { walls } = deriveWalls({ level: l, levelIndex: 0, floorAboveGrade: 2, style: { wall: 'lap_siding' } });
    expect(walls.filter((w) => (w.pos === 'p' || w.neg === 'p') && w.kind === 'exterior')).toHaveLength(1);
    expect(walls.filter((w) => (w.pos === 'p' || w.neg === 'p') && !(w.pos && w.neg)).every((w) => w.kind === 'none')).toBe(true);
  });
});

describe('samples resolve cleanly', () => {
  for (const [name, make] of Object.entries(SAMPLES)) {
    it(name, () => {
      const r = resolve(make());
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(r.roof.faces.length).toBeGreaterThan(0);
    });
  }
});
