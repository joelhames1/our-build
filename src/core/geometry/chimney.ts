import type { Project, Side } from '../model/schema';
import type { Box } from './polygon';
import { type RoofFace, planeZ } from './roof';
import { roomEdges } from './openings';
import type { WallSeg } from './walls';

/** One stacked block of masonry: plan box and its bottom and top heights. */
export interface ChimneyBlock {
  box: Box;
  z0: number;
  z1: number;
  part: 'base' | 'stack' | 'cap' | 'flue';
}

export interface ResolvedChimney {
  room: string;
  side: Side;
  material: 'brick' | 'stone';
  /** True when it stands outside the wall, false when it rises inside the room. */
  exterior: boolean;
  blocks: ChimneyBlock[];
  /** Where the chimney meets the wall, along it: lets windows stand aside. */
  along: { axis: 'x' | 'y'; coord: number; a: number; b: number };
  top: number;
}

const BASE_W = 6;
const BASE_D = 3;
const STACK_W = 4;
const STACK_D = 2.5;

/**
 * A masonry chimney on one side of a room: a wide firebox base up to about mantel-and-a-bit, a narrower
 * stack above it, a cap and a flue pot. It tops out 2' above any roof within 10' (the usual rule).
 */
export function resolveChimney(project: Project, levels: { index: number; elevation: number; walls: WallSeg[] }[], roofFaces: RoofFace[]): ResolvedChimney | null {
  const spec = project.roof.chimney;
  if (!spec) return null;
  const li = project.levels.findIndex((l) => l.rooms.some((r) => r.id === spec.room));
  if (li < 0) return null;
  const room = project.levels[li].rooms.find((r) => r.id === spec.room)!;
  const lvl = levels[li];
  const edges = roomEdges(room).filter((e) => e.side === spec.side);
  if (!edges.length) return null;
  const edge = edges.reduce((a, b) => (b.b - b.a > a.b - a.a ? b : a));
  // Outside when that side is an exterior wall, measured along its exterior stretch.
  const ext = lvl.walls.filter((w) => w.kind === 'exterior' && w.axis === edge.axis && Math.abs(w.coord - edge.coord) < 1e-6 && Math.min(w.b, edge.b) - Math.max(w.a, edge.a) > 1e-6);
  const exterior = ext.length > 0;
  const span = exterior ? ext.reduce((a, b) => (b.b - b.a > a.b - a.a ? b : a)) : null;
  const a = span ? Math.max(span.a, edge.a) : edge.a;
  const b = span ? Math.min(span.b, edge.b) : edge.b;
  const mid = (a + b) / 2;
  const thick = span?.thickness ?? 0.375;
  // +1 when "out" is toward increasing coordinate on this side.
  const out = spec.side === 'N' || spec.side === 'E' ? 1 : -1;
  const dir = exterior ? out : -out;
  const face = edge.coord + dir * (thick / 2);

  const block = (w: number, d: number, z0: number, z1: number, part: ChimneyBlock['part'], inset = 0): ChimneyBlock => {
    const n0 = face + dir * inset;
    const n1 = face + dir * (inset + d);
    const [lo, hi] = n0 < n1 ? [n0, n1] : [n1, n0];
    const box: Box = edge.axis === 'x' ? { x0: mid - w / 2, x1: mid + w / 2, y0: lo, y1: hi } : { y0: mid - w / 2, y1: mid + w / 2, x0: lo, x1: hi };
    return { box, z0, z1, part };
  };

  // Tall enough: 2' above every bit of roof within 10' of the stack.
  const stackBox = block(STACK_W, STACK_D, 0, 0, 'stack').box;
  let roofTop = 0;
  for (let sx = stackBox.x0 - 10; sx <= stackBox.x1 + 10; sx += 1)
    for (let sy = stackBox.y0 - 10; sy <= stackBox.y1 + 10; sy += 1) {
      const dx = Math.max(stackBox.x0 - sx, 0, sx - stackBox.x1);
      const dy = Math.max(stackBox.y0 - sy, 0, sy - stackBox.y1);
      if (Math.hypot(dx, dy) > 10) continue;
      for (const f of roofFaces) if (f.visible.some((p) => inRing(sx, sy, p[0]))) roofTop = Math.max(roofTop, planeZ(f.plane, sx, sy));
    }
  const plate = Math.max(...levels.map((l) => l.elevation)) + 8;
  const top = Math.max(roofTop + 2, plate + 3);
  const shoulder = lvl.elevation + 6;

  const blocks: ChimneyBlock[] = exterior
    ? [block(BASE_W, BASE_D, 0, shoulder, 'base'), block(STACK_W, STACK_D, shoulder, top, 'stack')]
    : [block(BASE_W, BASE_D, lvl.elevation, shoulder, 'base'), block(STACK_W, STACK_D, shoulder, top, 'stack')];
  blocks.push(block(STACK_W + 0.5, STACK_D + 0.5, top, top + 0.33, 'cap', -0.25));
  const pot = block(1, 1, top + 0.33, top + 1.4, 'flue', (STACK_D - 1) / 2);
  blocks.push(pot);
  return {
    room: room.id,
    side: spec.side,
    material: spec.material ?? (project.style.wall === 'brick' ? 'brick' : project.style.wall === 'stone' || project.style.foundation === 'stone_plinth' ? 'stone' : 'brick'),
    exterior,
    blocks,
    along: { axis: edge.axis, coord: edge.coord, a: mid - BASE_W / 2, b: mid + BASE_W / 2 },
    top: top + 1.4,
  };
}

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
