export type GamId = string;

export type Size = {
  width?: number | undefined;
  height?: number | undefined;
  canonicalName: string;
};

export type Money = {
  currencyCode?: string | undefined;
  micros?: string | undefined;
};

export type TargetingSummary = {
  adUnitIds: string[];
  excludedAdUnitIds: string[];
  placementIds: string[];
  customCriteria: CustomCriterion[];
};

export type CustomCriterion = {
  keyId?: string | undefined;
  valueIds: string[];
  operator?: string | undefined;
};

export type Order = {
  id: GamId;
  name: string;
  displayName: string;
  advertiserId?: string | undefined;
  advertiserName?: string | undefined;
  traffickerId?: string | undefined;
  salespersonId?: string | undefined;
  externalOrderId?: string | undefined;
  poNumber?: string | undefined;
  notes?: string | undefined;
  status?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  currencyCode?: string | undefined;
  archived: boolean;
};

export type LineItem = {
  id: GamId;
  name: string;
  displayName: string;
  orderId: GamId;
  orderName?: string | undefined;
  status?: string | undefined;
  lineItemType?: string | undefined;
  priority?: number | undefined;
  costType?: string | undefined;
  costPerUnit?: Money | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  archived: boolean;
  missingCreatives: boolean;
  externalId?: string | undefined;
  unlimitedEndTime?: boolean | undefined;
  primaryGoal?: {
    goalType?: string | undefined;
    unitType?: string | undefined;
    units?: string | undefined;
  };
  sizes: Size[];
  targeting: TargetingSummary;
};

export type Creative = {
  id: GamId;
  name: string;
  advertiserId?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
  sizes: Size[];
  previewUrl?: string | undefined;
  prebidUniversalCreative?: boolean | undefined;
  externalId?: string | undefined;
  snippet?: string | undefined;
  isSafeFrameCompatible?: boolean | undefined;
};

export type LineItemCreativeAssociation = {
  lineItemId: GamId;
  creativeId: GamId;
  status?: string | undefined;
  targetingName?: string | undefined;
  sizes: Size[];
};

export type AdUnit = {
  id: GamId;
  name: string;
  displayName: string;
  code?: string | undefined;
  parentId?: string | undefined;
  status?: string | undefined;
  explicitlyTargeted?: boolean | undefined;
  hasChildren?: boolean | undefined;
  sizes: Size[];
};

export type Placement = {
  id: GamId;
  name: string;
  displayName: string;
  status?: string | undefined;
  adUnitIds: string[];
};

export type CustomTargetingValue = {
  id: GamId;
  name: string;
  displayName: string;
  status?: string | undefined;
  matchType?: string | undefined;
};

export type CustomTargetingKey = {
  id: GamId;
  name: string;
  displayName: string;
  status?: string | undefined;
  type?: string | undefined;
  reportableType?: string | undefined;
  values: CustomTargetingValue[];
};

export type ReadFilters = {
  id?: string | undefined;
  name?: string | undefined;
  orderId?: string | undefined;
  advertiserId?: string | undefined;
  status?: string | undefined;
  lineItemType?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  customTargetingKeyId?: string | undefined;
  customTargetingValueId?: string | undefined;
  adUnitId?: string | undefined;
};

export type ListOptions = {
  limit: number;
  pageToken?: string | undefined;
};

export type ListResult<T> = {
  items: T[];
  count: number;
  limit: number;
  truncated: boolean;
  nextPageToken?: string | undefined;
  warnings: string[];
};
