import { z } from 'zod/v4';

import { idSchema, networkCodeSchema } from './read-schemas.js';

const nameSchema = z.string().trim().min(1).max(255);
const optionalTextSchema = z.string().max(65_535).optional();
const enumLikeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z_]*$/);
const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const externalIdSchema = z.string().trim().min(1).max(255);

const sizeSchema = z
  .object({
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
    expectedCreativeCount: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .transform((value) => ({ ...value, canonicalName: `${value.width}x${value.height}` }));

const moneySchema = z
  .object({
    currencyCode: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    micros: z.string().regex(/^\d+$/),
  })
  .strict();

const targetingSchema = z
  .object({
    adUnitIds: z.array(idSchema).max(10_000).default([]),
    excludedAdUnitIds: z.array(idSchema).max(10_000).default([]),
    placementIds: z.array(idSchema).max(10_000).default([]),
    customCriteria: z
      .array(
        z
          .object({
            keyId: idSchema,
            valueIds: z.array(idSchema).min(1).max(10_000),
            operator: enumLikeSchema.default('IS'),
          })
          .strict(),
      )
      .max(1_000)
      .default([]),
  })
  .strict();

const primaryGoalSchema = z
  .object({
    goalType: enumLikeSchema,
    unitType: enumLikeSchema,
    units: z
      .string()
      .regex(/^-?\d+$/)
      .optional(),
  })
  .strict();

export const orderCreateSchema = z
  .object({
    name: nameSchema,
    advertiserId: idSchema,
    traffickerId: idSchema,
    salespersonId: idSchema.optional(),
    externalOrderId: idSchema.optional(),
    poNumber: z.string().max(255).optional(),
    notes: optionalTextSchema,
  })
  .strict();

const orderPatchSchema = z
  .object({
    name: nameSchema.optional(),
    traffickerId: idSchema.optional(),
    salespersonId: idSchema.optional(),
    externalOrderId: idSchema.optional(),
    poNumber: z.string().max(255).optional(),
    notes: optionalTextSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one editable field is required.');

export const orderUpdateSchema = z.object({ orderId: idSchema, patch: orderPatchSchema }).strict();

export const lineItemCreateSchema = z
  .object({
    orderId: idSchema,
    name: nameSchema,
    lineItemType: enumLikeSchema,
    priority: z.number().int().min(1).max(16),
    costType: z.literal('CPM').default('CPM'),
    costPerUnit: moneySchema,
    startTime: isoDateTimeSchema,
    endTime: isoDateTimeSchema.optional(),
    unlimitedEndTime: z.boolean().default(false),
    creativePlaceholderSizes: z.array(sizeSchema).min(1).max(100),
    targeting: targetingSchema,
    primaryGoal: primaryGoalSchema,
    creativeRotationType: enumLikeSchema.default('OPTIMIZED'),
    deliveryRateType: enumLikeSchema.default('EVENLY'),
    deliveryForecastSource: enumLikeSchema.default('HISTORICAL'),
    roadblockingType: enumLikeSchema.default('ONE_OR_MORE'),
    environmentType: enumLikeSchema.default('BROWSER'),
    sameAdvertiserExceptionEnabled: z.boolean().default(false),
    repeatedCreativeServingEnabled: z.boolean().default(false),
    externalId: externalIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.unlimitedEndTime && !value.endTime) {
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'endTime is required unless unlimitedEndTime is true.',
      });
    }
    if (value.endTime && Date.parse(value.endTime) <= Date.parse(value.startTime)) {
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'endTime must be after startTime.',
      });
    }
  });

const lineItemPatchSchema = z
  .object({
    name: nameSchema.optional(),
    lineItemType: enumLikeSchema.optional(),
    priority: z.number().int().min(1).max(16).optional(),
    costType: z.literal('CPM').optional(),
    costPerUnit: moneySchema.optional(),
    startTime: isoDateTimeSchema.optional(),
    endTime: isoDateTimeSchema.optional(),
    unlimitedEndTime: z.boolean().optional(),
    creativePlaceholderSizes: z.array(sizeSchema).min(1).max(100).optional(),
    targeting: targetingSchema.optional(),
    primaryGoal: primaryGoalSchema.optional(),
    creativeRotationType: enumLikeSchema.optional(),
    deliveryRateType: enumLikeSchema.optional(),
    deliveryForecastSource: enumLikeSchema.optional(),
    roadblockingType: enumLikeSchema.optional(),
    environmentType: enumLikeSchema.optional(),
    sameAdvertiserExceptionEnabled: z.boolean().optional(),
    repeatedCreativeServingEnabled: z.boolean().optional(),
    externalId: externalIdSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one editable field is required.');

export const lineItemUpdateSchema = z
  .object({ lineItemId: idSchema, patch: lineItemPatchSchema })
  .strict();

export const creativeCreateSchema = z
  .object({
    creativeType: z.literal('THIRD_PARTY').default('THIRD_PARTY'),
    contextOrderId: idSchema,
    advertiserId: idSchema,
    name: nameSchema,
    size: sizeSchema,
    snippet: z.string().min(1).max(1_048_576),
    isSafeFrameCompatible: z.boolean().default(false),
    externalId: externalIdSchema.optional(),
  })
  .strict();

const creativePatchSchema = z
  .object({
    name: nameSchema.optional(),
    size: sizeSchema.optional(),
    snippet: z.string().min(1).max(1_048_576).optional(),
    isSafeFrameCompatible: z.boolean().optional(),
    externalId: externalIdSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one editable field is required.');

export const creativeUpdateSchema = z
  .object({ contextOrderId: idSchema, creativeId: idSchema, patch: creativePatchSchema })
  .strict();

export const creativeAssociationSchema = z
  .object({
    lineItemId: idSchema,
    creativeId: idSchema,
    sizes: z.array(sizeSchema).min(1).max(100).optional(),
  })
  .strict();

export const lineItemCloneSchema = z
  .object({
    sourceLineItemId: idSchema,
    targetOrderId: idSchema,
    name: nameSchema,
    externalId: externalIdSchema.optional(),
    overrides: z
      .object({
        priority: z.number().int().min(1).max(16).optional(),
        costPerUnit: moneySchema.optional(),
        startTime: isoDateTimeSchema.optional(),
        endTime: isoDateTimeSchema.optional(),
        unlimitedEndTime: z.boolean().optional(),
        creativePlaceholderSizes: z.array(sizeSchema).min(1).max(100).optional(),
        targeting: targetingSchema.optional(),
        creativeRotationType: enumLikeSchema.optional(),
        deliveryRateType: enumLikeSchema.optional(),
        deliveryForecastSource: enumLikeSchema.optional(),
        roadblockingType: enumLikeSchema.optional(),
        environmentType: enumLikeSchema.optional(),
        sameAdvertiserExceptionEnabled: z.boolean().optional(),
        repeatedCreativeServingEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const creativeCloneSchema = z
  .object({
    sourceCreativeId: idSchema,
    contextOrderId: idSchema,
    name: nameSchema,
    externalId: externalIdSchema.optional(),
    overrides: z
      .object({
        size: sizeSchema.optional(),
        snippet: z.string().min(1).max(1_048_576).optional(),
        isSafeFrameCompatible: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const executionShape = {
  networkCode: networkCodeSchema,
  dryRun: z.boolean().default(true),
  continueOnError: z.boolean().default(false),
  rollbackOnFailure: z.boolean().default(false),
};

function oneOrMany<T extends z.ZodType>(singular: string, plural: string, itemSchema: T) {
  return z
    .object({
      ...executionShape,
      [singular]: itemSchema.optional(),
      [plural]: z.array(itemSchema).min(1).max(500).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      const fields = value as Record<string, unknown>;
      if ((fields[singular] === undefined) === (fields[plural] === undefined)) {
        context.addIssue({
          code: 'custom',
          message: `Provide exactly one of ${singular} or ${plural}.`,
        });
      }
      if (value.rollbackOnFailure && value.continueOnError) {
        context.addIssue({
          code: 'custom',
          message: 'rollbackOnFailure and continueOnError cannot both be true.',
        });
      }
    });
}

export const createOrderInputSchema = oneOrMany('order', 'orders', orderCreateSchema);
export const updateOrderInputSchema = oneOrMany('update', 'updates', orderUpdateSchema);
export const createLineItemInputSchema = oneOrMany('lineItem', 'lineItems', lineItemCreateSchema);
export const updateLineItemInputSchema = oneOrMany('update', 'updates', lineItemUpdateSchema);
export const createCreativeInputSchema = oneOrMany('creative', 'creatives', creativeCreateSchema);
export const updateCreativeInputSchema = oneOrMany('update', 'updates', creativeUpdateSchema);
export const associateCreativeInputSchema = oneOrMany(
  'association',
  'associations',
  creativeAssociationSchema,
);
export const cloneLineItemInputSchema = oneOrMany('clone', 'clones', lineItemCloneSchema);
export const cloneCreativeInputSchema = oneOrMany('clone', 'clones', creativeCloneSchema);

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderInputSchema>;
export type CreateLineItemInput = z.infer<typeof createLineItemInputSchema>;
export type UpdateLineItemInput = z.infer<typeof updateLineItemInputSchema>;
export type CreateCreativeInput = z.infer<typeof createCreativeInputSchema>;
export type UpdateCreativeInput = z.infer<typeof updateCreativeInputSchema>;
export type AssociateCreativeInput = z.infer<typeof associateCreativeInputSchema>;
export type CloneLineItemInput = z.infer<typeof cloneLineItemInputSchema>;
export type CloneCreativeInput = z.infer<typeof cloneCreativeInputSchema>;
