export type GranularityApplicationErrorCode =
  | 'PLAN_NOT_FOUND'
  | 'PLAN_INVALID_STATE'
  | 'PLAN_BLOCKED'
  | 'PLAN_STALE'
  | 'PLAN_TAMPERED'
  | 'PLAN_EXPIRED'
  | 'PLAN_STORE_CONFLICT';

export class GranularityApplicationError extends Error {
  constructor(
    readonly code: GranularityApplicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GranularityApplicationError';
  }
}
