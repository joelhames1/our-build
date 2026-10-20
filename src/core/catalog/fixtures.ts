/**
 * Furniture and fixtures: standard residential sizes in feet (width along the wall, depth out
 * from it, height), clear space wanted in front, and the "next size" ladder for "make it bigger".
 */
export interface FixtureSpec {
  kind: string;
  label: string;
  w: number;
  d: number;
  h: number;
  /** Clear floor wanted in front (the side away from the wall). */
  front: number;
  /** Sits against a wall (true) or floats in the room. */
  wall: boolean;
  bigger?: string;
  smaller?: string;
  /** Collides with people walking (false for rugs). */
  solid?: boolean;
}

const F = (kind: string, label: string, w: number, d: number, h: number, front: number, wall = true, extra: Partial<FixtureSpec> = {}): FixtureSpec => ({ kind, label, w, d, h, front, wall, solid: true, ...extra });

export const FIXTURES: Record<string, FixtureSpec> = Object.fromEntries(
  [
    // Bedroom
    F('bed_twin', 'twin bed', 3.25, 6.6, 2, 2.5, true, { bigger: 'bed_full' }),
    F('bed_full', 'full bed', 4.5, 6.6, 2, 2.5, true, { bigger: 'bed_queen', smaller: 'bed_twin' }),
    F('bed_queen', 'queen bed', 5, 6.9, 2, 2.5, true, { bigger: 'bed_king', smaller: 'bed_full' }),
    F('bed_king', 'king bed', 6.6, 6.9, 2, 2.5, true, { smaller: 'bed_queen' }),
    F('bunk_bed', 'bunk bed', 3.5, 6.8, 5.5, 2.5),
    F('crib', 'crib', 2.5, 4.5, 3, 2),
    F('nightstand', 'nightstand', 1.75, 1.5, 2, 0),
    F('dresser', 'dresser', 5, 1.6, 2.8, 3),
    F('wardrobe', 'wardrobe', 4, 2, 6.5, 3),
    // Living
    F('sofa', 'sofa', 7.5, 3.1, 2.7, 1.5, true, { bigger: 'sectional', smaller: 'loveseat' }),
    F('loveseat', 'loveseat', 5.5, 3, 2.7, 1.5, true, { bigger: 'sofa' }),
    F('sectional', 'sectional', 9.5, 6.5, 2.7, 1.5, true, { smaller: 'sofa' }),
    F('armchair', 'armchair', 2.9, 3, 2.7, 1.5, false),
    F('coffee_table', 'coffee table', 4, 2, 1.4, 1.5, false),
    F('side_table', 'side table', 1.6, 1.6, 2, 0, false),
    F('tv_console', 'media console', 6, 1.6, 2, 6),
    F('bookshelf', 'bookshelf', 3, 1.2, 6.5, 2.5),
    F('fireplace', 'fireplace', 5.5, 2, 4.5, 3),
    F('piano', 'piano', 5, 2.2, 4, 3),
    F('rug', 'rug', 8, 10, 0.03, 0, false, { solid: false, bigger: 'rug_large' }),
    F('rug_large', 'large rug', 9, 12, 0.03, 0, false, { solid: false, smaller: 'rug' }),
    F('floor_lamp', 'floor lamp', 1.2, 1.2, 5.5, 0, false),
    F('plant', 'plant', 1.6, 1.6, 4, 0, false),
    // Dining
    F('dining_table', 'dining table', 6, 3.5, 2.5, 3, false, { bigger: 'dining_table_large', smaller: 'round_table' }),
    F('dining_table_large', 'large dining table', 8, 3.75, 2.5, 3, false, { smaller: 'dining_table' }),
    F('round_table', 'round table', 4, 4, 2.5, 3, false, { bigger: 'dining_table' }),
    F('dining_chair', 'dining chair', 1.6, 1.7, 3, 0, false),
    F('buffet', 'sideboard', 5.5, 1.7, 2.8, 3),
    // Kitchen (counters and appliances are placed by the kitchen layout)
    F('base_cabinet', 'base cabinets', 2, 2, 3, 3.5),
    F('upper_cabinet', 'upper cabinets', 2, 1.1, 2.5, 0),
    F('island', 'kitchen island', 6, 3, 3, 3.5, false),
    F('sink', 'sink', 2.75, 2, 3, 3.5),
    F('range', 'range', 2.5, 2.2, 3, 3.5),
    F('fridge', 'refrigerator', 3, 2.6, 6, 3.5),
    F('dishwasher', 'dishwasher', 2, 2, 3, 3.5),
    F('hood', 'range hood', 2.5, 1.6, 1.5, 0),
    F('pantry_cabinet', 'pantry cabinet', 3, 2, 7.5, 3),
    F('bar_stool', 'stool', 1.4, 1.4, 2.5, 0, false),
    // Bath
    F('toilet', 'toilet', 1.7, 2.4, 2.6, 1.75),
    F('vanity', 'vanity', 3, 1.8, 2.8, 2.5, true, { bigger: 'vanity_double' }),
    F('vanity_double', 'double vanity', 5.5, 1.8, 2.8, 2.5, true, { smaller: 'vanity' }),
    F('tub', 'bathtub', 5, 2.5, 1.7, 2.5),
    F('freestanding_tub', 'freestanding tub', 5.5, 2.6, 2, 2.5, false),
    F('shower', 'shower', 3.5, 3.5, 7, 2),
    F('tub_shower', 'tub/shower', 5, 2.6, 7, 2.5),
    // Utility
    F('washer', 'washer', 2.3, 2.3, 3.2, 3.5),
    F('dryer', 'dryer', 2.3, 2.3, 3.2, 3.5),
    F('utility_sink', 'utility sink', 2, 1.8, 3, 3),
    F('bench', 'bench', 4, 1.4, 1.5, 3),
    F('cubbies', 'cubbies', 5, 1.4, 6, 3),
    F('desk', 'desk', 4.5, 2.2, 2.5, 3, true, { bigger: 'desk_large' }),
    F('desk_large', 'large desk', 6, 2.6, 2.5, 3, true, { smaller: 'desk' }),
    F('office_chair', 'desk chair', 2, 2, 3.2, 0, false),
    F('workbench', 'workbench', 6, 2.2, 3, 3),
    F('car', 'car', 6.2, 15, 4.8, 2, false),
    F('treadmill', 'treadmill', 3, 6.5, 4.5, 2),
    // Outdoor
    F('rocking_chair', 'rocking chair', 2.2, 2.8, 3.3, 1.5, false),
    F('porch_swing', 'porch swing', 5, 2.2, 2, 3),
    F('outdoor_table', 'outdoor table', 5, 3, 2.4, 3, false),
    F('adirondack_chair', 'Adirondack chair', 2.6, 3, 3, 1.5, false),
    F('lounger', 'lounge chair', 2.4, 6.5, 1.3, 1.5, false),
    F('planter', 'planter', 2, 2, 2.5, 0, false),
    F('hot_tub', 'hot tub', 7, 7, 3, 3, false),
  ].map((f) => [f.kind, f]),
);

export const FIXTURE_KINDS = Object.keys(FIXTURES);

export const fixtureSpec = (kind: string): FixtureSpec => FIXTURES[kind] ?? F(kind, kind.replace(/_/g, ' '), 3, 2, 3, 2);
