import type { OpeningType, RoomType } from '../model/schema';

export interface OpeningDefaults {
  width: number;
  height: number;
  sill: number;
}

/** Standard residential sizes (feet). */
export function openingDefaults(type: OpeningType, ctx: { exterior: boolean; hostType?: RoomType; otherType?: RoomType }): OpeningDefaults {
  const bathish = (t?: RoomType) => t === 'bath' || t === 'half_bath' || t === 'closet' || t === 'pantry' || t === 'laundry';
  switch (type) {
    case 'door':
      if (ctx.exterior) return { width: 3, height: 6.67, sill: 0 };
      return { width: bathish(ctx.hostType) || bathish(ctx.otherType) ? 2.5 : 2.67, height: 6.67, sill: 0 };
    case 'double_door':
      return { width: 5, height: 6.67, sill: 0 };
    case 'french_door':
      return { width: 5, height: 6.67, sill: 0 };
    case 'slider':
      return { width: 6, height: 6.67, sill: 0 };
    case 'pocket_door':
      return { width: 2.5, height: 6.67, sill: 0 };
    case 'garage_door':
      return { width: 9, height: 7, sill: 0 };
    case 'cased_opening':
      return { width: 4, height: 7, sill: 0 };
    case 'open':
      return { width: 0, height: 0, sill: 0 };
    case 'picture_window':
      return { width: 6, height: 5, sill: 2 };
    case 'transom':
      return { width: 3, height: 1.25, sill: 7 };
    case 'window':
    default:
      if (ctx.hostType === 'bath' || ctx.hostType === 'half_bath') return { width: 2.5, height: 3, sill: 4 };
      if (ctx.hostType === 'kitchen') return { width: 3, height: 3.5, sill: 3.5 };
      return { width: 3, height: 5, sill: 2.5 };
  }
}

/** Gap between ganged units (mullion). */
export const MULLION = 0.25;
