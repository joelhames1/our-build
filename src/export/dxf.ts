import type { Resolved } from '@/core/resolve';
import { elevation } from '@/drawings/elevation';
import { exteriorScene } from '@/drawings/exterior';
import { floorPlan } from '@/drawings/plan';
import { drawingsDxf, layoutRows } from '@/drawings/render/dxf';
import { roofPlan } from '@/drawings/roofPlan';
import { openingMarks } from '@/drawings/schedules';
import { chooseCut, section } from '@/drawings/section';

/** Plans, roof plan, elevations and sections, full size in one DXF (inches), annotated for 1/4" plotting. */
export function exportDxf(res: Resolved): string {
  const scale = 4;
  const marks = openingMarks(res);
  const cuts = [
    { cut: chooseCut(res), label: 'A' },
    { cut: chooseCut(res, true), label: 'B' },
  ];
  const scene = exteriorScene(res, { scale, texture: false });
  const plans = res.levels.map((rl) => floorPlan(res, rl.index, scale, { marks, cuts: cuts.map((c) => ({ ...c, sheet: '' })) }));
  const elevations = (['S', 'E', 'N', 'W'] as const).map((side) => elevation(res, side, scale, scene));
  const sections = cuts.map((c) => ({ ...section(res, c.cut, scale), title: `Section ${c.label}` }));
  return drawingsDxf(layoutRows([[...plans, roofPlan(res, scale)], elevations, sections]));
}
