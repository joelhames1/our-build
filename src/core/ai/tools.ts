import { z } from 'zod';
import { ApplyChangesInput } from '../ops/schema';

const strip = (s: Record<string, unknown>) => {
  const { $schema: _drop, ...rest } = s;
  return rest;
};

export const APPLY_CHANGES = {
  name: 'apply_changes',
  description:
    'Apply a batch of operations to the design. The batch is atomic: if any op fails, nothing changes and you get the error. On success you get the updated design summary, what changed, any automatic fixes, and current issues.',
  input_schema: strip(z.toJSONSchema(ApplyChangesInput, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>),
};

export const InspectInput = z.object({
  ids: z.array(z.string()).max(20).optional().describe('room, opening, fixture or stairs ids'),
  level: z.string().optional().describe('a level id to list everything on it'),
});

export const INSPECT = {
  name: 'inspect',
  description: 'Look up full details (exact geometry, wall spans, free wall lengths, fixture positions) for elements or a level. Read-only.',
  input_schema: strip(z.toJSONSchema(InspectInput, { io: 'input' }) as Record<string, unknown>),
};
