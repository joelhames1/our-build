import type { V3 } from '@/core/geometry/faces';
import type { ResolvedFixture } from '@/core/geometry/fixtures';
import type { BoxBatch } from './geometry';

/**
 * Furniture and fixtures as simple, soft-edged model pieces. Each builder works in the piece's own
 * frame: x across its front (-w/2..w/2, left to right as you face it), y from its back (0) to its
 * front (d), z up from its underside. Rotations are quarter turns, so every box stays axis-aligned.
 */

interface Pen {
  box(mat: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void;
  soft(mat: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r?: number): void;
  cyl(mat: string, x: number, y: number, r: number, z0: number, z1: number, seg?: number): void;
  ball(mat: string, x: number, y: number, z: number, r: number): void;
}

export function addFurniture(batch: BoxBatch, fixtures: ResolvedFixture[], cut?: number) {
  for (const f of fixtures) {
    if (cut !== undefined && f.z0 >= cut) continue;
    build(f, pen(batch, f, cut));
  }
}

function pen(batch: BoxBatch, f: ResolvedFixture, cut?: number): Pen {
  // Local (x, y) to plan: the back of the piece sits on the side opposite its facing.
  const toPlan = (x: number, y: number): [number, number] => {
    switch (f.facing) {
      case 'N':
        return [f.cx + x, f.cy - f.d / 2 + y];
      case 'S':
        return [f.cx - x, f.cy + f.d / 2 - y];
      case 'E':
        return [f.cx - f.d / 2 + y, f.cy - x];
      default:
        return [f.cx + f.d / 2 - y, f.cy + x];
    }
  };
  const clipZ = (z0: number, z1: number): [number, number] | null => {
    const a = f.z0 + z0;
    let b = f.z0 + z1;
    if (cut !== undefined) {
      if (a >= cut) return null;
      b = Math.min(b, cut);
    }
    return b - a > 1e-3 ? [a, b] : null;
  };
  const rect = (x0: number, x1: number, y0: number, y1: number) => {
    const [ax, ay] = toPlan(x0, y0);
    const [bx, by] = toPlan(x1, y1);
    return { cx: (ax + bx) / 2, cy: (ay + by) / 2, sx: Math.abs(bx - ax), sy: Math.abs(by - ay) };
  };
  return {
    box(mat, x0, x1, y0, y1, z0, z1) {
      const z = clipZ(z0, z1);
      if (!z) return;
      const r = rect(x0, x1, y0, y1);
      batch.add(mat, f.id, [r.cx, r.cy, (z[0] + z[1]) / 2] as V3, [r.sx, r.sy, z[1] - z[0]] as V3);
    },
    soft(mat, x0, x1, y0, y1, z0, z1, rad = 0.18) {
      const z = clipZ(z0, z1);
      if (!z) return;
      const r = rect(x0, x1, y0, y1);
      batch.addRounded(mat, f.id, [r.cx, r.cy, (z[0] + z[1]) / 2] as V3, [r.sx, r.sy, z[1] - z[0]] as V3, rad);
    },
    cyl(mat, x, y, rad, z0, z1, seg = 16) {
      const z = clipZ(z0, z1);
      if (!z) return;
      const [px, py] = toPlan(x, y);
      batch.addCylinder(mat, f.id, [px, py, (z[0] + z[1]) / 2], rad, z[1] - z[0], seg);
    },
    ball(mat, x, y, z, rad) {
      if (cut !== undefined && f.z0 + z - rad >= cut) return;
      const [px, py] = toPlan(x, y);
      batch.addBall(mat, f.id, [px, py, f.z0 + z], rad);
    },
  };
}

const legs = (p: Pen, mat: string, w: number, d: number, h: number, t = 0.15, inset = 0.1) => {
  for (const [x, y] of [
    [-w / 2 + inset, inset],
    [w / 2 - inset - t, inset],
    [-w / 2 + inset, d - inset - t],
    [w / 2 - inset - t, d - inset - t],
  ])
    p.box(mat, x, x + t, y, y + t, 0, h);
};

function build(f: ResolvedFixture, p: Pen) {
  const { w, d, h } = f;
  const hw = w / 2;
  switch (f.kind) {
    // --- beds
    case 'bed_twin':
    case 'bed_full':
    case 'bed_queen':
    case 'bed_king': {
      p.box('wood', -hw, hw, 0.2, d, 0, 1.0);
      p.soft('fabric', -hw, hw, 0, 0.3, 0, 3.7, 0.12);
      p.soft('linen', -hw + 0.08, hw - 0.08, 0.3, d - 0.05, 1.0, 1.85, 0.2);
      const pw = Math.min(2.4, w / 2 - 0.3);
      for (const x of w > 4 ? [-w / 4, w / 4] : [0]) p.soft('linen', x - pw / 2, x + pw / 2, 0.45, 1.75, 1.85, 2.3, 0.15);
      p.soft('blanket', -hw + 0.02, hw - 0.02, 2.4, d + 0.03, 1.2, 1.95, 0.12);
      return;
    }
    case 'bunk_bed':
      legs(p, 'wood', w, d, h, 0.25, 0);
      p.soft('linen', -hw + 0.15, hw - 0.15, 0.15, d - 0.15, 1.0, 1.6);
      p.soft('linen', -hw + 0.15, hw - 0.15, 0.15, d - 0.15, 4.0, 4.6);
      p.box('wood', -hw, hw, 0, d, 0.8, 1.0);
      p.box('wood', -hw, hw, 0, d, 3.8, 4.0);
      return;
    case 'crib':
      legs(p, 'wood', w, d, h, 0.18, 0);
      p.box('wood', -hw, hw, 0, 0.1, 2.85, 3.0);
      p.box('wood', -hw, hw, d - 0.1, d, 2.85, 3.0);
      p.soft('linen', -hw + 0.15, hw - 0.15, 0.15, d - 0.15, 1.2, 1.6);
      return;
    case 'nightstand':
      p.box('wood', -hw, hw, 0, d, 0, h);
      p.cyl('linen', 0, d / 2, 0.15, h, h + 0.9, 10);
      p.cyl('shade', 0, d / 2, 0.45, h + 0.9, h + 1.6, 16);
      return;
    case 'dresser':
    case 'buffet':
      p.box('wood', -hw, hw, 0, d, 0.25, h);
      p.box('wood_dark', -hw + 0.1, hw - 0.1, 0.1, d - 0.1, 0, 0.25);
      return;
    case 'wardrobe':
      p.box('wood', -hw, hw, 0, d, 0, h);
      p.box('wood_dark', -0.02, 0.02, d, d + 0.01, 0.3, h - 0.3);
      return;
    // --- living
    case 'sofa':
    case 'loveseat':
    case 'sectional':
    case 'armchair': {
      const arm = 0.55;
      p.soft('fabric', -hw, hw, 0, d, 0.35, 1.35, 0.15);
      p.soft('fabric', -hw, hw, 0, 0.8, 1.35, 2.75, 0.2);
      p.soft('fabric', -hw, -hw + arm, 0, d, 1.35, 2.15, 0.2);
      p.soft('fabric', hw - arm, hw, 0, d, 1.35, 2.15, 0.2);
      const n = Math.max(1, Math.round((w - 2 * arm) / 2.6));
      const seat = (w - 2 * arm) / n;
      for (let k = 0; k < n; k++) {
        const x0 = -hw + arm + k * seat;
        p.soft('cushion', x0 + 0.03, x0 + seat - 0.03, 0.8, d - 0.05, 1.35, 1.8, 0.15);
        p.soft('cushion', x0 + 0.1, x0 + seat - 0.1, 0.55, 1.05, 1.8, 2.6, 0.15);
      }
      for (const x of [-hw + 0.2, hw - 0.35]) for (const y of [0.15, d - 0.3]) p.box('wood_dark', x, x + 0.15, y, y + 0.15, 0, 0.35);
      return;
    }
    case 'coffee_table':
    case 'side_table':
      p.box('wood', -hw, hw, 0, d, h - 0.15, h);
      p.box('wood', -hw + 0.2, hw - 0.2, 0.2, d - 0.2, 0.25, 0.35);
      legs(p, 'wood', w, d, h - 0.15, 0.15, 0.08);
      return;
    case 'tv_console':
      p.box('wood', -hw, hw, 0, d, 0.4, h);
      p.box('wood_dark', -hw + 0.15, hw - 0.15, 0.15, d - 0.15, 0, 0.4);
      return;
    case 'tv':
      p.box('screen', -hw, hw, 0, 0.18, 0, h);
      return;
    case 'bookshelf': {
      p.box('wood', -hw, -hw + 0.08, 0, d, 0, h);
      p.box('wood', hw - 0.08, hw, 0, d, 0, h);
      p.box('wood', -hw, hw, 0, 0.05, 0, h);
      const shelves = 5;
      for (let k = 0; k <= shelves; k++) {
        const z = (k * (h - 0.1)) / shelves;
        p.box('wood', -hw, hw, 0, d, z, z + 0.08);
        if (k < shelves) {
          // A row of books of varying heights, a gap, and maybe a few more.
          const top = (h / shelves) * 0.8;
          let x = -hw + 0.12;
          const end = hw - 0.12 - ((k * 7) % 5) * 0.12;
          for (let b = 0; x < end; b++) {
            const bw = 0.12 + (((k + 3) * (b + 5) * 7) % 5) * 0.03;
            const bh = top * (0.62 + (((k + 1) * (b + 2) * 13) % 7) * 0.05);
            if (b === 4 + (k % 3)) x += 0.5;
            else p.box(['books', 'books2', 'books3'][(b + k) % 3], x, Math.min(x + bw, end), 0.15, d - 0.12, z + 0.08, z + 0.08 + bh);
            x += bw + 0.01;
          }
        }
      }
      return;
    }
    case 'fireplace':
      p.box('cap_stone', -hw - 0.6, hw + 0.6, 0, d + 0.9, 0, 0.18);
      p.box('trim_int', -hw, hw, 0, 0.6, 0, 4.4);
      p.box('trim_int', -hw - 0.25, hw + 0.25, 0, 0.85, 4.25, 4.5);
      p.box('firebox', -1.35, 1.35, 0.55, 0.62, 0.18, 2.7);
      return;
    case 'piano':
      p.box('screen', -hw, hw, 0, d, 1.0, h);
      legs(p, 'screen', w, d, 1.0, 0.2, 0.1);
      return;
    case 'rug':
    case 'rug_large':
      p.box('rug', -hw, hw, 0, d, 0, 0.03);
      p.box('rug_border', -hw + 0.5, hw - 0.5, 0.5, d - 0.5, 0.03, 0.035);
      return;
    case 'floor_lamp':
      p.cyl('metal', 0, d / 2, 0.45, 0, 0.08, 16);
      p.cyl('metal', 0, d / 2, 0.04, 0.08, 4.6, 6);
      p.cyl('shade', 0, d / 2, 0.6, 4.4, 5.4, 16);
      return;
    case 'plant':
    case 'planter':
      p.cyl('pot', 0, d / 2, Math.min(w, d) * 0.32, 0, 1.2, 14);
      p.ball('plant', 0, d / 2, 2.2, Math.min(w, d) * 0.55);
      p.ball('plant', 0.2, d / 2 - 0.1, 3.0, Math.min(w, d) * 0.4);
      return;
    // --- dining
    case 'dining_table':
    case 'dining_table_large':
    case 'outdoor_table':
      p.box('wood', -hw, hw, 0, d, h - 0.15, h);
      legs(p, 'wood', w, d, h - 0.15, 0.25, 0.2);
      return;
    case 'round_table':
      p.cyl('wood', 0, d / 2, w / 2, h - 0.15, h, 28);
      p.cyl('wood', 0, d / 2, 0.25, 0.1, h - 0.15, 10);
      p.cyl('wood', 0, d / 2, 0.9, 0, 0.1, 16);
      return;
    case 'dining_chair':
      p.box('wood', -hw, hw, 0.15, d, 1.45, 1.6);
      p.box('wood', -hw, hw, 0, 0.15, 1.45, 3.0);
      legs(p, 'wood', w, d, 1.45, 0.12, 0.05);
      return;
    case 'bar_stool':
      p.cyl('wood', 0, d / 2, 0.62, h - 0.12, h, 18);
      p.cyl('metal', 0, d / 2, 0.06, 0.1, h - 0.12, 6);
      p.cyl('metal', 0, d / 2, 0.55, 0, 0.1, 14);
      p.cyl('metal', 0, d / 2, 0.5, 0.75, 0.8, 14);
      return;
    // --- kitchen
    case 'base_cabinet':
    case 'dishwasher':
    case 'sink': {
      p.box('toekick', -hw, hw, 0, d - 0.3, 0, 0.35);
      p.box(f.kind === 'dishwasher' ? 'steel' : 'cabinet', -hw, hw, 0, d - 0.08, 0.35, 2.88);
      p.box('counter', -hw, hw, 0, d, 2.88, 3.0);
      if (f.kind === 'sink') {
        p.box('steel', -Math.min(1.1, hw - 0.2), Math.min(1.1, hw - 0.2), 0.45, 1.55, 3.0, 3.015);
        p.cyl('steel', 0, 0.25, 0.05, 3.0, 4.0, 8);
        p.box('steel', -0.04, 0.04, 0.2, 0.75, 3.9, 3.98);
      }
      return;
    }
    case 'island': {
      p.box('toekick', -hw + 0.1, hw - 0.1, 0.1, d - 1.2, 0, 0.35);
      p.box('cabinet', -hw, hw, 0, d - 1.0, 0.35, 2.88);
      p.box('counter', -hw - 0.1, hw + 0.1, -0.1, d, 2.88, 3.0);
      return;
    }
    case 'island_sink':
      p.box('steel', -hw * 0.75, hw * 0.75, 0.2, d - 0.2, 0, 0.015);
      p.cyl('steel', 0, 0.12, 0.05, 0, 1.0, 8);
      return;
    case 'island_cooktop':
      p.box('screen', -hw, hw, 0.1, d - 0.1, 0, 0.02);
      return;
    case 'range':
      p.box('steel', -hw, hw, 0, d, 0, 2.95);
      p.box('screen', -hw + 0.05, hw - 0.05, 0.05, d - 0.05, 2.95, 3.0);
      p.box('screen', -hw + 0.3, hw - 0.3, d, d + 0.01, 0.6, 2.0);
      p.box('steel', -hw, hw, 0, 0.3, 3.0, 3.6);
      return;
    case 'hood':
      p.box('steel', -hw, hw, 0, d, 0, 0.45);
      p.box('steel', -hw * 0.4, hw * 0.4, 0, d * 0.55, 0.45, h);
      return;
    case 'fridge':
      p.box('steel', -hw, hw, 0, d, 0, 4.2);
      p.box('steel', -hw, hw, 0, d, 4.24, h);
      p.box('metal', hw - 0.35, hw - 0.28, d, d + 0.12, 2.4, 4.0);
      return;
    case 'upper_cabinet':
      p.box('cabinet', -hw, hw, 0, d, 0, h);
      return;
    case 'pantry_cabinet':
      p.box('cabinet', -hw, hw, 0, d, 0, h);
      return;
    // --- bath
    case 'toilet':
      p.soft('porcelain', -0.75, 0.75, 0, 0.65, 1.35, 2.55, 0.08);
      p.cyl('porcelain', 0, 1.55, 0.62, 0.0, 1.35, 20);
      p.cyl('porcelain', 0, 1.55, 0.66, 1.35, 1.42, 20);
      return;
    case 'vanity':
    case 'vanity_double': {
      p.box('wood', -hw, hw, 0, d - 0.05, 0.3, 2.75);
      p.box('wood_dark', -hw + 0.1, hw - 0.1, 0, d - 0.25, 0, 0.3);
      p.box('counter', -hw, hw, 0, d, 2.75, 2.85);
      const basins = f.kind === 'vanity_double' && w >= 4.5 ? [-w / 4, w / 4] : [0];
      for (const x of basins) {
        p.cyl('porcelain', x, d * 0.55, 0.55, 2.85, 2.95, 18);
        p.cyl('steel', x, 0.25, 0.04, 2.85, 3.6, 8);
      }
      p.box('mirror', -hw + 0.2, hw - 0.2, 0, 0.06, 3.6, 6.4);
      return;
    }
    case 'tub':
    case 'tub_shower': {
      p.box('porcelain', -hw, hw, 0, d, 0, 1.7);
      p.box('porcelain_in', -hw + 0.3, hw - 0.3, 0.3, d - 0.3, 1.7, 1.71);
      if (f.kind === 'tub_shower') {
        p.box('glass', -hw, 0.4, d - 0.06, d, 1.7, 6.6);
        p.cyl('steel', -hw + 0.6, 0.15, 0.2, 6.0, 6.08, 12);
      }
      return;
    }
    case 'freestanding_tub':
      p.soft('porcelain', -hw, hw, 0, d, 0, 2, 0.6);
      p.box('porcelain_in', -hw + 0.45, hw - 0.45, 0.4, d - 0.4, 2, 2.01);
      return;
    case 'shower':
      p.box('porcelain', -hw, hw, 0, d, 0, 0.25);
      p.box('glass', -hw, hw, d - 0.06, d, 0.25, 6.8);
      p.cyl('steel', 0, 0.15, 0.25, 6.2, 6.28, 12);
      return;
    // --- utility
    case 'washer':
    case 'dryer':
      p.box('appliance', -hw, hw, 0, d, 0, h);
      p.box('screen', -0.55, 0.55, d, d + 0.02, 1.1, 2.2);
      return;
    case 'utility_sink':
      p.box('porcelain', -hw, hw, 0, d, 2.2, h);
      legs(p, 'metal', w, d, 2.2, 0.08, 0.1);
      return;
    case 'bench':
      p.box('wood', -hw, hw, 0, d, h - 0.15, h);
      legs(p, 'wood', w, d, h - 0.15, 0.15, 0.15);
      return;
    case 'cubbies': {
      p.box('cabinet', -hw, hw, 0, 0.1, 0, h);
      p.box('cabinet', -hw, hw, 0, d, 1.4, 1.6);
      p.box('cabinet', -hw, hw, 0, d * 0.8, h - 1.2, h - 1.05);
      for (const x of [-hw, hw - 0.1]) p.box('cabinet', x, x + 0.1, 0, d, 0, h);
      for (let x = -hw + w / 3; x < hw - 0.5; x += w / 3) p.box('cabinet', x - 0.04, x + 0.04, 0, d * 0.8, 1.6, h);
      p.box('cabinet', -hw, hw, 0, d, 0, 0.3);
      return;
    }
    case 'closet_shelving': {
      p.box('wood', -hw, hw, 0, d * 0.65, 5.6, 5.7);
      p.box('metal', -hw, hw, d * 0.45, d * 0.45 + 0.05, 5.3, 5.35);
      for (let x = -hw + 0.4, k = 0; x < hw - 0.3; x += 0.55, k++) p.box(k % 3 === 0 ? 'fabric' : k % 3 === 1 ? 'blanket' : 'cushion', x, x + 0.25, d * 0.2, d * 0.8, 2.7 + (k % 2) * 0.4, 5.25);
      return;
    }
    case 'pantry_shelving':
      for (let k = 0; k < 5; k++) p.box('wood', -hw, hw, 0, d, 0.6 + k * 1.4, 0.7 + k * 1.4);
      return;
    case 'desk':
    case 'desk_large':
    case 'workbench':
      p.box('wood', -hw, hw, 0, d, h - 0.12, h);
      legs(p, f.kind === 'workbench' ? 'wood' : 'metal', w, d, h - 0.12, 0.12, 0.1);
      if (f.kind !== 'workbench') p.box('screen', -0.9, 0.9, 0.3, 0.38, h + 0.3, h + 1.5);
      return;
    case 'office_chair':
      p.soft('fabric', -0.8, 0.8, 0.3, 1.8, 1.45, 1.75, 0.12);
      p.soft('fabric', -0.75, 0.75, 0.1, 0.35, 1.75, 3.2, 0.12);
      p.cyl('metal', 0, 1, 0.06, 0.2, 1.45, 6);
      p.cyl('metal', 0, 1, 0.8, 0, 0.12, 5);
      return;
    case 'car':
      p.soft('car', -hw, hw, 0, d, 0.7, 2.8, 0.5);
      p.soft('car_glass', -hw + 0.35, hw - 0.35, d * 0.3, d * 0.72, 2.6, 4.5, 0.4);
      for (const x of [-hw - 0.02, hw - 0.75]) for (const y of [d * 0.17, d * 0.78]) p.box('tire', x, x + 0.77, y - 1.1, y + 1.1, 0, 1.6);
      return;
    case 'treadmill':
      p.box('screen', -hw, hw, 0.5, d, 0, 0.6);
      p.box('metal', -hw, -hw + 0.12, 0, 0.6, 0, h);
      p.box('metal', hw - 0.12, hw, 0, 0.6, 0, h);
      p.box('screen', -hw, hw, 0, 0.6, h - 0.5, h);
      return;
    // --- outdoors
    case 'rocking_chair':
    case 'adirondack_chair':
      p.box('wood', -hw, hw, 0.3, d, 1.3, 1.45);
      p.box('wood', -hw, hw, 0, 0.3, 1.3, h);
      p.box('wood', -hw, -hw + 0.15, 0.4, d, 2.0, 2.1);
      p.box('wood', hw - 0.15, hw, 0.4, d, 2.0, 2.1);
      legs(p, 'wood', w, d, 1.3, 0.12, 0.15);
      if (f.kind === 'rocking_chair') for (const x of [-hw + 0.15, hw - 0.27]) p.box('wood', x, x + 0.12, -0.2, d + 0.2, 0, 0.1);
      return;
    case 'porch_swing':
      p.box('wood', -hw, hw, 0.3, d, 1.4, 1.55);
      p.box('wood', -hw, hw, 0, 0.3, 1.4, 3.0);
      for (const x of [-hw + 0.1, hw - 0.15]) for (const y of [0.15, d - 0.15]) p.box('metal', x, x + 0.04, y, y + 0.04, 1.55, 8);
      return;
    case 'lounger':
      p.soft('cushion', -hw, hw, 0, d, 0.8, 1.2, 0.12);
      p.soft('cushion', -hw, hw, 0, 1.6, 1.2, 2.6, 0.12);
      legs(p, 'wood', w, d, 0.8, 0.15, 0.1);
      return;
    case 'hot_tub':
      p.box('wood', -hw, hw, 0, d, 0, h);
      p.box('water', -hw + 0.4, hw - 0.4, 0.4, d - 0.4, h, h + 0.01);
      return;
    default:
      p.soft('cushion', -hw, hw, 0, d, 0, h, 0.1);
  }
}
