import type { Issue } from '../model/issues';
import type { Level, Project, Room, Side } from '../model/schema';
import { isEnclosed, isOutdoor } from '../model/schema';
import { type ResolvedOpening, type RoomEdge, resolveOpenings, roomEdges } from '../geometry/openings';
import { type Box, type MultiPoly, type Ring, boxMulti, decomposeRects, multiArea, multiBox, ringArea, ringBox, roomRing, union } from '../geometry/polygon';
import { type RoofLevelInput, type RoofResult, buildRoof, roofPeak } from '../geometry/roof';
import { type ResolvedStair, resolveStair } from '../geometry/stairs';
import { type WallSeg, deriveWalls, enclosedFootprint } from '../geometry/walls';

export const FLOOR_STRUCTURE = 1;
export const PLATE_ABOVE_CEILING = 0.25;

export function foundationHeight(f: Project['style']['foundation']) {
  return f === 'slab' ? 0.67 : f === 'stone_plinth' ? 2.5 : 2;
}

export interface RoomInfo {
  room: Room;
  ring: Ring;
  box: Box;
  /** Centerline area (what the plan dimensions add up to). */
  area: number;
  /** Clear interior width/depth of the bounding box, inside the wall faces. */
  clearW: number;
  clearD: number;
  /** Net floor area inside the walls (approximate for non-rect rooms). */
  netArea: number;
  edges: RoomEdge[];
  /** Thickness of the wall on each side (0 when open). */
  sideWall: Record<Side, number>;
}

export interface ResolvedLevel {
  level: Level;
  index: number;
  /** Height of this floor above grade. */
  elevation: number;
  /** Floor of this level to floor of the next. */
  floorToFloor: number;
  /** Absolute height where walls stop and the roof bears (or the next floor sits). */
  plate: number;
  walls: WallSeg[];
  openings: ResolvedOpening[];
  stairs: ResolvedStair[];
  /** Outside-face footprint of the enclosed rooms. */
  footprint: MultiPoly;
  rooms: Map<string, RoomInfo>;
  /** Holes in this floor for stairs climbing from the level below. */
  stairHoles: ResolvedStair[];
  /** Index of the level whose roof covers this one (a loft sits under the roof of the level below). */
  roofLevel: number;
  /** The level above, unless it is a loft inside this level's roof. */
  hasFloorAbove: boolean;
}

export interface Resolved {
  project: Project;
  levels: ResolvedLevel[];
  roof: RoofResult;
  issues: Issue[];
  foundation: number;
  /** Total heated area: outside faces of enclosed rooms (porches/garages excluded). */
  grossArea: number;
  bounds: Box;
  peak: number;
}

export function resolve(project: Project): Resolved {
  const issues: Issue[] = [];
  const foundation = foundationHeight(project.style.foundation);
  const levels: ResolvedLevel[] = [];
  let elevation = foundation;

  project.levels.forEach((level, index) => {
    const height = level.kind === 'half' ? level.kneeWall : level.ceiling;
    const floorToFloor = level.ceiling + FLOOR_STRUCTURE;
    const loftOver = level.kind === 'loft' && index > 0 ? levels[index - 1] : undefined;
    const { walls, issues: bIssues } = deriveWalls({ level, levelIndex: index, floorAboveGrade: elevation, style: project.style, loftOver: loftOver?.footprint });
    for (const b of bIssues) {
      const [a, c] = b.rooms;
      const na = level.rooms.find((r) => r.id === a)?.name ?? a;
      const nc = level.rooms.find((r) => r.id === c)?.name ?? c;
      issues.push({ rule: 'geo.overlap', severity: 'error', message: `${na} and ${nc} overlap.`, level: level.id, ids: [a, c] });
    }
    const { openings, issues: oIssues } = resolveOpenings(level, walls);
    issues.push(...oIssues);
    const footprint = enclosedFootprint(level, walls);
    const rooms = new Map<string, RoomInfo>();
    for (const room of level.rooms) rooms.set(room.id, roomInfo(room, walls));
    levels.push({
      level,
      index,
      elevation,
      floorToFloor,
      plate: elevation + height + PLATE_ABOVE_CEILING,
      walls,
      openings,
      stairs: [],
      footprint,
      rooms,
      stairHoles: [],
      roofLevel: loftOver ? loftOver.roofLevel : index,
      hasFloorAbove: false,
    });
    elevation += floorToFloor;
  });

  levels.forEach((rl, i) => {
    rl.hasFloorAbove = !!levels[i + 1] && levels[i + 1].level.kind !== 'loft';
  });

  // Stairs need the floor-to-floor height and the level above.
  levels.forEach((rl, i) => {
    for (const s of rl.level.stairs) {
      if (i === levels.length - 1) {
        issues.push({ rule: 'stair.no_level_above', severity: 'warning', message: `The stairs in ${rl.rooms.get(s.room)?.room.name ?? 'a room'} on ${rl.level.name} lead nowhere: there's no floor above.`, level: rl.level.id, ids: [s.id], fix: [{ op: 'remove_stairs', stairs: s.id }] });
        continue;
      }
      const { stair, issues: sIssues } = resolveStair(s, rl.level, rl.floorToFloor);
      issues.push(...sIssues);
      if (stair) {
        rl.stairs.push(stair);
        levels[i + 1].stairHoles.push(stair);
      }
    }
  });

  // Roof
  const roofInputs: RoofLevelInput[] = levels.map((rl, i) => {
    const above = levels[i + 1];
    const porches = rl.level.rooms
      .filter((r) => isOutdoor(r.type) && r.covered && r.type !== 'deck' && r.type !== 'patio')
      .flatMap((r) => {
        const ring = roomRing(r);
        const boxes = r.rect ? [ringBox(ring)] : decomposeRects([[ring]]);
        return boxes.map((box, k) => ({ id: boxes.length > 1 ? `${r.id}_${k}` : r.id, box, floor: rl.elevation - 0.33 }));
      });
    const isLoft = rl.level.kind === 'loft' && i > 0;
    return {
      index: i,
      footprint: isLoft ? [] : rl.footprint,
      upper: rl.hasFloorAbove ? above.footprint : null,
      upperFloor: rl.hasFloorAbove ? above.elevation : null,
      plate: rl.plate,
      porches,
    };
  });
  const roof = buildRoof(roofInputs, project.roof, project.site.front);

  const allFoot = union(...levels.map((l) => l.footprint), ...levels.flatMap((l) => l.level.rooms.filter((r) => isOutdoor(r.type)).map((r) => [[roomRing(r)]] as MultiPoly)));
  const bounds = allFoot.length ? multiBox(allFoot) : { x0: 0, y0: 0, x1: 1, y1: 1 };
  const grossArea = levels.reduce((s, l) => {
    const heated = l.level.rooms.filter((r) => isEnclosed(r.type) && r.type !== 'garage');
    const garage = l.level.rooms.filter((r) => r.type === 'garage');
    const garageArea = garage.reduce((g, r) => g + Math.abs(ringArea(roomRing(r))), 0);
    return s + (heated.length ? Math.max(0, multiArea(l.footprint) - garageArea) : 0);
  }, 0);

  return { project, levels, roof, issues, foundation, grossArea, bounds, peak: Math.max(roofPeak(roof), ...levels.map((l) => l.plate)) };
}

function roomInfo(room: Room, walls: WallSeg[]): RoomInfo {
  const ring = roomRing(room);
  const box = ringBox(ring);
  const edges = roomEdges(room);
  const sideWall: Record<Side, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const e of edges) {
    for (const w of walls) {
      if (w.axis !== e.axis || Math.abs(w.coord - e.coord) > 1e-6) continue;
      if (Math.min(e.b, w.b) - Math.max(e.a, w.a) <= 1e-6) continue;
      if (w.kind === 'exterior' || w.kind === 'interior') sideWall[e.side] = Math.max(sideWall[e.side], w.thickness);
    }
  }
  const area = Math.abs(ringArea(ring));
  const clearW = box.x1 - box.x0 - sideWall.W / 2 - sideWall.E / 2;
  const clearD = box.y1 - box.y0 - sideWall.S / 2 - sideWall.N / 2;
  const perimeterLoss = edges.reduce((s, e) => s + ((e.b - e.a) * sideWall[e.side]) / 2, 0);
  return { room, ring, box, area, clearW, clearD, netArea: Math.max(0, area - perimeterLoss), edges, sideWall };
}

/** Find which room on a level contains a plan point. */
export function roomAt(rl: ResolvedLevel, x: number, y: number): RoomInfo | undefined {
  for (const info of rl.rooms.values()) {
    const b = info.box;
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    if (info.room.rect || pointIn(info.ring, x, y)) return info;
  }
  return undefined;
}

function pointIn(ring: Ring, x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const boxOf = (b: Box) => boxMulti(b);
