import { planeZ } from '@/core/geometry/roof';
import type { Side } from '@/core/model/schema';
import { ftIn } from '@/core/model/units';
import type { Resolved } from '@/core/resolve';
import { type ExteriorScene, exteriorScene } from './exterior';
import { type View, hiddenLines } from './hidden';
import { type Drawing, Pad } from './ir';

/** Looking at each side of the house from outside it. */
export const ELEVATION_VIEWS: Record<Side, View> = {
  S: { R: [1, 0, 0], U: [0, 0, 1], D: [0, 1, 0] },
  N: { R: [-1, 0, 0], U: [0, 0, 1], D: [0, -1, 0] },
  E: { R: [0, 1, 0], U: [0, 0, 1], D: [-1, 0, 0] },
  W: { R: [0, -1, 0], U: [0, 0, 1], D: [1, 0, 0] },
};

const SIDE_NAME: Record<Side, string> = { N: 'North', E: 'East', S: 'South', W: 'West' };

export function elevationTitle(res: Resolved, side: Side): string {
  const front = res.project.site.front;
  const opposite: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const tag = side === front ? ' (Front)' : side === opposite[front] ? ' (Rear)' : '';
  return `${SIDE_NAME[side]} Elevation${tag}`;
}

/** One exterior elevation with hidden lines removed, a ground line and level datums. */
export function elevation(res: Resolved, side: Side, scale: number, scene?: ExteriorScene): Drawing {
  const sc = scene ?? exteriorScene(res, { scale });
  const hl = hiddenLines(sc.solids, sc.lines, ELEVATION_VIEWS[side], { silhouette: true });
  const pad = new Pad(scale);
  pad.items.push(...hl.fills, ...hl.lines);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const poly of hl.silhouette)
    for (const ring of poly) {
      pad.line(ring as [number, number][], 'profile', 'A-ELEV-OTLN', true);
      for (const [x] of ring) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
  if (!Number.isFinite(x0)) return { id: `elev-${side}`, title: elevationTitle(res, side), scale, items: pad.items };

  // Grade: a heavy line with a band of earth tone under it.
  const g0 = x0 - pad.p(0.5);
  const g1 = x1 + pad.p(0.5);
  pad.fill(
    [
      [
        [g0, 0],
        [g1, 0],
        [g1, -pad.p(0.07)],
        [g0, -pad.p(0.07)],
      ],
    ],
    'tone',
    'A-SITE',
  );
  pad.seg([g0, 0], [g1, 0], 'cut', 'A-SITE');

  datums(pad, res, x1);
  return { id: `elev-${side}`, title: elevationTitle(res, side), scale, items: pad.items };
}

/** Level markers to the right of a drawing: each floor and the top of the ridge, relative to the first floor. */
export function datums(pad: Pad, res: Resolved, xRight: number) {
  const base = res.levels[0]?.elevation ?? 0;
  const list: [string, number][] = res.levels.map((rl) => [rl.level.name.toUpperCase(), rl.elevation]);
  let ridge = -Infinity;
  for (const f of res.roof.faces) for (const poly of f.visible) for (const ring of poly) for (const [x, y] of ring) ridge = Math.max(ridge, planeZ(f.plane, x, y));
  if (Number.isFinite(ridge)) list.push(['T.O. RIDGE', ridge]);
  const lx0 = xRight + pad.p(0.15);
  const lx1 = xRight + pad.p(0.85);
  const r = pad.p(0.045);
  for (const [name, z] of list) {
    pad.seg([lx0, z], [lx1 - r, z], 'dim', 'A-ANNO-SYMB');
    pad.circle([lx1, z], r, 'fine', 'A-ANNO-SYMB');
    // Target: two opposite quarters filled.
    const q = (a0: number): [number, number][] => [[lx1, z], ...Array.from({ length: 7 }, (_, i) => [lx1 + r * Math.cos(a0 + (i / 6) * (Math.PI / 2)), z + r * Math.sin(a0 + (i / 6) * (Math.PI / 2))] as [number, number])];
    pad.fill([q(0)], 'poche', 'A-ANNO-SYMB');
    pad.fill([q(Math.PI)], 'poche', 'A-ANNO-SYMB');
    const dz = z - base;
    const value = Math.abs(dz) < 1 / 96 ? `0'-0"` : `${dz > 0 ? '+' : ''}${ftIn(dz)}`;
    pad.text([lx1 + pad.p(0.1), z + pad.p(0.015)], name, 0.07, 'A-ANNO-TEXT', { font: 'sans', bold: true });
    pad.text([lx1 + pad.p(0.1), z - pad.p(0.095)], value, 0.07, 'A-ANNO-TEXT', { font: 'sans' });
  }
}

const FRONT: Record<Side, [number, number]> = { S: [0, -1], N: [0, 1], E: [1, 0], W: [-1, 0] };

/** The view from above the front-right corner, for the cover. */
export function axonView(res: Resolved): View {
  const [fx, fy] = FRONT[res.project.site.front];
  // The viewer's right when facing the front of the house.
  const rx = -fy;
  const ry = fx;
  const eye: [number, number, number] = [fx + rx * 0.85, fy + ry * 0.85, 0.95];
  const l = Math.hypot(...eye);
  const D: [number, number, number] = [-eye[0] / l, -eye[1] / l, -eye[2] / l];
  const h = Math.hypot(D[0], D[1]);
  const R: [number, number, number] = [D[1] / h, -D[0] / h, 0];
  const U: [number, number, number] = [R[1] * D[2] - R[2] * D[1], R[2] * D[0] - R[0] * D[2], R[0] * D[1] - R[1] * D[0]];
  return { R, U, D };
}

/** A hidden-line axonometric of the whole house (coursing included), drawn at `scale`. */
export function axonometric(res: Resolved, scale: number, scene?: ExteriorScene): Drawing {
  const sc = scene ?? exteriorScene(res, { scale });
  const hl = hiddenLines(sc.solids, sc.lines, axonView(res), { silhouette: true });
  const pad = new Pad(scale);
  pad.items.push(...hl.fills, ...hl.lines);
  for (const poly of hl.silhouette) for (const ring of poly) pad.line(ring as [number, number][], 'profile', 'A-ELEV-OTLN', true);
  return { id: 'axon', title: 'Axonometric', scale, items: pad.items };
}
