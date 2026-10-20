import { z } from 'zod';
import { Align, BathSpec, Fixture, Ft, Id, KitchenSpec, Level, Opening, OpeningType, Pt, Rect, Roof, RoomType, Side, Site, Stair, Style, FloorFinish, Hex } from '../model/schema';
import { TEMPLATE_IDS, TemplateParams } from '../templates/params';

/**
 * Every change to a design is an Op. The AI sends batches of ops; a batch applies atomically.
 * Keep descriptions short: they become the tool schema Claude reads.
 */

export const NewRoom = z.object({
  id: Id.optional(),
  name: z.string(),
  type: RoomType,
  area: z.number().positive().optional().describe('target square feet'),
  minWidth: Ft.optional(),
  kitchen: KitchenSpec.optional(),
  bath: BathSpec.optional(),
});
export type NewRoom = z.infer<typeof NewRoom>;

const LevelsSel = z.union([z.literal('all'), z.array(Id)]);

const op = <N extends string, S extends z.ZodRawShape>(name: N, shape: S, description: string) =>
  z.object({ op: z.literal(name), ...shape }).describe(description);

export const Op = z.discriminatedUnion('op', [
  op('use_template', { template: z.enum(TEMPLATE_IDS), params: TemplateParams.optional() }, 'Replace the building with a parametric starting plan (keeps site and notes).'),
  op('set_style', Style.partial().shape, 'Change exterior/interior style and materials.'),
  op('set_site', Site.partial().shape, 'Change the setting around the house.'),
  op('set_roof', Roof.partial().shape, 'Change the roof form, pitch, overhangs, porch roofs.'),
  op('set_name', { name: z.string() }, 'Rename the project.'),
  op('note', { add: z.string().optional(), remove: z.string().optional() }, 'Remember (or forget) a lasting preference.'),

  op(
    'add_level',
    {
      id: Id.optional(),
      name: z.string().optional(),
      kind: z.enum(['full', 'half', 'loft']).default('full'),
      footprint: z.enum(['same_as_below', 'empty']).default('same_as_below'),
      program: z.array(NewRoom).optional().describe('rooms to lay out along a hall from the stair landing'),
      stairs: z.enum(['extend', 'none']).default('extend'),
    },
    'Add a story on top.',
  ),
  op('update_level', { level: Id, name: z.string().optional(), kind: z.enum(['full', 'half', 'loft']).optional(), ceiling: Ft.optional(), kneeWall: Ft.optional() }, 'Change a level.'),
  op('remove_level', { level: Id }, 'Remove a level and everything on it.'),

  op(
    'add_room',
    {
      level: Id,
      ...NewRoom.shape,
      rect: Rect.optional(),
      poly: z.array(Pt).optional(),
      side: Side.optional().describe('without rect: attach outside this side of the house'),
      connectTo: Id.optional().describe('without rect: attach next to this room'),
      carve: z.boolean().default(false).describe('take the space from rooms it overlaps'),
    },
    'Add a room by rect, or by area next to a room/side.',
  ),
  op(
    'update_room',
    {
      room: Id,
      name: z.string().optional(),
      type: RoomType.optional(),
      rect: Rect.optional(),
      poly: z.array(Pt).optional(),
      ceiling: z.enum(['flat', 'vaulted']).optional(),
      floor: FloorFinish.optional(),
      wallColor: Hex.optional(),
      covered: z.boolean().optional(),
      furnish: z.enum(['auto', 'none']).optional(),
    },
    'Rename, retype, refinish or reshape a room.',
  ),
  op('resize_room', { room: Id, side: Side, by: Ft.describe('+grow / -shrink'), mode: z.enum(['take', 'push']).default('take') }, 'Move one side of a room. take: neighbors give/receive the space. push: everything beyond shifts.'),
  op('move_room', { room: Id, dx: Ft.default(0), dy: Ft.default(0) }, 'Shift a room; it carves space from rooms it lands on.'),
  op('stretch', { axis: z.enum(['x', 'y']), at: Ft, by: Ft, levels: LevelsSel.default('all') }, 'Everything at or beyond coordinate `at` shifts by `by` (keeps walls aligned).'),
  op('grow_level', { level: Id, addArea: z.number().describe('sq ft, negative to shrink'), axis: z.enum(['auto', 'x', 'y', 'both']).default('auto') }, 'Make a level bigger or smaller by stretching its living spaces.'),
  op(
    'add_wing',
    {
      level: Id,
      side: Side,
      rooms: z.array(NewRoom).min(1),
      area: z.number().optional(),
      depth: Ft.optional(),
      connectTo: Id.optional(),
      corridor: z.enum(['auto', 'yes', 'no']).default('auto'),
    },
    'Add a wing of new rooms outside one side of a level, laid out along a hall.',
  ),
  op('layout_level', { level: Id, rooms: z.array(NewRoom).min(1), keep: z.array(Id).default([]) }, 'Re-plan a level: lay out these rooms in its footprint around the stairs (keeps listed rooms).'),
  op('split_room', { room: Id, axis: z.enum(['x', 'y']), at: Ft, into: z.tuple([NewRoom, NewRoom]) }, 'Split a room with a wall at x=at (axis x) or y=at (axis y). First part is west/south.'),
  op('merge_rooms', { rooms: z.array(Id).min(2), into: NewRoom }, 'Merge adjoining rooms into one.'),
  op('swap_rooms', { a: Id, b: Id }, 'Swap two rooms: names, types, kitchens/baths and furniture trade places.'),
  op('remove_room', { room: Id, fill: z.enum(['outside', 'neighbor']).default('neighbor'), into: Id.optional() }, 'Remove a room; its space goes to a neighbor or becomes outside.'),

  op('add_opening', { ...Opening.omit({ id: true, auto: true }).shape, id: Id.optional() }, 'Add a door, window or opening on a side of a room.'),
  op('update_opening', { opening: Id, ...Opening.omit({ id: true, auto: true }).partial().shape }, 'Change a door/window (size, position, type, side).'),
  op('remove_opening', { opening: Id }, 'Remove a door/window/opening.'),

  op('set_kitchen', { room: Id, ...KitchenSpec.partial().shape, remove: z.boolean().optional() }, 'Set up or change a kitchen layout (sink/range/fridge placement, island).'),
  op('set_bath', { room: Id, ...BathSpec.partial().shape, remove: z.boolean().optional() }, 'Set up or change a bathroom.'),
  op('add_fixture', { ...Fixture.omit({ id: true, auto: true }).shape, id: Id.optional() }, 'Add furniture or a fixture from the catalog.'),
  op('update_fixture', { fixture: Id, ...Fixture.omit({ id: true, auto: true }).partial().shape }, 'Move/resize/swap a fixture.'),
  op('remove_fixture', { fixture: Id }, 'Remove a fixture.'),
  op('furnish', { room: Id, mode: z.enum(['auto', 'none']).default('auto') }, 'Re-furnish a room automatically, or clear its furniture.'),

  op('add_stairs', { ...Stair.omit({ id: true }).shape, id: Id.optional() }, 'Add stairs from a room to the level above.'),
  op('update_stairs', { stairs: Id, ...Stair.omit({ id: true }).partial().shape }, 'Change stairs.'),
  op('remove_stairs', { stairs: Id }, 'Remove stairs.'),
]);
export type Op = z.infer<typeof Op>;
export type OpInput = z.input<typeof Op>;

export const ApplyChangesInput = z.object({
  ops: z.array(Op).min(1).max(60),
  dryRun: z.boolean().default(false),
});

export { Align, Level, OpeningType };
