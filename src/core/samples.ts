import { type Project, type ProjectInput, parseProject } from './model/schema';

/** Hand-built houses used by tests and as a visual sanity gallery. */

const base = (name: string, levels: ProjectInput['levels'], extra: Partial<ProjectInput> = {}): Project =>
  parseProject({
    v: 1,
    name,
    site: { setting: 'meadow', front: 'S' },
    style: {},
    roof: {},
    levels,
    ...extra,
  });

export const sampleCottage = () =>
  base(
    'Lake Cottage',
    [
      {
        id: 'L1',
        name: 'Main Floor',
        rooms: [
          { id: 'r1', name: 'Living', type: 'living', rect: [0, 0, 18, 14] },
          { id: 'r2', name: 'Dining', type: 'dining', rect: [18, 0, 14, 10] },
          { id: 'r3', name: 'Kitchen', type: 'kitchen', rect: [18, 10, 14, 14], kitchen: { shape: 'L', island: false } },
          { id: 'r4', name: 'Bedroom', type: 'bedroom', rect: [0, 14, 12, 10] },
          { id: 'r5', name: 'Bath', type: 'bath', rect: [12, 14, 6, 10], bath: { bathing: 'tub_shower' } },
          { id: 'r6', name: 'Front Porch', type: 'porch', rect: [0, -8, 32, 8], covered: true },
        ],
        openings: [
          { id: 'd1', type: 'door', room: 'r1', side: 'S', to: 'r6', align: 'start', offset: 4 },
          { id: 'o1', type: 'open', room: 'r1', to: 'r2' },
          { id: 'o2', type: 'cased_opening', room: 'r2', to: 'r3', width: 6 },
          { id: 'd2', type: 'door', room: 'r4', to: 'r1' },
          { id: 'd3', type: 'door', room: 'r5', to: 'r1' },
          { id: 'd4', type: 'door', room: 'r3', side: 'N', to: 'outside', align: 'end', offset: 2 },
          { id: 'w1', type: 'window', room: 'r1', side: 'S', align: 'end', offset: 3, count: 2 },
          { id: 'w2', type: 'window', room: 'r1', side: 'W', count: 2 },
          { id: 'w3', type: 'window', room: 'r2', side: 'S', count: 2 },
          { id: 'w4', type: 'window', room: 'r2', side: 'E' },
          { id: 'w5', type: 'window', room: 'r3', side: 'E', width: 4 },
          { id: 'w6', type: 'window', room: 'r4', side: 'N' },
          { id: 'w7', type: 'window', room: 'r4', side: 'W' },
          { id: 'w8', type: 'window', room: 'r5', side: 'N' },
        ],
      },
    ],
    { style: { wall: 'shingle', wallColor: '#c9c2b4', roofMaterial: 'cedar_shake' }, roof: { form: 'gable', pitch: 9 } },
  );

export const sampleL = () =>
  base('L Ranch', [
    {
      id: 'L1',
      name: 'Main Floor',
      rooms: [
        { id: 'r1', name: 'Great Room', type: 'great_room', rect: [0, 0, 24, 20] },
        { id: 'r2', name: 'Kitchen', type: 'kitchen', rect: [24, 0, 16, 20] },
        { id: 'r3', name: 'Bedroom', type: 'bedroom', rect: [24, 20, 16, 14] },
      ],
      openings: [
        { id: 'd1', type: 'door', room: 'r1', side: 'S', to: 'outside' },
        { id: 'o1', type: 'open', room: 'r1', to: 'r2' },
        { id: 'd2', type: 'door', room: 'r3', to: 'r2' },
        { id: 'w1', type: 'window', room: 'r1', side: 'W', count: 2 },
        { id: 'w2', type: 'window', room: 'r3', side: 'N', count: 2 },
      ],
    },
  ]);

export const sampleT = () =>
  base(
    'T House',
    [
      {
        id: 'L1',
        name: 'Main Floor',
        rooms: [
          { id: 'r1', name: 'Living', type: 'living', rect: [0, 0, 40, 22] },
          { id: 'r2', name: 'Bedroom', type: 'bedroom', rect: [14, 22, 14, 16] },
        ],
        openings: [{ id: 'd1', type: 'door', room: 'r2', to: 'r1' }],
      },
    ],
    { roof: { form: 'hip', pitch: 7 } },
  );

export const sampleU = () =>
  base('U Courtyard', [
    {
      id: 'L1',
      name: 'Main Floor',
      rooms: [
        { id: 'r1', name: 'Living', type: 'living', rect: [0, 0, 44, 20] },
        { id: 'r2', name: 'West Wing', type: 'bedroom', rect: [0, 20, 14, 18] },
        { id: 'r3', name: 'East Wing', type: 'office', rect: [30, 20, 14, 18] },
      ],
      openings: [
        { id: 'd1', type: 'door', room: 'r2', to: 'r1' },
        { id: 'd2', type: 'door', room: 'r3', to: 'r1' },
      ],
    },
  ]);

export const sampleFarmhouse = () =>
  base(
    'Farmhouse',
    [
      {
        id: 'L1',
        name: 'Main Floor',
        rooms: [
          { id: 'r1', name: 'Living', type: 'living', rect: [0, 0, 18, 16] },
          { id: 'r2', name: 'Foyer', type: 'stair_hall', rect: [18, 0, 8, 16] },
          { id: 'r3', name: 'Dining', type: 'dining', rect: [26, 0, 14, 16] },
          { id: 'r4', name: 'Kitchen', type: 'kitchen', rect: [18, 16, 22, 12] },
          { id: 'r5', name: 'Family', type: 'family', rect: [0, 16, 18, 12] },
          { id: 'r6', name: 'Mudroom', type: 'mudroom', rect: [40, 16, 10, 12] },
          { id: 'r7', name: 'Porch', type: 'porch', rect: [0, -8, 48, 8], covered: true },
          { id: 'r8', name: 'Side Porch', type: 'porch', rect: [40, 0, 8, 16], covered: true },
        ],
        openings: [
          { id: 'd1', type: 'door', room: 'r2', side: 'S', to: 'r7' },
          { id: 'o1', type: 'cased_opening', room: 'r1', to: 'r2', width: 5 },
          { id: 'o2', type: 'cased_opening', room: 'r3', to: 'r2', width: 5 },
          { id: 'o3', type: 'open', room: 'r4', to: 'r5' },
          { id: 'd2', type: 'door', room: 'r4', to: 'r2' },
          { id: 'd3', type: 'door', room: 'r6', to: 'r4' },
          { id: 'd4', type: 'door', room: 'r6', side: 'E', to: 'outside' },
          { id: 'w1', type: 'window', room: 'r1', side: 'S', count: 2 },
          { id: 'w2', type: 'window', room: 'r3', side: 'S', count: 2 },
          { id: 'w3', type: 'window', room: 'r1', side: 'W' },
          { id: 'w4', type: 'window', room: 'r5', side: 'W' },
          { id: 'w5', type: 'window', room: 'r4', side: 'N', width: 4 },
        ],
        stairs: [{ id: 'st1', room: 'r2', shape: 'straight', dir: 'N', wall: 'W' }],
      },
      {
        id: 'L2',
        name: 'Upper Floor',
        rooms: [
          { id: 'r10', name: 'Bedroom 2', type: 'bedroom', rect: [0, 0, 18, 14] },
          { id: 'r11', name: 'Hall', type: 'hall', rect: [18, 0, 8, 28] },
          { id: 'r12', name: 'Primary Bedroom', type: 'primary_bedroom', rect: [26, 0, 14, 16] },
          { id: 'r13', name: 'Bedroom 3', type: 'bedroom', rect: [0, 14, 18, 14] },
          { id: 'r14', name: 'Bath', type: 'bath', rect: [26, 16, 14, 12] },
        ],
        openings: [
          { id: 'd10', type: 'door', room: 'r10', to: 'r11' },
          { id: 'd11', type: 'door', room: 'r12', to: 'r11' },
          { id: 'd12', type: 'door', room: 'r13', to: 'r11' },
          { id: 'd13', type: 'door', room: 'r14', to: 'r11' },
          { id: 'w10', type: 'window', room: 'r10', side: 'S', count: 2 },
          { id: 'w11', type: 'window', room: 'r12', side: 'S', count: 2 },
          { id: 'w12', type: 'window', room: 'r13', side: 'N' },
          { id: 'w13', type: 'window', room: 'r14', side: 'N' },
          { id: 'w14', type: 'window', room: 'r11', side: 'S' },
        ],
      },
    ],
    { style: { wall: 'board_and_batten', wallColor: '#f2f0ea', roofMaterial: 'standing_seam', roofColor: '#2f3236' }, roof: { form: 'gable', pitch: 10 } },
  );

export const sampleCapeCod = () =>
  base(
    'Cape Cod',
    [
      {
        id: 'L1',
        name: 'Main Floor',
        rooms: [
          { id: 'r1', name: 'Living', type: 'living', rect: [0, 0, 16, 26] },
          { id: 'r2', name: 'Stair Hall', type: 'stair_hall', rect: [16, 0, 8, 26] },
          { id: 'r3', name: 'Kitchen', type: 'kitchen', rect: [24, 0, 16, 26] },
        ],
        openings: [
          { id: 'd1', type: 'door', room: 'r2', side: 'S', to: 'outside' },
          { id: 'o1', type: 'cased_opening', room: 'r1', to: 'r2', width: 5 },
          { id: 'o2', type: 'cased_opening', room: 'r3', to: 'r2', width: 5 },
          { id: 'w1', type: 'window', room: 'r1', side: 'S', count: 2 },
          { id: 'w2', type: 'window', room: 'r3', side: 'S', count: 2 },
        ],
        stairs: [{ id: 'st1', room: 'r2', shape: 'straight', dir: 'N', wall: 'E' }],
      },
      {
        id: 'L2',
        name: 'Upper Floor',
        kind: 'half',
        kneeWall: 3,
        ceiling: 8,
        rooms: [
          { id: 'r10', name: 'Bedroom', type: 'bedroom', rect: [0, 0, 16, 26] },
          { id: 'r11', name: 'Hall', type: 'hall', rect: [16, 0, 8, 26] },
          { id: 'r12', name: 'Bedroom 2', type: 'bedroom', rect: [24, 0, 16, 26] },
        ],
        openings: [
          { id: 'd10', type: 'door', room: 'r10', to: 'r11' },
          { id: 'd11', type: 'door', room: 'r12', to: 'r11' },
          { id: 'w10', type: 'window', room: 'r10', side: 'W', count: 2 },
          { id: 'w11', type: 'window', room: 'r12', side: 'E', count: 2 },
        ],
      },
    ],
    { roof: { form: 'gable', pitch: 12, ridge: 'parallel_to_front' }, style: { wall: 'shingle', wallColor: '#b9b2a4', trimColor: '#ffffff' } },
  );

export const SAMPLES = { sampleCottage, sampleL, sampleT, sampleU, sampleFarmhouse, sampleCapeCod };
