import { z } from 'zod/v4';

import { planningShape } from './granularity-planning-schemas.js';
import { idSchema, networkCodeSchema } from './read-schemas.js';

const lineItemTemplateSchema = z
  .object({
    namePrefix: z.string().trim().min(1).max(128).default('Prebid'),
    priority: z.number().int().min(1).max(16).default(12),
    lineItemType: z.literal('PRICE_PRIORITY').default('PRICE_PRIORITY'),
    creativePlaceholderSizes: z
      .array(z.string().regex(/^\d+x\d+$/))
      .min(1)
      .max(100),
    simultaneousAdUnits: z.number().int().min(1).max(100).default(1),
  })
  .strict();

const creativeSizeSchema = z
  .object({
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
  })
  .strict()
  .transform((value) => ({ ...value, canonicalName: `${value.width}x${value.height}` }));

const creativeStrategySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({ mode: z.literal('reuse'), creativeIds: z.array(idSchema).min(1).max(100) }).strict(),
  z.object({ mode: z.literal('clone'), sourceCreativeId: idSchema }).strict(),
  z
    .object({
      mode: z.literal('create'),
      template: z
        .object({
          namePrefix: z.string().trim().min(1).max(128),
          size: creativeSizeSchema,
          snippet: z.string().min(1).max(1_048_576),
          isSafeFrameCompatible: z.boolean().default(false),
        })
        .strict(),
    })
    .strict(),
]);

export const createGranularityPlanInputSchema = z
  .object({
    ...planningShape,
    networkCode: networkCodeSchema,
    orderId: idSchema,
    baseLineItemId: idSchema.optional(),
    lineItemTemplate: lineItemTemplateSchema,
    creativeStrategy: creativeStrategySchema.default({ mode: 'none' }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'custom' && value.customGranularity === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['customGranularity'],
        message: 'customGranularity is required in custom mode.',
      });
    }
  });

const planIdSchema = z.string().regex(/^prebid-apply:[a-f0-9]{16}$/);

export const validateGranularityPlanInputSchema = z.object({ planId: planIdSchema }).strict();
export const applyGranularityPlanInputSchema = z
  .object({ planId: planIdSchema, dryRun: z.boolean() })
  .strict();
export const postApplyAuditInputSchema = z.object({ planId: planIdSchema }).strict();

export type CreateGranularityPlanInput = z.infer<typeof createGranularityPlanInputSchema>;
export type ValidateGranularityPlanInput = z.infer<typeof validateGranularityPlanInputSchema>;
export type ApplyGranularityPlanInput = z.infer<typeof applyGranularityPlanInputSchema>;
export type PostApplyAuditInput = z.infer<typeof postApplyAuditInputSchema>;
