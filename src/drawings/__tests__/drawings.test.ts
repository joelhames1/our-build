import DxfParser from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import { parseProject } from '@/core/model/schema';
import { isDoorType, isWindowType } from '@/core/model/schema';
import { applyOps } from '@/core/ops/apply';
import { resolve } from '@/core/resolve';
import { TEMPLATE_IDS } from '@/core/templates/params';
import { exportDxf } from '@/export/dxf';
import { elevation } from '../elevation';
import { hiddenLines } from '../hidden';
import type { Item } from '../ir';
import { sheetsPdf } from '../render/pdf';
import { buildSheets } from '../sheets';
import { doorSchedule, openingMarks, windowSchedule } from '../schedules';

const house = (template: (typeof TEMPLATE_IDS)[number]) => {
  const blank = parseProject({ v: 1, name: 'Test House', site: {}, style: {}, roof: {}, levels: [{ id: 'L1', name: 'Main Floor' }] });
  return resolve(applyOps(blank, [{ op: 'use_template', template }]).project);
};

const lines = (items: Item[]) => items.filter((i): i is Extract<Item, { t: 'line' }> => i.t === 'line');

describe('hidden lines', () => {
  it('clips a far square where a near one covers it', () => {
    const sq = (x0: number, z0: number, s: number, y: number) => ({
      rings: [
        [
          [x0, y, z0],
          [x0 + s, y, z0],
          [x0 + s, y, z0 + s],
          [x0, y, z0 + s],
        ] as [number, number, number][],
      ],
      normal: [0, -1, 0] as [number, number, number],
      outline: { pen: 'medium' as const, layer: 'A-ELEV' as const },
    });
    // Looking north: the near square (y = 0) covers the lower-left of the far one (y = 5).
    const r = hiddenLines([sq(0, 0, 4, 0), sq(2, 2, 4, 5)], [], { R: [1, 0, 0], U: [0, 0, 1], D: [0, 1, 0] });
    const far = lines(r.lines).filter((l) => l.pts.some(([x, y]) => x > 4.01 || y > 4.01));
    const len = (l: (typeof far)[number]) => Math.hypot(l.pts[1][0] - l.pts[0][0], l.pts[1][1] - l.pts[0][1]);
    // Of the far square's 16' of outline, the 4' inside the near square are gone.
    expect(far.reduce((s, l) => s + len(l), 0)).toBeCloseTo(12, 1);
  });

  it('keeps the back of the house out of the front elevation', () => {
    const res = house('farmhouse');
    const front = elevation(res, 'S', 4);
    const back = elevation(res, 'N', 4);
    expect(lines(front.items).length).toBeGreaterThan(100);
    expect(lines(back.items).length).toBeGreaterThan(100);
    // Glazing seen from the south sits within the south openings' spans (or is a side window's sill at a corner).
    const south = res.levels.flatMap((rl) => rl.openings.filter((o) => o.exterior && o.axis === 'x' && (o.wall.outside === 0 ? -o.hostSign : o.wall.outside) === -1));
    const xs = res.levels.flatMap((rl) => rl.walls.filter((w) => w.kind === 'exterior' && w.axis === 'y').map((w) => w.coord));
    for (const l of lines(front.items).filter((l) => l.layer === 'A-GLAZ')) {
      const u = (l.pts[0][0] + l.pts[1][0]) / 2;
      const ok = south.some((o) => u >= o.u0 - 0.6 && u <= o.u1 + 0.6) || xs.some((x) => Math.abs(u - x) < 2);
      expect(ok, `glazing line at ${u.toFixed(2)}`).toBe(true);
    }
  });
});

describe('schedules', () => {
  it('lists every door and window once, under a short mark', () => {
    const res = house('farmhouse');
    const marks = openingMarks(res);
    const doors = doorSchedule(res, marks).rows;
    const windows = windowSchedule(res, marks).rows;
    const all = res.levels.flatMap((rl) => rl.openings);
    expect(doors.length).toBe(all.filter((o) => isDoorType(o.type) || o.type === 'cased_opening').length);
    expect(windows.length).toBe(all.filter((o) => isWindowType(o.type)).length);
    expect(new Set([...doors, ...windows].map((r) => r[0])).size).toBe(doors.length + windows.length);
    expect(doors[0][0]).toBe('D1');
    expect(windows[0][0]).toBe('W1');
  });
});

describe('plan set', () => {
  for (const t of TEMPLATE_IDS) {
    it(`builds a full set for the ${t}`, () => {
      const res = house(t);
      const sheets = buildSheets(res, { paper: 'tabloid', date: new Date(2026, 0, 1) });
      const numbers = sheets.map((s) => s.number);
      expect(numbers[0]).toBe('A0.0');
      expect(numbers).toContain('A1.1');
      expect(numbers.some((n) => n.startsWith('A2'))).toBe(true);
      expect(numbers.some((n) => n.startsWith('A3'))).toBe(true);
      expect(numbers.some((n) => n.startsWith('A4'))).toBe(true);
      for (const s of sheets) {
        // Everything stays on the paper.
        for (const it of s.items) {
          const pts = it.t === 'line' ? it.pts : it.t === 'fill' ? it.rings.flat() : it.t === 'text' ? [it.at] : [it.c];
          for (const [x, y] of pts) expect(x >= -0.01 && x <= s.w + 0.01 && y >= -0.01 && y <= s.h + 0.01, `${s.number} ${it.t} at ${x.toFixed(2)},${y.toFixed(2)}`).toBe(true);
        }
      }
    });
  }

  it('writes one PDF page per sheet', () => {
    const res = house('cottage');
    const sheets = buildSheets(res, { paper: 'archd' });
    const pdf = new TextDecoder('latin1').decode(sheetsPdf(sheets).output('arraybuffer'));
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBe(sheets.length);
  });
});

describe('dxf', () => {
  it('round-trips through a DXF reader with layers, linework, poché and text', () => {
    const res = house('farmhouse');
    const parsed = new DxfParser().parseSync(exportDxf(res))!;
    const layers = Object.keys(parsed.tables.layer.layers);
    for (const l of ['A-WALL', 'A-WALL-PATT', 'A-DOOR', 'A-GLAZ', 'A-ROOF', 'A-ELEV', 'A-SECT-MCUT', 'A-ANNO-DIMS']) expect(layers).toContain(l);
    const types = new Set(parsed.entities.map((e) => e.type));
    for (const t of ['LINE', 'POLYLINE', 'SOLID', 'ARC', 'CIRCLE', 'TEXT']) expect(types).toContain(t);
    const texts = parsed.entities.filter((e) => e.type === 'TEXT').map((e) => (e as unknown as { text: string }).text);
    expect(texts).toContain('KITCHEN');
    expect(texts).toContain('SOUTH ELEVATION (FRONT)');
    expect(parsed.entities.length).toBeGreaterThan(1000);
  });
});
