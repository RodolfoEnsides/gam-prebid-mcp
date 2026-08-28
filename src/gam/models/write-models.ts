import type { OperationResult } from '../../audit/operation-result.js';
import type { Size, TargetingSummary } from './resources.js';

export type OrderCreate = {
  name: string;
  advertiserId: string;
  traffickerId: string;
  salespersonId?: string;
  externalOrderId?: string;
  poNumber?: string;
  notes?: string;
};

export type OrderUpdate = {
  orderId: string;
  patch: Partial<
    Pick<
      OrderCreate,
      'name' | 'traffickerId' | 'salespersonId' | 'externalOrderId' | 'poNumber' | 'notes'
    >
  >;
};

export type PrimaryGoal = {
  goalType: string;
  unitType: string;
  units?: string;
};

export type LineItemCreate = {
  orderId: string;
  name: string;
  lineItemType: string;
  priority: number;
  costType: 'CPM';
  costPerUnit: { currencyCode: string; micros: string };
  startTime: string;
  endTime?: string;
  unlimitedEndTime: boolean;
  creativePlaceholderSizes: Size[];
  targeting: TargetingSummary;
  primaryGoal: PrimaryGoal;
  creativeRotationType?: string;
  deliveryRateType?: string;
  deliveryForecastSource?: string;
  roadblockingType?: string;
  environmentType?: string;
  sameAdvertiserExceptionEnabled?: boolean;
  repeatedCreativeServingEnabled?: boolean;
  externalId?: string;
};

export type LineItemUpdate = {
  lineItemId: string;
  patch: Partial<
    Pick<
      LineItemCreate,
      | 'name'
      | 'lineItemType'
      | 'priority'
      | 'costType'
      | 'costPerUnit'
      | 'startTime'
      | 'endTime'
      | 'unlimitedEndTime'
      | 'creativePlaceholderSizes'
      | 'targeting'
      | 'primaryGoal'
      | 'creativeRotationType'
      | 'deliveryRateType'
      | 'deliveryForecastSource'
      | 'roadblockingType'
      | 'environmentType'
      | 'sameAdvertiserExceptionEnabled'
      | 'repeatedCreativeServingEnabled'
      | 'externalId'
    >
  >;
};

export type ThirdPartyCreativeCreate = {
  creativeType: 'THIRD_PARTY';
  contextOrderId: string;
  advertiserId: string;
  name: string;
  size: Size;
  snippet: string;
  isSafeFrameCompatible: boolean;
  externalId?: string;
};

export type CreativeUpdate = {
  contextOrderId: string;
  creativeId: string;
  patch: Partial<
    Pick<
      ThirdPartyCreativeCreate,
      'name' | 'size' | 'snippet' | 'isSafeFrameCompatible' | 'externalId'
    >
  >;
};

export type CreativeAssociationCreate = {
  lineItemId: string;
  creativeId: string;
  sizes?: Size[];
};

export type LineItemClone = {
  sourceLineItemId: string;
  targetOrderId: string;
  name: string;
  externalId?: string;
  overrides?: Partial<
    Pick<
      LineItemCreate,
      | 'priority'
      | 'costPerUnit'
      | 'startTime'
      | 'endTime'
      | 'unlimitedEndTime'
      | 'creativePlaceholderSizes'
      | 'targeting'
      | 'creativeRotationType'
      | 'deliveryRateType'
      | 'deliveryForecastSource'
      | 'roadblockingType'
      | 'environmentType'
      | 'sameAdvertiserExceptionEnabled'
      | 'repeatedCreativeServingEnabled'
    >
  >;
};

export type CreativeClone = {
  sourceCreativeId: string;
  contextOrderId: string;
  name: string;
  externalId?: string;
  overrides?: Partial<Pick<ThirdPartyCreativeCreate, 'size' | 'snippet' | 'isSafeFrameCompatible'>>;
};

export type WriteDiff = NonNullable<OperationResult['diff']>;

export type WriteItemResult = OperationResult & {
  timestamp: string;
  success: boolean;
  idempotent: boolean;
};

export type BatchWriteResult = {
  operation: string;
  dryRun: boolean;
  changed: boolean;
  success: boolean;
  summary: { total: number; succeeded: number; failed: number; changed: number };
  results: WriteItemResult[];
  rollback: {
    requested: boolean;
    attempted: boolean;
    succeeded: boolean | null;
    reason?: string;
    resourceIds: string[];
    errors: string[];
  };
};
