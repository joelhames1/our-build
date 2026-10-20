import { z } from 'zod';
import { Side } from '../model/schema';

export const TEMPLATE_IDS = [
  'cottage',
  'cape_cod',
  'farmhouse',
  'ranch',
  'bungalow',
  'a_frame',
  'modern',
  'lake_house',
  'tiny_house',
  'garage_studio',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TemplateParams = z.object({
  bedrooms: z.number().int().min(0).max(6).optional(),
  baths: z.number().min(0).max(5).optional().describe('full baths; .5 adds a powder room'),
  stories: z.enum(['1', '1.5', '2', '3']).optional(),
  area: z.number().min(150).max(8000).optional().describe('approximate heated sq ft'),
  openPlan: z.boolean().optional(),
  porch: z.enum(['none', 'front', 'back', 'wrap', 'screened']).optional(),
  garage: z.enum(['none', '1', '2']).optional(),
  primaryOn: z.enum(['main', 'upper']).optional(),
  front: Side.optional().describe('side the front door faces'),
  office: z.boolean().optional(),
  mudroom: z.boolean().optional(),
});
export type TemplateParams = z.infer<typeof TemplateParams>;
