export class BulkLimitError extends Error {
  constructor(
    kind: 'create' | 'update',
    readonly limit: number,
  ) {
    super(`Bulk ${kind} exceeds the configured limit of ${limit}.`);
    this.name = 'BulkLimitError';
  }
}

export class PostWriteVerificationError extends Error {
  constructor(readonly fields: string[]) {
    super(`GAM returned a Line Item that differs in critical fields: ${fields.join(', ')}.`);
    this.name = 'PostWriteVerificationError';
  }
}
