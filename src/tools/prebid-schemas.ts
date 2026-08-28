import { z } from 'zod/v4';

import { idSchema, networkCodeSchema } from './read-schemas.js';

const sourceShape = {
  config: z.unknown().optional(),
  filePath: z.string().trim().min(1).max(4_096).optional(),
};

function exactlyOneSource(value: { config?: unknown; filePath?: string | undefined }): boolean {
  return (value.config === undefined) !== (value.filePath === undefined);
}

export const prebidSourceInputSchema = z
  .object(sourceShape)
  .strict()
  .refine(exactlyOneSource, { message: 'Provide exactly one of config or filePath.' });

export const prebidOrderInputSchema = z
  .object({
    ...sourceShape,
    networkCode: networkCodeSchema,
    orderId: idSchema,
    simultaneousAdUnits: z.number().int().min(1).max(100).default(1),
  })
  .strict()
  .refine(exactlyOneSource, { message: 'Provide exactly one of config or filePath.' });

export type PrebidSourceInput = z.infer<typeof prebidSourceInputSchema>;
export type PrebidOrderInput = z.infer<typeof prebidOrderInputSchema>;
