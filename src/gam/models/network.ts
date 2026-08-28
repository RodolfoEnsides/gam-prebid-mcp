import { z } from 'zod/v4';

export const gamNetworkSchema = z.object({
  name: z.string(),
  networkCode: z.string().regex(/^\d+$/),
  displayName: z.string().optional(),
  timeZone: z.string().optional(),
  currencyCode: z.string().optional(),
  testNetwork: z.boolean().optional(),
});

export type GamNetwork = z.infer<typeof gamNetworkSchema>;
