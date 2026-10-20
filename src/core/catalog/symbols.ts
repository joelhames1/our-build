import type { ResolvedFixture } from '../geometry/fixtures';

/**
 * Plan symbols for furniture and fixtures, in plan coordinates, drawn the way architects do: outlines
 * for the piece, lighter lines for detail, dashed for things overhead (upper cabinets, hoods) and
 * for rugs, and short labels for appliances. Used by the plan view and the drawing set.
 */
export type SymbolPrim =
  | { t: 'poly'; pts: [number, number][]; closed: boolean; pen: Pen; fill?: 'tone' | 'white' }
  | { t: 'circle'; c: [number, number]; r: number; pen: Pen; fill?: 'tone' | 'white' }
  | { t: 'text'; at: [number, number]; text: string; size: number };

/** outline = the piece's edge; detail = lines inside it; hidden = dashed (overhead or soft). */
export type Pen = 'outline' | 'detail' | 'hidden';

export function fixtureSymbol(f: ResolvedFixture): SymbolPrim[] {
  const { w, d } = f;
  const hw = w / 2;
  // Local x across the front, y from the back (0) to the front (d).
  const P = (x: number, y: number): [number, number] => {
    switch (f.facing) {
      case 'N':
        return [f.cx + x, f.cy - d / 2 + y];
      case 'S':
        return [f.cx - x, f.cy + d / 2 - y];
      case 'E':
        return [f.cx - d / 2 + y, f.cy - x];
      default:
        return [f.cx + d / 2 - y, f.cy + x];
    }
  };
  const out: SymbolPrim[] = [];
  const rect = (x0: number, x1: number, y0: number, y1: number, pen: Pen = 'outline', fill?: 'tone' | 'white') => out.push({ t: 'poly', pts: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], closed: true, pen, fill });
  const line = (x0: number, y0: number, x1: number, y1: number, pen: Pen = 'detail') => out.push({ t: 'poly', pts: [P(x0, y0), P(x1, y1)], closed: false, pen });
  const circle = (x: number, y: number, r: number, pen: Pen = 'detail', fill?: 'tone' | 'white') => out.push({ t: 'circle', c: P(x, y), r, pen, fill });
  const text = (x: number, y: number, s: string, size = 0.45) => out.push({ t: 'text', at: P(x, y), text: s, size });
  const all = () => rect(-hw, hw, 0, d, 'outline', 'white');

  switch (f.kind) {
    case 'bed_twin':
    case 'bed_full':
    case 'bed_queen':
    case 'bed_king': {
      all();
      const pw = Math.min(2.4, w / 2 - 0.3);
      for (const x of w > 4 ? [-w / 4, w / 4] : [0]) rect(x - pw / 2, x + pw / 2, 0.35, 1.6, 'detail');
      line(-hw, 2.4, hw, 2.4);
      line(-hw, 2.4, -hw + 0.9, 3.2);
      return out;
    }
    case 'crib':
    case 'bunk_bed':
      all();
      line(-hw, d * 0.25, hw, d * 0.25);
      return out;
    case 'sofa':
    case 'loveseat':
    case 'sectional':
    case 'armchair': {
      all();
      line(-hw, 0.8, hw, 0.8);
      line(-hw + 0.55, 0.8, -hw + 0.55, d);
      line(hw - 0.55, 0.8, hw - 0.55, d);
      const n = Math.max(1, Math.round((w - 1.1) / 2.6));
      for (let k = 1; k < n; k++) {
        const x = -hw + 0.55 + ((w - 1.1) / n) * k;
        line(x, 0.8, x, d);
      }
      return out;
    }
    case 'round_table':
      out.push({ t: 'circle', c: P(0, d / 2), r: w / 2, pen: 'outline', fill: 'white' });
      return out;
    case 'bar_stool':
    case 'office_chair':
      circle(0, d / 2, Math.min(w, d) * 0.45, 'outline', 'white');
      return out;
    case 'dining_chair':
    case 'rocking_chair':
    case 'adirondack_chair':
      all();
      line(-hw, 0.25, hw, 0.25);
      return out;
    case 'tv':
      rect(-hw, hw, 0, d, 'outline', 'tone');
      return out;
    case 'fireplace':
      rect(-hw - 0.6, hw + 0.6, 0, d + 0.9, 'detail');
      rect(-hw, hw, 0, 0.6, 'outline', 'tone');
      rect(-1.35, 1.35, 0, 0.55, 'detail');
      return out;
    case 'rug':
    case 'rug_large':
      rect(-hw, hw, 0, d, 'hidden');
      return out;
    case 'plant':
    case 'planter':
      circle(0, d / 2, Math.min(w, d) * 0.45, 'outline');
      circle(0, d / 2, Math.min(w, d) * 0.2, 'detail');
      return out;
    case 'floor_lamp':
      circle(0, d / 2, 0.55, 'outline');
      line(-0.4, d / 2, 0.4, d / 2);
      line(0, d / 2 - 0.4, 0, d / 2 + 0.4);
      return out;
    case 'wardrobe':
    case 'pantry_cabinet':
      all();
      line(-hw, 0, hw, d);
      line(-hw, d, hw, 0);
      return out;
    case 'bookshelf':
      all();
      line(-hw, d * 0.5, hw, d * 0.5);
      return out;
    // --- kitchen
    case 'base_cabinet':
      all();
      return out;
    case 'upper_cabinet':
    case 'hood':
      rect(-hw, hw, 0, d, 'hidden');
      return out;
    case 'sink':
      all();
      rect(-Math.min(1.1, hw - 0.2), Math.min(1.1, hw - 0.2), 0.45, 1.55, 'detail');
      circle(0, 1.0, 0.08);
      return out;
    case 'island_sink':
      rect(-hw * 0.75, hw * 0.75, 0.2, d - 0.2, 'detail');
      circle(0, d / 2, 0.08);
      return out;
    case 'dishwasher':
      all();
      text(0, d / 2, 'DW');
      return out;
    case 'range':
    case 'island_cooktop':
      if (f.kind === 'range') all();
      for (const x of [-hw / 2, hw / 2]) for (const y of [d * 0.3, d * 0.7]) circle(x, y, Math.min(w, d) * 0.16);
      return out;
    case 'fridge':
      all();
      text(0, d / 2, 'REF');
      return out;
    case 'island':
      rect(-hw - 0.1, hw + 0.1, -0.1, d, 'outline', 'white');
      line(-hw, d - 1, hw, d - 1, 'hidden');
      return out;
    // --- bath
    case 'toilet':
      rect(-0.75, 0.75, 0, 0.65, 'outline', 'white');
      out.push({ t: 'poly', pts: ellipse(P, 0, 1.55, 0.62, 0.85), closed: true, pen: 'outline', fill: 'white' });
      return out;
    case 'vanity':
    case 'vanity_double': {
      all();
      const basins = f.kind === 'vanity_double' && w >= 4.5 ? [-w / 4, w / 4] : [0];
      for (const x of basins) out.push({ t: 'poly', pts: ellipse(P, x, d * 0.55, 0.6, 0.45), closed: true, pen: 'detail' });
      return out;
    }
    case 'tub':
    case 'tub_shower':
    case 'freestanding_tub':
      all();
      rect(-hw + 0.3, hw - 0.3, 0.3, d - 0.3, 'detail');
      circle(-hw + 0.7, d / 2, 0.1);
      return out;
    case 'shower':
      all();
      line(-hw, 0, hw, d);
      line(-hw, d, hw, 0);
      circle(0, d / 2, 0.12);
      return out;
    case 'washer':
    case 'dryer':
      all();
      circle(0, d / 2, Math.min(w, d) * 0.32);
      text(0, d * 0.12, f.kind === 'washer' ? 'W' : 'D', 0.35);
      return out;
    case 'car':
      rect(-hw, hw, 0, d, 'detail');
      rect(-hw + 0.35, hw - 0.35, d * 0.3, d * 0.72, 'detail');
      return out;
    case 'closet_shelving':
      line(-hw, d * 0.65, hw, d * 0.65);
      line(-hw, d * 0.45, hw, d * 0.45, 'hidden');
      return out;
    case 'pantry_shelving':
      all();
      return out;
    case 'porch_swing':
      all();
      line(-hw, 0.3, hw, 0.3);
      return out;
    default:
      all();
      return out;
  }
}

function ellipse(P: (x: number, y: number) => [number, number], cx: number, cy: number, rx: number, ry: number, n = 20): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push(P(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
  }
  return pts;
}
