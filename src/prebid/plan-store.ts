import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { StoredGranularityPlan } from './application-models.js';
import { GranularityApplicationError } from './application-errors.js';
import { sealedPlanPayload } from './application-plan-builder.js';
import { canonicalHash } from './material-snapshot.js';

const safeId = /^[a-z0-9][a-z0-9:_-]{1,127}$/i;

export class GranularityPlanStore {
  constructor(private readonly directory: string) {}

  async create(plan: StoredGranularityPlan): Promise<StoredGranularityPlan> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(plan.planId);
    try {
      await writeFile(path, JSON.stringify(plan, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return plan;
    } catch (error) {
      if (isNodeError(error, 'EEXIST')) {
        const existing = await this.get(plan.planId);
        if (existing.planHash === plan.planHash) return existing;
        throw new GranularityApplicationError(
          'PLAN_STORE_CONFLICT',
          'A different plan already uses this planId.',
        );
      }
      throw error;
    }
  }

  async get(planId: string): Promise<StoredGranularityPlan> {
    try {
      return JSON.parse(await readFile(this.path(planId), 'utf8')) as StoredGranularityPlan;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        throw new GranularityApplicationError(
          'PLAN_NOT_FOUND',
          'The requested plan was not found.',
        );
      }
      throw error;
    }
  }

  async update(
    planId: string,
    expectedRevision: number,
    mutate: (plan: StoredGranularityPlan) => StoredGranularityPlan,
  ): Promise<StoredGranularityPlan> {
    return this.withLock(planId, async () => {
      const current = await this.get(planId);
      if (current.revision !== expectedRevision) {
        throw new GranularityApplicationError(
          'PLAN_STORE_CONFLICT',
          'The plan changed concurrently; reload it before continuing.',
        );
      }
      const next = mutate(structuredClone(current));
      if (
        current.sealedPlanHash &&
        (next.sealedPlanHash !== current.sealedPlanHash ||
          canonicalHash(sealedPlanPayload(next)) !== current.sealedPlanHash)
      ) {
        throw new GranularityApplicationError(
          'PLAN_TAMPERED',
          'Validated plan content is immutable.',
        );
      }
      next.revision = current.revision + 1;
      next.updatedAt = new Date().toISOString();
      const destination = this.path(planId);
      const temporary = `${destination}.${process.pid}.${next.revision}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, destination);
      return next;
    });
  }

  private async withLock<T>(planId: string, work: () => Promise<T>): Promise<T> {
    const lockPath = `${this.path(planId)}.lock`;
    const handle = await this.acquireLock(lockPath);
    try {
      return await work();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private async acquireLock(lockPath: string) {
    try {
      return await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      const metadata = await stat(lockPath).catch(() => undefined);
      if (metadata && Date.now() - metadata.mtimeMs > 5 * 60_000) {
        await unlink(lockPath).catch(() => undefined);
        try {
          return await open(lockPath, 'wx', 0o600);
        } catch {
          // Another process recovered the lock first.
        }
      }
      throw new GranularityApplicationError(
        'PLAN_STORE_CONFLICT',
        'The plan is already being processed by another execution.',
      );
    }
  }

  private path(planId: string): string {
    if (!safeId.test(planId)) {
      throw new GranularityApplicationError('PLAN_NOT_FOUND', 'The planId format is invalid.');
    }
    return join(this.directory, `${planId}.json`);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
