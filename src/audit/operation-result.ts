export type OperationResult = {
  timestamp?: string;
  operation: string;
  resourceType: string;
  resourceId?: string;
  dryRun: boolean;
  changed: boolean;
  before?: unknown;
  proposed?: unknown;
  after?: unknown;
  diff?: Array<{ field: string; before: unknown; proposed: unknown }>;
  success?: boolean;
  warnings: string[];
  errors: string[];
};
