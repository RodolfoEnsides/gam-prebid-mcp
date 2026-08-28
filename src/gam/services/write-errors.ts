export class BulkLimitError extends Error {
  constructor(
    kind: 'create' | 'update',
    readonly limit: number,
  ) {
    super(`Bulk ${kind} exceeds the configured limit of ${limit}.`);
    this.name = 'BulkLimitError';
  }
}
