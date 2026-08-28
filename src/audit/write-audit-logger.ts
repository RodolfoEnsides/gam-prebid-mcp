import { createHash } from 'node:crypto';

import type { Logger } from '../logging/logger.js';

export type WriteAuditEntry = {
  timestamp: string;
  tool: string;
  networkCode: string;
  orderId?: string;
  resourceType: string;
  resourceId?: string;
  operation: string;
  before?: unknown;
  proposed?: unknown;
  after?: unknown;
  dryRun: boolean;
  success: boolean;
  error?: string;
};

export class WriteAuditLogger {
  constructor(private readonly logger: Logger) {}

  record(entry: WriteAuditEntry): void {
    const safe = redactContent(entry) as WriteAuditEntry;
    const context = {
      event: 'gam_write_audit',
      ...safe,
      orderId: safe.orderId ?? null,
      resourceId: safe.resourceId ?? null,
      resource: { type: safe.resourceType, id: safe.resourceId ?? null },
      before: safe.before ?? null,
      proposed: safe.proposed ?? null,
      after: safe.after ?? null,
      error: safe.error ?? null,
    };
    if (entry.success) this.logger.info('GAM write audit.', context);
    else this.logger.error('GAM write audit failed.', context);
  }
}

function redactContent(value: unknown, key = ''): unknown {
  if (typeof value === 'string' && /(snippet|html|content|asset)/i.test(key)) {
    const digest = createHash('sha256').update(value).digest('hex');
    return { redacted: true, length: value.length, sha256: digest };
  }
  if (Array.isArray(value)) return value.map((item) => redactContent(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, item]) => [
        childKey,
        redactContent(item, childKey),
      ]),
    );
  }
  return value;
}
