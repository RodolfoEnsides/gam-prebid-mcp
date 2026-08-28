import type { AppConfig } from '../../config/env.js';
import { createHash } from 'node:crypto';
import type { WriteAuditLogger } from '../../audit/write-audit-logger.js';
import { serializeSafeError } from '../../security/safe-error.js';
import type { SecurityPolicy } from '../../security/policy.js';
import type { Creative, LineItem, Order, Size, TargetingSummary } from '../models/resources.js';
import type {
  BatchWriteResult,
  CreativeAssociationCreate,
  CreativeClone,
  CreativeUpdate,
  LineItemClone,
  LineItemCreate,
  LineItemUpdate,
  OrderCreate,
  OrderUpdate,
  ThirdPartyCreativeCreate,
  WriteDiff,
  WriteItemResult,
} from '../models/write-models.js';
import type { GamWriteRepository, ResourceSnapshot } from '../repositories/write-repository.js';
import { BulkLimitError } from './write-errors.js';

export type GamWriteRepositoryProvider = (networkCode: string) => GamWriteRepository;

export type BatchOptions = {
  networkCode?: string;
  dryRun: boolean;
  continueOnError: boolean;
  rollbackOnFailure: boolean;
};

type Processed = {
  result: WriteItemResult;
  orderId?: string;
  rollback?: (() => Promise<string | undefined>) | undefined;
};

export class GamWriteService {
  constructor(
    private readonly config: AppConfig,
    private readonly policy: SecurityPolicy,
    private readonly repositories: GamWriteRepositoryProvider,
    private readonly audit: WriteAuditLogger,
  ) {}

  createOrders(items: OrderCreate[], options: BatchOptions): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_create_order',
      'create',
      'order',
      items,
      options,
      async (repository, networkCode, item) => {
        const existing = await repository.findOrder(item);
        if (existing) {
          return this.duplicateOrIdempotent(
            'gam_create_order',
            'order',
            existing.resource.id,
            orderComparable(existing.resource),
            orderDesired(item),
            options.dryRun,
          );
        }
        const proposed = publicValue(item);
        if (options.dryRun) {
          return {
            result: successResult('gam_create_order', 'order', options.dryRun, {
              proposed,
              diff: createDiff(proposed),
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.createOrder(item);
        return {
          result: successResult('gam_create_order', 'order', false, {
            resourceId: after.id,
            proposed,
            after: publicValue(after),
            changed: true,
          }),
        };
      },
    );
  }

  updateOrders(items: OrderUpdate[], options: BatchOptions): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_update_order',
      'update',
      'order',
      items,
      options,
      async (repository, networkCode, item) => {
        this.policy.assertOrderAllowed(item.orderId);
        const snapshot = await repository.getOrder(item.orderId);
        const proposed = applyOrderPatch(snapshot.resource, item.patch);
        const diff = diffValues(orderComparable(snapshot.resource), orderComparable(proposed));
        if (diff.length === 0) {
          return {
            result: successResult('gam_update_order', 'order', options.dryRun, {
              resourceId: item.orderId,
              before: publicValue(snapshot.resource),
              proposed: publicValue(proposed),
              diff,
              idempotent: true,
            }),
          };
        }
        if (options.dryRun) {
          return {
            result: successResult('gam_update_order', 'order', true, {
              resourceId: item.orderId,
              before: publicValue(snapshot.resource),
              proposed: publicValue(proposed),
              diff,
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.updateOrder(snapshot, item);
        return {
          result: successResult('gam_update_order', 'order', false, {
            resourceId: item.orderId,
            before: publicValue(snapshot.resource),
            proposed: publicValue(proposed),
            after: publicValue(after),
            diff,
            changed: true,
          }),
          rollback: () => this.rollbackOrder(repository, item, snapshot),
        };
      },
    );
  }

  createLineItems(items: LineItemCreate[], options: BatchOptions): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_create_line_item',
      'create',
      'lineItem',
      items,
      options,
      async (repository, networkCode, item) => {
        this.policy.assertOrderAllowed(item.orderId);
        await repository.getOrder(item.orderId);
        const existing = await repository.findLineItem(item);
        if (existing) {
          return this.duplicateOrIdempotent(
            'gam_create_line_item',
            'lineItem',
            existing.resource.id,
            lineItemComparable(existing.resource),
            lineItemDesired(item),
            options.dryRun,
          );
        }
        const proposed = publicValue(item);
        if (options.dryRun) {
          return {
            result: successResult('gam_create_line_item', 'lineItem', true, {
              proposed,
              diff: createDiff(proposed),
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.createLineItem(item);
        return {
          result: successResult('gam_create_line_item', 'lineItem', false, {
            resourceId: after.id,
            proposed,
            after: publicValue(after),
            changed: true,
          }),
        };
      },
    );
  }

  updateLineItems(items: LineItemUpdate[], options: BatchOptions): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_update_line_item',
      'update',
      'lineItem',
      items,
      options,
      async (repository, networkCode, item) => {
        const snapshot = await repository.getLineItem(item.lineItemId);
        this.policy.assertOrderAllowed(snapshot.resource.orderId);
        const proposed = applyLineItemPatch(snapshot.resource, item.patch);
        const diff = diffValues(
          lineItemComparable(snapshot.resource),
          lineItemComparable(proposed),
        );
        if (diff.length === 0 || options.dryRun) {
          return {
            result: successResult('gam_update_line_item', 'lineItem', options.dryRun, {
              resourceId: item.lineItemId,
              before: publicValue(snapshot.resource),
              proposed: publicValue(proposed),
              diff,
              idempotent: diff.length === 0,
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.updateLineItem(snapshot, item);
        return {
          result: successResult('gam_update_line_item', 'lineItem', false, {
            resourceId: item.lineItemId,
            before: publicValue(snapshot.resource),
            proposed: publicValue(proposed),
            after: publicValue(after),
            diff,
            changed: true,
          }),
          rollback: () => this.rollbackLineItem(repository, item, snapshot),
        };
      },
    );
  }

  createCreatives(
    items: ThirdPartyCreativeCreate[],
    options: BatchOptions,
  ): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_create_creative',
      'create',
      'creative',
      items,
      options,
      async (repository, networkCode, item) => {
        await this.assertCreativeContext(repository, item.contextOrderId, item.advertiserId);
        const existing = await repository.findCreative(item);
        if (existing) {
          return this.duplicateOrIdempotent(
            'gam_create_creative',
            'creative',
            existing.resource.id,
            creativeComparable(existing.resource),
            creativeDesired(item),
            options.dryRun,
          );
        }
        const proposed = publicValue(item);
        if (options.dryRun) {
          return {
            result: successResult('gam_create_creative', 'creative', true, {
              proposed,
              diff: createDiff(proposed),
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.createCreative(item);
        return {
          result: successResult('gam_create_creative', 'creative', false, {
            resourceId: after.id,
            proposed,
            after: publicValue(after),
            changed: true,
          }),
        };
      },
    );
  }

  updateCreatives(items: CreativeUpdate[], options: BatchOptions): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_update_creative',
      'update',
      'creative',
      items,
      options,
      async (repository, networkCode, item) => {
        const snapshot = await repository.getCreative(item.creativeId);
        await this.assertCreativeContext(
          repository,
          item.contextOrderId,
          snapshot.resource.advertiserId,
        );
        const proposed = applyCreativePatch(snapshot.resource, item.patch);
        const diff = diffValues(
          creativeComparable(snapshot.resource),
          creativeComparable(proposed),
        );
        if (diff.length === 0 || options.dryRun) {
          return {
            result: successResult('gam_update_creative', 'creative', options.dryRun, {
              resourceId: item.creativeId,
              before: publicValue(snapshot.resource),
              proposed: publicValue(proposed),
              diff,
              idempotent: diff.length === 0,
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.updateCreative(snapshot, item);
        return {
          result: successResult('gam_update_creative', 'creative', false, {
            resourceId: item.creativeId,
            before: publicValue(snapshot.resource),
            proposed: publicValue(proposed),
            after: publicValue(after),
            diff,
            changed: true,
          }),
          rollback: () => this.rollbackCreative(repository, item, snapshot),
        };
      },
    );
  }

  associateCreatives(
    items: CreativeAssociationCreate[],
    options: BatchOptions,
  ): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_associate_creative',
      'create',
      'lineItemCreativeAssociation',
      items,
      options,
      async (repository, _networkCode, item) => {
        const lineItem = await repository.getLineItem(item.lineItemId);
        this.policy.assertOrderAllowed(lineItem.resource.orderId);
        const creative = await repository.getCreative(item.creativeId);
        await this.assertCreativeContext(
          repository,
          lineItem.resource.orderId,
          creative.resource.advertiserId,
        );
        const existing = await repository.findAssociation(item);
        if (existing) {
          return {
            orderId: lineItem.resource.orderId,
            result: successResult(
              'gam_associate_creative',
              'lineItemCreativeAssociation',
              options.dryRun,
              {
                resourceId: `${item.lineItemId}:${item.creativeId}`,
                after: publicValue(existing),
                idempotent: true,
              },
            ),
          };
        }
        if (options.dryRun) {
          const proposed = publicValue(item);
          return {
            orderId: lineItem.resource.orderId,
            result: successResult('gam_associate_creative', 'lineItemCreativeAssociation', true, {
              proposed,
              diff: createDiff(proposed),
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.createAssociation(item);
        return {
          orderId: lineItem.resource.orderId,
          result: successResult('gam_associate_creative', 'lineItemCreativeAssociation', false, {
            resourceId: `${item.lineItemId}:${item.creativeId}`,
            proposed: publicValue(item),
            after: publicValue(after),
            changed: true,
          }),
        };
      },
    );
  }

  cloneLineItems(items: LineItemClone[], options: BatchOptions): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_clone_line_item',
      'create',
      'lineItem',
      items,
      options,
      async (repository, _networkCode, item) => {
        const source = await repository.getLineItem(item.sourceLineItemId);
        this.policy.assertOrderAllowed(source.resource.orderId);
        this.policy.assertOrderAllowed(item.targetOrderId);
        await repository.getOrder(item.targetOrderId);
        const identity = cloneLineItemIdentity(source.resource, item);
        const existing = await repository.findLineItem(identity);
        if (existing) {
          return this.duplicateOrIdempotent(
            'gam_clone_line_item',
            'lineItem',
            existing.resource.id,
            lineItemComparable(existing.resource),
            lineItemComparable(applyCloneLineItem(source.resource, item)),
            options.dryRun,
          );
        }
        const proposed = publicValue(applyCloneLineItem(source.resource, item));
        if (options.dryRun) {
          return {
            result: successResult('gam_clone_line_item', 'lineItem', true, {
              before: publicValue(source.resource),
              proposed,
              diff: diffValues(publicValue(source.resource), proposed),
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.cloneLineItem(source, item);
        return {
          result: successResult('gam_clone_line_item', 'lineItem', false, {
            resourceId: after.id,
            before: publicValue(source.resource),
            proposed,
            after: publicValue(after),
            changed: true,
          }),
        };
      },
    );
  }

  cloneCreatives(items: CreativeClone[], options: BatchOptions): Promise<BatchWriteResult> {
    return this.runBatch(
      'gam_clone_creative',
      'create',
      'creative',
      items,
      options,
      async (repository, _networkCode, item) => {
        const source = await repository.getCreative(item.sourceCreativeId);
        if (!/ThirdPartyCreative/i.test(source.resource.type ?? '')) {
          throw new Error('Only ThirdPartyCreative cloning is supported in this stage.');
        }
        await this.assertCreativeContext(
          repository,
          item.contextOrderId,
          source.resource.advertiserId,
        );
        const identity = cloneCreativeIdentity(source.resource, item);
        const existing = await repository.findCreative(identity);
        if (existing) {
          return this.duplicateOrIdempotent(
            'gam_clone_creative',
            'creative',
            existing.resource.id,
            creativeComparable(existing.resource),
            creativeComparable(applyCloneCreative(source.resource, item)),
            options.dryRun,
          );
        }
        const proposed = publicValue(applyCloneCreative(source.resource, item));
        if (options.dryRun) {
          return {
            result: successResult('gam_clone_creative', 'creative', true, {
              before: publicValue(source.resource),
              proposed,
              diff: diffValues(publicValue(source.resource), proposed),
            }),
          };
        }
        this.policy.assertWriteExecutionAllowed(false);
        const after = await repository.cloneCreative(source, item);
        return {
          result: successResult('gam_clone_creative', 'creative', false, {
            resourceId: after.id,
            before: publicValue(source.resource),
            proposed,
            after: publicValue(after),
            changed: true,
          }),
        };
      },
    );
  }

  private async runBatch<T>(
    tool: string,
    kind: 'create' | 'update',
    resourceType: string,
    items: T[],
    options: BatchOptions,
    process: (repository: GamWriteRepository, networkCode: string, item: T) => Promise<Processed>,
  ): Promise<BatchWriteResult> {
    const limit = kind === 'create' ? this.config.gam.maxBulkCreate : this.config.gam.maxBulkUpdate;
    if (items.length > limit) throw new BulkLimitError(kind, limit);
    const networkCode = options.networkCode ?? this.config.gam.networkCode;
    this.policy.assertNetworkAllowed(networkCode);
    if (options.rollbackOnFailure && options.continueOnError) {
      throw new Error('rollbackOnFailure and continueOnError cannot both be true.');
    }
    const repository = this.repositories(networkCode);
    const processed: Processed[] = [];
    let failed = false;

    for (const item of items) {
      try {
        const value = await process(repository, networkCode, item);
        processed.push(value);
        this.recordAudit(
          tool,
          networkCode,
          resourceType,
          value.result,
          value.orderId ?? extractOrderId(item, value.result),
        );
        if (!value.result.success) {
          failed = true;
          if (!options.continueOnError) break;
        }
      } catch (error) {
        failed = true;
        const safe = serializeSafeError(error);
        const result = failureResult(tool, resourceType, options.dryRun, safe);
        processed.push({ result });
        this.recordAudit(tool, networkCode, resourceType, result, extractOrderId(item, result));
        if (!options.continueOnError) break;
      }
    }

    while (processed.length < items.length) {
      const skippedItem = items[processed.length];
      const result = failureResult(tool, resourceType, options.dryRun, {
        code: 'BATCH_ITEM_SKIPPED',
        message: 'Item was not attempted because an earlier item failed.',
      });
      processed.push({ result });
      this.recordAudit(
        tool,
        networkCode,
        resourceType,
        result,
        extractOrderId(skippedItem, result),
      );
    }

    const rollback = {
      requested: options.rollbackOnFailure,
      attempted: false,
      succeeded: null as boolean | null,
      resourceIds: [] as string[],
      errors: [] as string[],
      ...(failed && options.rollbackOnFailure && processed.every((item) => !item.rollback)
        ? { reason: 'No non-destructive compensating update was available.' }
        : {}),
    };
    if (failed && options.rollbackOnFailure) {
      const callbacks = processed.filter((item) => item.rollback);
      if (callbacks.length > 0) {
        rollback.attempted = true;
        for (const value of [...callbacks].reverse()) {
          try {
            const resourceId = await value.rollback?.();
            if (resourceId) rollback.resourceIds.push(resourceId);
            value.result.changed = false;
            value.result.warnings.push('The successful update was logically rolled back.');
          } catch (error) {
            const safe = serializeSafeError(error);
            rollback.errors.push(`${safe.code}: ${safe.message}`);
          }
        }
        rollback.succeeded = rollback.errors.length === 0;
      }
    }
    const results = processed.map((item) => item.result);
    const succeeded = results.filter((result) => result.success).length;
    const changed = results.filter((result) => result.changed).length;
    return {
      operation: tool,
      dryRun: options.dryRun,
      changed: changed > 0,
      success: !failed && results.length === items.length,
      summary: {
        total: items.length,
        succeeded,
        failed: items.length - succeeded,
        changed,
      },
      results,
      rollback,
    };
  }

  private duplicateOrIdempotent(
    operation: string,
    resourceType: string,
    resourceId: string,
    existing: Record<string, unknown>,
    desired: Record<string, unknown>,
    dryRun: boolean,
  ): Processed {
    const diff = diffValues(existing, desired);
    if (diff.length === 0) {
      return {
        result: successResult(operation, resourceType, dryRun, {
          resourceId,
          before: publicValue(existing),
          after: publicValue(existing),
          idempotent: true,
        }),
      };
    }
    const result = failureResult(operation, resourceType, dryRun, {
      code: 'DUPLICATE_RESOURCE_CONFLICT',
      message: 'A resource with the same idempotency identity exists with different configuration.',
    });
    result.resourceId = resourceId;
    result.before = publicValue(existing);
    result.proposed = publicValue(desired);
    result.diff = diff;
    return { result };
  }

  private async assertCreativeContext(
    repository: GamWriteRepository,
    orderId: string,
    advertiserId: string | undefined,
  ): Promise<void> {
    this.policy.assertOrderAllowed(orderId);
    const order = await repository.getOrder(orderId);
    if (!advertiserId || order.resource.advertiserId !== advertiserId) {
      throw new Error('Creative advertiser does not match the authorized Order advertiser.');
    }
  }

  private recordAudit(
    tool: string,
    networkCode: string,
    resourceType: string,
    result: WriteItemResult,
    orderId?: string,
  ): void {
    this.audit.record({
      timestamp: result.timestamp,
      tool,
      networkCode,
      ...(orderId ? { orderId } : {}),
      resourceType,
      ...(result.resourceId ? { resourceId: result.resourceId } : {}),
      operation: result.operation,
      ...(result.before !== undefined ? { before: result.before } : {}),
      ...(result.proposed !== undefined ? { proposed: result.proposed } : {}),
      ...(result.after !== undefined ? { after: result.after } : {}),
      dryRun: result.dryRun,
      success: result.success,
      ...(result.errors[0] ? { error: result.errors[0] } : {}),
    });
  }

  private async rollbackOrder(
    repository: GamWriteRepository,
    update: OrderUpdate,
    before: ResourceSnapshot<Order>,
  ): Promise<string> {
    const current = await repository.getOrder(update.orderId);
    await repository.updateOrder(current, {
      orderId: update.orderId,
      patch: reverseOrderPatch(before.resource, Object.keys(update.patch)),
    });
    return update.orderId;
  }

  private async rollbackLineItem(
    repository: GamWriteRepository,
    update: LineItemUpdate,
    before: ResourceSnapshot<LineItem>,
  ): Promise<string> {
    const current = await repository.getLineItem(update.lineItemId);
    await repository.updateLineItem(current, {
      lineItemId: update.lineItemId,
      patch: reverseLineItemPatch(before.resource, Object.keys(update.patch)),
    });
    return update.lineItemId;
  }

  private async rollbackCreative(
    repository: GamWriteRepository,
    update: CreativeUpdate,
    before: ResourceSnapshot<Creative>,
  ): Promise<string> {
    const current = await repository.getCreative(update.creativeId);
    await repository.updateCreative(current, {
      contextOrderId: update.contextOrderId,
      creativeId: update.creativeId,
      patch: reverseCreativePatch(before.resource, Object.keys(update.patch)),
    });
    return update.creativeId;
  }
}

function successResult(
  operation: string,
  resourceType: string,
  dryRun: boolean,
  overrides: Partial<WriteItemResult> = {},
): WriteItemResult {
  return {
    timestamp: new Date().toISOString(),
    operation,
    resourceType,
    dryRun,
    changed: false,
    success: true,
    idempotent: false,
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function failureResult(
  operation: string,
  resourceType: string,
  dryRun: boolean,
  error: { code: string; message: string },
): WriteItemResult {
  return {
    timestamp: new Date().toISOString(),
    operation,
    resourceType,
    dryRun,
    changed: false,
    success: false,
    idempotent: false,
    warnings: [],
    errors: [`${error.code}: ${error.message}`],
  };
}

function diffValues(before: unknown, proposed: unknown, path = ''): WriteDiff {
  if (stable(before) === stable(proposed)) return [];
  if (isRecord(before) && isRecord(proposed)) {
    return [...new Set([...Object.keys(before), ...Object.keys(proposed)])].flatMap((key) =>
      diffValues(before[key], proposed[key], path ? `${path}.${key}` : key),
    );
  }
  return [{ field: path || '$', before, proposed }];
}

function createDiff(proposed: unknown): WriteDiff {
  return [{ field: '$', before: null, proposed }];
}

function stable(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function publicValue<T>(value: T): T | Record<string, unknown> {
  if (!value || typeof value !== 'object') return value;
  const result = structuredClone(value) as Record<string, unknown>;
  if (typeof result.snippet === 'string') {
    const snippet = result.snippet;
    result.snippet = {
      redacted: true,
      length: snippet.length,
      sha256: createHash('sha256').update(snippet).digest('hex'),
    };
  }
  return result;
}

function orderDesired(input: OrderCreate): Record<string, unknown> {
  return {
    displayName: input.name,
    advertiserId: input.advertiserId,
    traffickerId: input.traffickerId,
    salespersonId: input.salespersonId,
    externalOrderId: input.externalOrderId,
    poNumber: input.poNumber,
    notes: input.notes,
  };
}

function orderComparable(value: Order): Record<string, unknown> {
  return {
    displayName: value.displayName,
    advertiserId: value.advertiserId,
    traffickerId: value.traffickerId,
    salespersonId: value.salespersonId,
    externalOrderId: value.externalOrderId,
    poNumber: value.poNumber,
    notes: value.notes,
  };
}

function applyOrderPatch(order: Order, patch: OrderUpdate['patch']): Order {
  return {
    ...order,
    ...(patch.name !== undefined ? { displayName: patch.name } : {}),
    ...(patch.traffickerId !== undefined ? { traffickerId: patch.traffickerId } : {}),
    ...(patch.salespersonId !== undefined ? { salespersonId: patch.salespersonId } : {}),
    ...(patch.externalOrderId !== undefined ? { externalOrderId: patch.externalOrderId } : {}),
    ...(patch.poNumber !== undefined ? { poNumber: patch.poNumber } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  };
}

function lineItemDesired(input: LineItemCreate): Record<string, unknown> {
  return {
    displayName: input.name,
    orderId: input.orderId,
    lineItemType: input.lineItemType,
    priority: input.priority,
    costType: input.costType,
    costPerUnit: input.costPerUnit,
    startTime: input.startTime,
    endTime: input.endTime,
    unlimitedEndTime: input.unlimitedEndTime,
    sizes: canonicalSizes(input.creativePlaceholderSizes),
    targeting: canonicalTargeting(input.targeting),
    primaryGoal: input.primaryGoal,
    externalId: input.externalId,
  };
}

function lineItemComparable(value: LineItem): Record<string, unknown> {
  return {
    displayName: value.displayName,
    orderId: value.orderId,
    lineItemType: value.lineItemType,
    priority: value.priority,
    costType: value.costType,
    costPerUnit: value.costPerUnit,
    startTime: value.startTime,
    endTime: value.endTime,
    unlimitedEndTime: value.unlimitedEndTime,
    sizes: canonicalSizes(value.sizes),
    targeting: canonicalTargeting(value.targeting),
    primaryGoal: value.primaryGoal,
    externalId: value.externalId,
  };
}

function applyLineItemPatch(lineItem: LineItem, patch: LineItemUpdate['patch']): LineItem {
  return {
    ...lineItem,
    ...(patch.name !== undefined ? { displayName: patch.name } : {}),
    ...(patch.lineItemType !== undefined ? { lineItemType: patch.lineItemType } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.costType !== undefined ? { costType: patch.costType } : {}),
    ...(patch.costPerUnit !== undefined ? { costPerUnit: patch.costPerUnit } : {}),
    ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
    ...(patch.endTime !== undefined ? { endTime: patch.endTime } : {}),
    ...(patch.unlimitedEndTime !== undefined ? { unlimitedEndTime: patch.unlimitedEndTime } : {}),
    ...(patch.creativePlaceholderSizes !== undefined
      ? { sizes: patch.creativePlaceholderSizes }
      : {}),
    ...(patch.targeting !== undefined ? { targeting: patch.targeting } : {}),
    ...(patch.primaryGoal !== undefined ? { primaryGoal: patch.primaryGoal } : {}),
    ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
  };
}

function creativeDesired(input: ThirdPartyCreativeCreate): Record<string, unknown> {
  return {
    advertiserId: input.advertiserId,
    name: input.name,
    type: 'ThirdPartyCreative',
    sizes: canonicalSizes([input.size]),
    snippet: publicValue({ snippet: input.snippet }).snippet,
    isSafeFrameCompatible: input.isSafeFrameCompatible,
    externalId: input.externalId,
  };
}

function creativeComparable(value: Creative): Record<string, unknown> {
  return {
    advertiserId: value.advertiserId,
    name: value.name,
    type: value.type,
    sizes: canonicalSizes(value.sizes),
    snippet: value.snippet ? publicValue({ snippet: value.snippet }).snippet : undefined,
    isSafeFrameCompatible: value.isSafeFrameCompatible,
    externalId: value.externalId,
  };
}

function applyCreativePatch(creative: Creative, patch: CreativeUpdate['patch']): Creative {
  return {
    ...creative,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.size !== undefined ? { sizes: [patch.size] } : {}),
    ...(patch.snippet !== undefined ? { snippet: patch.snippet } : {}),
    ...(patch.isSafeFrameCompatible !== undefined
      ? { isSafeFrameCompatible: patch.isSafeFrameCompatible }
      : {}),
    ...(patch.externalId !== undefined ? { externalId: patch.externalId } : {}),
  };
}

function canonicalSizes(sizes: Size[]): string[] {
  return sizes.map((size) => size.canonicalName).sort();
}

function canonicalTargeting(targeting: TargetingSummary): TargetingSummary {
  return {
    adUnitIds: [...targeting.adUnitIds].sort(),
    excludedAdUnitIds: [...targeting.excludedAdUnitIds].sort(),
    placementIds: [...targeting.placementIds].sort(),
    customCriteria: targeting.customCriteria
      .map((criterion) => ({
        ...(criterion.keyId ? { keyId: criterion.keyId } : {}),
        valueIds: [...criterion.valueIds].sort(),
        ...(criterion.operator ? { operator: criterion.operator } : {}),
      }))
      .sort((left, right) => stable(left).localeCompare(stable(right))),
  };
}

function cloneLineItemIdentity(source: LineItem, input: LineItemClone): LineItemCreate {
  const costPerUnit =
    source.costPerUnit?.currencyCode && source.costPerUnit.micros
      ? {
          currencyCode: source.costPerUnit.currencyCode,
          micros: source.costPerUnit.micros,
        }
      : { currencyCode: 'USD', micros: '0' };
  return {
    orderId: input.targetOrderId,
    name: input.name,
    lineItemType: source.lineItemType ?? 'PRICE_PRIORITY',
    priority: source.priority ?? 12,
    costType: 'CPM',
    costPerUnit,
    startTime: source.startTime ?? new Date(0).toISOString(),
    ...(source.endTime ? { endTime: source.endTime } : {}),
    unlimitedEndTime: source.unlimitedEndTime ?? false,
    creativePlaceholderSizes: source.sizes,
    targeting: source.targeting,
    primaryGoal: {
      goalType: source.primaryGoal?.goalType ?? 'NONE',
      unitType: source.primaryGoal?.unitType ?? 'IMPRESSIONS',
      ...(source.primaryGoal?.units ? { units: source.primaryGoal.units } : {}),
    },
    ...(input.externalId ? { externalId: input.externalId } : {}),
  };
}

function applyCloneLineItem(source: LineItem, input: LineItemClone): LineItem {
  return applyLineItemPatch(
    { ...source, id: '', orderId: input.targetOrderId, displayName: input.name },
    { ...(input.overrides ?? {}), ...(input.externalId ? { externalId: input.externalId } : {}) },
  );
}

function cloneCreativeIdentity(source: Creative, input: CreativeClone): ThirdPartyCreativeCreate {
  const size = input.overrides?.size ?? source.sizes[0];
  if (!source.advertiserId || !size) throw new Error('Source Creative is missing clone fields.');
  return {
    creativeType: 'THIRD_PARTY',
    contextOrderId: input.contextOrderId,
    advertiserId: source.advertiserId,
    name: input.name,
    size,
    snippet: input.overrides?.snippet ?? source.snippet ?? '',
    isSafeFrameCompatible:
      input.overrides?.isSafeFrameCompatible ?? source.isSafeFrameCompatible ?? false,
    ...(input.externalId ? { externalId: input.externalId } : {}),
  };
}

function applyCloneCreative(source: Creative, input: CreativeClone): Creative {
  return applyCreativePatch(
    { ...source, id: '', name: input.name },
    { ...(input.overrides ?? {}), ...(input.externalId ? { externalId: input.externalId } : {}) },
  );
}

function reverseOrderPatch(order: Order, keys: string[]): OrderUpdate['patch'] {
  const values: Record<string, string> = {
    name: order.displayName,
    traffickerId: order.traffickerId ?? '',
    salespersonId: order.salespersonId ?? '',
    externalOrderId: order.externalOrderId ?? '',
    poNumber: order.poNumber ?? '',
    notes: order.notes ?? '',
  };
  return Object.fromEntries(keys.map((key) => [key, values[key] ?? '']));
}

function reverseLineItemPatch(lineItem: LineItem, keys: string[]): LineItemUpdate['patch'] {
  const values: Record<string, unknown> = {
    name: lineItem.displayName,
    lineItemType: lineItem.lineItemType,
    priority: lineItem.priority,
    costType: lineItem.costType,
    costPerUnit: lineItem.costPerUnit,
    startTime: lineItem.startTime,
    endTime: lineItem.endTime,
    unlimitedEndTime: lineItem.unlimitedEndTime,
    creativePlaceholderSizes: lineItem.sizes,
    targeting: lineItem.targeting,
    primaryGoal: lineItem.primaryGoal,
    externalId: lineItem.externalId ?? '',
  };
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

function reverseCreativePatch(creative: Creative, keys: string[]): CreativeUpdate['patch'] {
  const values: Record<string, unknown> = {
    name: creative.name,
    size: creative.sizes[0],
    snippet: creative.snippet ?? '',
    isSafeFrameCompatible: creative.isSafeFrameCompatible,
    externalId: creative.externalId ?? '',
  };
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

function extractOrderId(item: unknown, result: WriteItemResult): string | undefined {
  const input = isRecord(item) ? item : {};
  for (const key of ['orderId', 'contextOrderId', 'targetOrderId']) {
    if (typeof input[key] === 'string') return input[key];
  }
  for (const value of [result.before, result.proposed, result.after]) {
    if (isRecord(value) && typeof value.orderId === 'string') return value.orderId;
  }
  return result.resourceType === 'order' ? result.resourceId : undefined;
}
