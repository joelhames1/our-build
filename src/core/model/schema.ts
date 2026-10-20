import { z } from 'zod';

/**
 * The building model: the single source of truth for a design.
 *
 * Conventions (the AI reads and writes these exactly):
 * - All lengths are decimal feet. Feet-inches are for display only.
 * - Plan coordinates: x grows east, y grows north, z is up. Plan north is always +y.
 * - Rooms tile each level on wall centerlines: a room's rect runs to the middle of its walls.
 * - The origin is the SW corner of the first level's footprint; every level shares it.
 * - Sides are always N/E/S/W of the room being talked about.
 */

export const Ft = z.number();
export const Side = z.enum(['N', 'E', 'S', 'W']);
export type Side = z.infer<typeof Side>;

export const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .max(24);

export const Pt = z.tuple([Ft, Ft]);
export type Pt = z.infer<typeof Pt>;

/** [x, y, w, d]: SW corner, w along x (east), d along y (north). */
export const Rect = z.tuple([Ft, Ft, Ft, Ft]);
export type Rect = z.infer<typeof Rect>;

export const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const Align = z.enum(['center', 'start', 'end']);
export type Align = z.infer<typeof Align>;

export const ROOM_TYPES = [
  'living',
  'family',
  'great_room',
  'dining',
  'kitchen',
  'pantry',
  'bedroom',
  'primary_bedroom',
  'nursery',
  'bath',
  'half_bath',
  'closet',
  'walk_in_closet',
  'hall',
  'foyer',
  'stair_hall',
  'laundry',
  'mudroom',
  'office',
  'library',
  'studio',
  'loft',
  'bonus',
  'gym',
  'media',
  'garage',
  'workshop',
  'mechanical',
  'storage',
  'sunroom',
  'porch',
  'screened_porch',
  'deck',
  'patio',
  'balcony',
  'open_to_below',
] as const;
export const RoomType = z.enum(ROOM_TYPES);
export type RoomType = z.infer<typeof RoomType>;

export const FloorFinish = z.enum(['oak', 'walnut', 'pine', 'tile', 'stone', 'carpet', 'concrete']);
export type FloorFinish = z.infer<typeof FloorFinish>;

export const KitchenSpec = z.object({
  shape: z.enum(['single_wall', 'galley', 'L', 'U']).default('L'),
  /** Walls carrying cabinet runs, in order. Picked automatically when omitted. */
  walls: z.array(Side).max(3).optional(),
  island: z.boolean().default(false),
  islandSize: z.tuple([Ft, Ft]).optional(),
  sink: z.union([Side, z.literal('island')]).optional(),
  range: z.union([Side, z.literal('island')]).optional(),
  fridge: Side.optional(),
  seats: z.number().int().min(0).max(8).optional(),
});
export type KitchenSpec = z.infer<typeof KitchenSpec>;

export const BathSpec = z.object({
  bathing: z.enum(['tub_shower', 'shower', 'tub', 'tub_and_shower', 'none']).default('tub_shower'),
  vanity: z.enum(['single', 'double']).default('single'),
  /** The plumbing wall: toilet, tub and vanity line up here when possible. */
  wetWall: Side.optional(),
});
export type BathSpec = z.infer<typeof BathSpec>;

export const Room = z.object({
  id: Id,
  name: z.string(),
  type: RoomType,
  rect: Rect.optional(),
  /** Rectilinear outline, counter-clockwise. Use instead of rect for L-shaped rooms. */
  poly: z.array(Pt).min(4).optional(),
  ceiling: z.enum(['flat', 'vaulted']).default('flat'),
  floor: FloorFinish.optional(),
  wallColor: Hex.optional(),
  /** Outdoor rooms only: has a roof over it. */
  covered: z.boolean().optional(),
  kitchen: KitchenSpec.optional(),
  bath: BathSpec.optional(),
  furnish: z.enum(['auto', 'none']).default('auto'),
});
export type Room = z.infer<typeof Room>;

export const DOOR_TYPES = ['door', 'double_door', 'french_door', 'slider', 'pocket_door', 'garage_door'] as const;
export const WINDOW_TYPES = ['window', 'picture_window', 'transom'] as const;
export const OPENING_TYPES = [...DOOR_TYPES, 'cased_opening', 'open', ...WINDOW_TYPES] as const;
export const OpeningType = z.enum(OPENING_TYPES);
export type OpeningType = z.infer<typeof OpeningType>;

export const Opening = z.object({
  id: Id,
  type: OpeningType,
  /** Host room: the opening sits on one of this room's sides. */
  room: Id,
  side: Side.optional(),
  /** What is on the other side: a room id or 'outside'. */
  to: z.union([Id, z.literal('outside')]).optional(),
  align: Align.default('center'),
  /** Feet from the aligned point along the side (positive = toward east/north). */
  offset: Ft.default(0),
  width: Ft.optional(),
  height: Ft.optional(),
  sill: Ft.optional(),
  /** Ganged identical units side by side. */
  count: z.number().int().min(1).max(8).default(1),
  swing: z.enum(['auto', 'left', 'right', 'out_left', 'out_right']).default('auto'),
  style: z.string().optional(),
  /** Generated automatically; regenerated when the room changes until someone edits it. */
  auto: z.boolean().default(false),
});
export type Opening = z.infer<typeof Opening>;

export const Fixture = z.object({
  id: Id,
  /** Catalog key, e.g. 'bed_queen', 'sofa', 'toilet'. */
  kind: z.string(),
  room: Id,
  wall: Side.optional(),
  align: Align.default('center'),
  offset: Ft.default(0),
  /** Free-standing center point (plan coords) instead of a wall. */
  at: Pt.optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  /** [width, depth] override in feet. */
  size: z.tuple([Ft, Ft]).optional(),
  auto: z.boolean().default(false),
});
export type Fixture = z.infer<typeof Fixture>;

export const Stair = z.object({
  id: Id,
  /** The room the stair starts in; it always climbs to the next level up. */
  room: Id,
  shape: z.enum(['straight', 'L', 'U']).default('straight'),
  /** Direction of travel going up. */
  dir: Side,
  turn: z.enum(['left', 'right']).optional(),
  /** Against this wall of the room... */
  wall: Side.optional(),
  /** ...or with its bottom step's center at this point. */
  at: Pt.optional(),
  width: Ft.default(3.5),
});
export type Stair = z.infer<typeof Stair>;

export const Level = z.object({
  id: Id,
  name: z.string(),
  /**
   * 'half' = story-and-a-half: the roof sits on this level at the knee wall.
   * 'loft' = an open loft tucked inside the roof of the level below (A-frames, cabins).
   */
  kind: z.enum(['full', 'half', 'loft']).default('full'),
  ceiling: Ft.default(9),
  kneeWall: Ft.default(4),
  rooms: z.array(Room).default([]),
  openings: z.array(Opening).default([]),
  fixtures: z.array(Fixture).default([]),
  stairs: z.array(Stair).default([]),
  /** Ids of automatic doors/windows someone removed, so they are not added back. */
  suppress: z.array(z.string()).default([]),
});
export type Level = z.infer<typeof Level>;

export const RoofForm = z.enum(['gable', 'hip', 'shed', 'flat', 'gambrel']);
export type RoofForm = z.infer<typeof RoofForm>;

export const Roof = z.object({
  form: RoofForm.default('gable'),
  /** Rise per 12 of run. */
  pitch: z.number().min(0).max(30).default(8),
  ridge: z.enum(['auto', 'parallel_to_front', 'perpendicular_to_front']).default('auto'),
  /** Shed roofs: the low side. */
  low: Side.optional(),
  /** Roof over wings: match the main roof, or force a form. */
  wings: z.enum(['match', 'gable', 'hip']).default('match'),
  /** Roofs over lower levels where the level above is smaller. */
  lower: z.enum(['auto', 'shed', 'gable', 'hip']).default('auto'),
  porch: z.enum(['shed', 'hip', 'gable', 'flat']).default('shed'),
  porchPitch: z.number().min(0).max(12).default(4),
  overhang: Ft.default(1.5),
  rake: Ft.default(1),
  chimney: z.object({ room: Id, side: Side }).nullable().default(null),
});
export type Roof = z.infer<typeof Roof>;

export const WallMaterial = z.enum([
  'lap_siding',
  'board_and_batten',
  'shingle',
  'vertical_wood',
  'stucco',
  'brick',
  'stone',
  'log',
  'panel',
]);
export type WallMaterial = z.infer<typeof WallMaterial>;

export const RoofMaterial = z.enum(['asphalt', 'cedar_shake', 'standing_seam', 'slate', 'clay_tile', 'membrane']);
export type RoofMaterial = z.infer<typeof RoofMaterial>;

export const Style = z.object({
  preset: z.string().optional(),
  wall: WallMaterial.default('lap_siding'),
  wallColor: Hex.default('#e9e4da'),
  trimColor: Hex.default('#fbfaf6'),
  doorColor: Hex.default('#3f5a4c'),
  roofMaterial: RoofMaterial.default('asphalt'),
  roofColor: Hex.default('#4a4a4f'),
  windows: z.enum(['double_hung', 'casement', 'modern']).default('double_hung'),
  grilles: z.enum(['none', 'colonial', 'prairie', 'cottage']).default('none'),
  windowColor: Hex.default('#f4f2ec'),
  interiorWall: Hex.default('#f3efe7'),
  floor: FloorFinish.default('oak'),
  foundation: z.enum(['slab', 'crawl', 'stone_plinth']).default('crawl'),
});
export type Style = z.infer<typeof Style>;

export const Site = z.object({
  setting: z.enum(['meadow', 'forest', 'lakefront', 'island', 'coast', 'mountain', 'suburban', 'desert']).default('meadow'),
  /** The side the approach and front door face. */
  front: Side.default('S'),
  /** Sides that look at water. */
  water: z.array(Side).default([]),
  /** Rotation of plan north from true north, degrees (for the sun). */
  northDeg: z.number().default(0),
  latitude: z.number().min(-66).max(66).default(42),
  trees: z.enum(['none', 'few', 'many']).default('few'),
  ground: z.enum(['grass', 'meadow', 'rock', 'sand', 'snow']).default('grass'),
});
export type Site = z.infer<typeof Site>;

export const Project = z.object({
  v: z.literal(1),
  name: z.string(),
  /** The original description, kept so every later request remembers it. */
  brief: z.string().default(''),
  /** Durable preferences picked up along the way ("loves stone", "kitchen faces the water"). */
  notes: z.array(z.string()).default([]),
  site: Site,
  style: Style,
  roof: Roof,
  /** Bottom to top. */
  levels: z.array(Level).min(1),
});
export type Project = z.infer<typeof Project>;
export type ProjectInput = z.input<typeof Project>;

export const OUTDOOR_TYPES: ReadonlySet<RoomType> = new Set(['porch', 'screened_porch', 'deck', 'patio', 'balcony']);
export const isOutdoor = (t: RoomType) => OUTDOOR_TYPES.has(t);
export const isVoid = (t: RoomType) => t === 'open_to_below';
export const isEnclosed = (t: RoomType) => !isOutdoor(t) && !isVoid(t);

export const PRIVATE_TYPES: ReadonlySet<RoomType> = new Set([
  'bedroom',
  'primary_bedroom',
  'nursery',
  'bath',
  'half_bath',
  'closet',
  'walk_in_closet',
  'laundry',
  'mechanical',
  'storage',
  'pantry',
]);

export const HABITABLE_TYPES: ReadonlySet<RoomType> = new Set([
  'living',
  'family',
  'great_room',
  'dining',
  'kitchen',
  'bedroom',
  'primary_bedroom',
  'nursery',
  'office',
  'library',
  'studio',
  'loft',
  'bonus',
  'gym',
  'media',
  'sunroom',
]);

export const BEDROOM_TYPES: ReadonlySet<RoomType> = new Set(['bedroom', 'primary_bedroom', 'nursery']);

export const isDoorType = (t: OpeningType) => (DOOR_TYPES as readonly string[]).includes(t);
export const isWindowType = (t: OpeningType) => (WINDOW_TYPES as readonly string[]).includes(t);
export const isPassable = (t: OpeningType) => isDoorType(t) || t === 'cased_opening' || t === 'open';

export function parseProject(input: unknown): Project {
  return Project.parse(input);
}
