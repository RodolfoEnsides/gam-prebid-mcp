import { describe, expect, it, vi } from 'vitest';

import { WriteAuditLogger } from '../../src/audit/write-audit-logger.js';
import type { Logger } from '../../src/logging/logger.js';

describe('WriteAuditLogger', () => {
  it('records the required audit fields while hashing Creative content', () => {
    const info = vi.fn();
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    } satisfies Logger;
    const audit = new WriteAuditLogger(logger);

    audit.record({
      timestamp: '2026-01-01T00:00:00.000Z',
      tool: 'gam_update_creative',
      networkCode: '12345678',
      orderId: '100',
      resourceType: 'creative',
      resourceId: '400',
      operation: 'gam_update_creative',
      before: { snippet: '<script>old</script>' },
      proposed: { snippet: '<script>proposed</script>' },
      after: { snippet: '<script>new</script>' },
      dryRun: false,
      success: true,
    });

    const context = info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(context).toMatchObject({
      event: 'gam_write_audit',
      timestamp: '2026-01-01T00:00:00.000Z',
      tool: 'gam_update_creative',
      networkCode: '12345678',
      orderId: '100',
      resourceId: '400',
      dryRun: false,
      success: true,
    });
    expect(JSON.stringify(context)).not.toContain('<script>');
    expect(JSON.stringify(context)).toContain('sha256');
    expect(context.proposed).not.toBeNull();
  });
});
