import { z } from 'zod/v4';

import { PREBID_TARGETING_KEYS } from './models.js';

const customBucketSchema = z
  .object({
    min: z.number().finite().min(0).optional(),
    max: z.number().finite().positive(),
    increment: z.number().finite().positive(),
    precision: z.number().int().min(0).max(6).optional(),
  })
  .strict();

export const customGranularitySchema = z
  .object({ buckets: z.array(customBucketSchema).min(1).max(100) })
  .strict()
  .superRefine((value, context) => {
    let previousMax = 0;
    value.buckets.forEach((bucket, index) => {
      if (bucket.max <= previousMax) {
        context.addIssue({
          code: 'custom',
          path: ['buckets', index, 'max'],
          message: 'Bucket max values must be strictly increasing.',
        });
      }
      if (bucket.min !== undefined && Math.abs(bucket.min - previousMax) > 1e-10) {
        context.addIssue({
          code: 'custom',
          path: ['buckets', index, 'min'],
          message: `Prebid derives this min from the previous max (${previousMax}).`,
        });
      }
      previousMax = bucket.max;
    });
  });

const targetingKeySchema = z.enum(PREBID_TARGETING_KEYS);

const currencySchema = z.union([
  z.string().trim().length(3),
  z.looseObject({ adServerCurrency: z.string().trim().length(3).optional() }),
]);

export const prebidConfigSchema = z.looseObject({
  priceGranularity: z
    .union([z.enum(['low', 'medium', 'high', 'auto', 'dense']), customGranularitySchema])
    .optional(),
  currency: currencySchema.optional(),
  targetingKeys: z.array(targetingKeySchema).min(1).optional(),
  bidderSettings: z.unknown().optional(),
  universalCreative: z
    .object({
      enabled: z.boolean().optional(),
      require1x1: z.boolean().optional(),
      expectedSizes: z
        .array(z.string().regex(/^\d+x\d+$/))
        .max(100)
        .optional(),
    })
    .strict()
    .optional(),
});

export type RawPrebidConfig = z.infer<typeof prebidConfigSchema>;
