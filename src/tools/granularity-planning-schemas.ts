import { z } from 'zod/v4';

import { customGranularitySchema } from '../prebid/config-schema.js';
import { idSchema, networkCodeSchema } from './read-schemas.js';

const currencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase());

const historicalDataSchema = z
  .object({
    bids: z.array(z.number().finite().min(0).max(1_000_000)).max(100_000).optional(),
    histogram: z
      .array(
        z
          .object({
            cpm: z.number().finite().min(0).max(1_000_000),
            count: z.number().int().min(1).max(10_000_000),
          })
          .strict(),
      )
      .max(100_000)
      .optional(),
    floorPrice: z.number().finite().min(0).max(1_000_000).optional(),
    currency: currencySchema.optional(),
  })
  .strict();

export const planningShape = {
  mode: z.enum(['standard', 'dense', 'auto', 'custom', 'recommend']),
  currency: currencySchema.default('USD'),
  standardGranularity: z.enum(['low', 'medium', 'high']).default('medium'),
  customGranularity: customGranularitySchema.optional(),
  historicalData: historicalDataSchema.optional(),
  maxLineItems: z.number().int().min(1).max(100_000).optional(),
  maximumAverageRoundingLoss: z.number().finite().min(0).optional(),
  operationalCostPerLineItem: z.number().finite().min(0).optional(),
  operationalCostCurrency: currencySchema.optional(),
  minimumHistoricalSamples: z.number().int().min(1).max(100_000).default(100),
};

function validateCustomMode(
  value: { mode: string; customGranularity?: unknown },
  context: z.RefinementCtx,
) {
  if (value.mode === 'custom' && value.customGranularity === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['customGranularity'],
      message: 'customGranularity is required in custom mode.',
    });
  }
}

export const prebidPlanGranularityInputSchema = z
  .object(planningShape)
  .strict()
  .superRefine(validateCustomMode);

export const prebidSimulateGranularityInputSchema = z
  .object({
    currency: currencySchema.default('USD'),
    alternatives: z
      .array(z.enum(['low', 'medium', 'high', 'auto', 'dense']))
      .min(1)
      .max(5)
      .default(['medium', 'dense', 'auto']),
    customAlternatives: z
      .array(
        z
          .object({
            name: z
              .string()
              .trim()
              .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
            granularity: customGranularitySchema,
          })
          .strict(),
      )
      .max(10)
      .default([]),
    historicalData: historicalDataSchema.optional(),
    maxLineItems: z.number().int().min(1).max(100_000).optional(),
    operationalCostPerLineItem: z.number().finite().min(0).optional(),
    operationalCostCurrency: currencySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const names = [...value.alternatives, ...value.customAlternatives.map((item) => item.name)];
    if (new Set(names).size !== names.length) {
      context.addIssue({ code: 'custom', message: 'Alternative names must be unique.' });
    }
  });

export const gamPlanPrebidGranularityInputSchema = z
  .object({
    ...planningShape,
    networkCode: networkCodeSchema,
    orderId: idSchema,
    lineItemTemplate: z
      .object({
        namePrefix: z.string().trim().min(1).max(128).default('Prebid'),
        priority: z.number().int().min(1).max(16).default(12),
        lineItemType: z
          .string()
          .trim()
          .regex(/^[A-Z][A-Z_]*$/)
          .default('PRICE_PRIORITY'),
        creativePlaceholderSizes: z
          .array(z.string().regex(/^\d+x\d+$/))
          .min(1)
          .max(100),
        simultaneousAdUnits: z.number().int().min(1).max(100).default(1),
      })
      .strict(),
  })
  .strict()
  .superRefine(validateCustomMode);

export type PrebidPlanGranularityInput = z.infer<typeof prebidPlanGranularityInputSchema>;
export type PrebidSimulateGranularityInput = z.infer<typeof prebidSimulateGranularityInputSchema>;
export type GamPlanPrebidGranularityInput = z.infer<typeof gamPlanPrebidGranularityInputSchema>;
