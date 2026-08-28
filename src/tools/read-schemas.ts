import { z } from 'zod/v4';

export const idSchema = z.string().trim().regex(/^\d+$/, 'ID must contain only digits');
export const networkCodeSchema = idSchema.optional();
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/, 'Use YYYY-MM-DD or an ISO datetime');

export const networkInputSchema = z.object({ networkCode: networkCodeSchema }).strict();

export const listOptionsShape = {
  networkCode: networkCodeSchema,
  limit: z.number().int().min(1).max(50_000).optional(),
  pageToken: z.string().trim().min(1).max(2_048).optional(),
};

export const readFilterShape = {
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(256).optional(),
  orderId: idSchema.optional(),
  advertiserId: idSchema.optional(),
  status: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z_]*$/)
    .optional(),
  lineItemType: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z_]*$/)
    .optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  customTargetingKeyId: idSchema.optional(),
  customTargetingValueId: idSchema.optional(),
  adUnitId: idSchema.optional(),
};

export const orderListInputSchema = z
  .object({
    ...listOptionsShape,
    id: readFilterShape.id,
    name: readFilterShape.name,
    advertiserId: readFilterShape.advertiserId,
    status: readFilterShape.status,
    startDate: readFilterShape.startDate,
    endDate: readFilterShape.endDate,
  })
  .strict();

export const orderGetInputSchema = z
  .object({ networkCode: networkCodeSchema, orderId: idSchema })
  .strict();

export const lineItemListInputSchema = z
  .object({ ...listOptionsShape, ...readFilterShape })
  .strict();

export const lineItemGetInputSchema = z
  .object({ networkCode: networkCodeSchema, lineItemId: idSchema })
  .strict();

export const orderLineItemsInputSchema = z
  .object({ ...listOptionsShape, orderId: idSchema, status: readFilterShape.status })
  .strict();

export const creativeListInputSchema = z
  .object({
    ...listOptionsShape,
    id: readFilterShape.id,
    name: readFilterShape.name,
    advertiserId: readFilterShape.advertiserId,
    status: readFilterShape.status,
  })
  .strict();

export const creativeGetInputSchema = z
  .object({ networkCode: networkCodeSchema, creativeId: idSchema })
  .strict();

export const lineItemCreativesInputSchema = z
  .object({ ...listOptionsShape, lineItemId: idSchema })
  .strict();

export const adUnitListInputSchema = z
  .object({
    ...listOptionsShape,
    id: readFilterShape.id,
    name: readFilterShape.name,
    status: readFilterShape.status,
  })
  .strict();

export const adUnitGetInputSchema = z
  .object({ networkCode: networkCodeSchema, adUnitId: idSchema })
  .strict();

export const customTargetingInputSchema = z
  .object({
    ...listOptionsShape,
    keyId: idSchema.optional(),
    keyName: z.string().trim().min(1).max(256).optional(),
    valueId: idSchema.optional(),
    status: readFilterShape.status,
  })
  .strict();

export const auditOrderInputSchema = orderGetInputSchema;
export const auditInventoryInputSchema = networkInputSchema;
