/** Friendly one-liners for ops as they stream in. */
export function describeOp(raw: unknown): string | null {
  const o = raw as Record<string, unknown> & { op?: string };
  if (!o || typeof o.op !== 'string') return null;
  const name = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const rooms = Array.isArray(o.rooms) ? (o.rooms as { name?: string }[]).map((r) => r.name).filter(Boolean) : [];
  switch (o.op) {
    case 'use_template':
      return `Sketching a ${name('template').replace('_', ' ')} to start from…`;
    case 'set_style':
      return 'Choosing materials and colors…';
    case 'set_site':
      return 'Setting the scene around the house…';
    case 'set_roof':
      return 'Shaping the roof…';
    case 'add_level':
      return `Adding ${name('name') || 'a new floor'}…`;
    case 'remove_level':
      return 'Taking off a floor…';
    case 'add_room':
      return `Adding ${name('name') || 'a room'}…`;
    case 'add_wing':
      return rooms.length ? `Laying out a wing: ${rooms.join(', ')}…` : 'Adding a wing…';
    case 'layout_level':
      return 'Re-planning the floor…';
    case 'grow_level':
      return 'Giving the floor more room…';
    case 'resize_room':
      return 'Resizing the room…';
    case 'move_room':
    case 'swap_rooms':
      return 'Rearranging rooms…';
    case 'remove_room':
      return 'Removing a room…';
    case 'split_room':
      return 'Dividing the room…';
    case 'merge_rooms':
      return 'Opening rooms into one…';
    case 'add_opening':
      return `Adding a ${name('type').replace('_', ' ') || 'window'}…`;
    case 'update_opening':
      return 'Adjusting a door or window…';
    case 'set_kitchen':
      return 'Working on the kitchen…';
    case 'set_bath':
      return 'Working on the bath…';
    case 'add_fixture':
    case 'update_fixture':
    case 'furnish':
      return 'Arranging furniture…';
    case 'add_stairs':
    case 'update_stairs':
      return 'Placing the stairs…';
    default:
      return null;
  }
}
