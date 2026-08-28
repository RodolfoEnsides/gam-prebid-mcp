# GAM Prebid MCP

Safety-first MCP server for Google Ad Manager and Prebid inspection, auditing, planning, explicitly
gated writes, and controlled application of immutable granularity plans. The Stage 6 implementation
has no delete, archive, status-action, or generic mutation tool.

## Requirements

- Node.js 20+
- A Google Cloud project with the Ad Manager API enabled
- Application Default Credentials or a service-account JSON file referenced by
  `GOOGLE_APPLICATION_CREDENTIALS`
- The service-account user added to the target Google Ad Manager network

## Setup

```bash
cp .env.example .env
npm install
npm run check
npm run dev
```

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for Service Account setup, least-privilege GAM roles,
the complete staged apply runbook, recovery, and troubleshooting.

`stdout` is exclusively reserved for MCP JSON-RPC. All application logs are JSON Lines written to
`stderr`.

## Tools

### `gam_connection_test`

Optional input:

```json
{ "networkCode": "12345678" }
```

If omitted, `GAM_NETWORK_CODE` is used. The tool checks the network allowlist, authenticates,
retrieves `networks/{networkCode}` through the GAM REST v1 API, validates the returned identity,
and reports `readOnly`, `dryRun`, and access status. It never changes data.

Read tools:

- `gam_get_network`
- `gam_list_orders`, `gam_get_order`
- `gam_list_line_items`, `gam_get_line_item`, `gam_list_order_line_items`
- `gam_list_creatives`, `gam_get_creative`
- `gam_list_line_item_creatives`
- `gam_list_ad_units`, `gam_get_ad_unit`
- `gam_get_custom_targeting`
- `gam_audit_order`, `gam_audit_inventory`

Optional Prebid tools:

- `prebid_parse_config`
- `prebid_generate_price_buckets`
- `prebid_analyze_granularity`
- `prebid_compare_gam`
- `prebid_audit_order`
- `prebid_validate_targeting`
- `prebid_plan_granularity`
- `prebid_simulate_granularity`
- `gam_plan_prebid_granularity`

Explicit write tools, all defaulting to dry-run:

- `gam_create_order`, `gam_update_order`
- `gam_create_line_item`, `gam_update_line_item`
- `gam_create_creative`, `gam_update_creative`
- `gam_associate_creative`
- `gam_clone_line_item`, `gam_clone_creative`

Controlled Prebid application tools:

- `prebid_create_granularity_plan`
- `prebid_apply_granularity_plan` (requires explicit `dryRun` intent)
- `prebid_validate_granularity_plan`
- `prebid_post_apply_audit`

Order, Line Item, Network, Ad Unit, Placement, and Custom Targeting reads use REST v1. Creative and
LineItemCreativeAssociation reads use the SOAP `get*ByStatement` methods because REST does not
provide equivalent resources. SOAP defaults to `v202608` and can be selected with
`GAM_SOAP_API_VERSION`.

## Operation modes

- `GAM_ONLY`: every `gam_*` tool remains independent of Prebid and never loads a Prebid file.
- `GAM_WITH_PREBID`: a `prebid_*` tool receives either a direct `config` object or one allowlisted
  JSON `filePath`. It may correlate that configuration with the read-only GAM audit.

Prebid is therefore optional. No global Prebid configuration is needed for connection checks,
resource reads, `gam_audit_order`, or `gam_audit_inventory`.

The price engine implements `low`, `medium`, `high`, `auto`, `dense`, and custom bucket ranges. It
preserves each range's increment and precision, floors CPM values relative to the range boundary,
and caps values at the highest maximum. Generated outputs are the exact strings expected for
`hb_pb`; the standard `dense` configuration produces 425 values from `0.00` through `20.00`.

## Safety model

- `GAM_READ_ONLY` and `GAM_DRY_RUN` default to `true`.
- An empty network allowlist permits only `GAM_NETWORK_CODE`.
- Read-only audits do not treat the Order allowlist as a hidden data filter; writes do enforce it.
- Writes must pass both global mode and resource allowlists.
- Only transient transport/status failures are retried (`408`, `429`, `5xx` subset), with bounded
  exponential backoff and `Retry-After` support.
- Timeouts abort REST and SOAP requests.
- Read and planning tools are annotated read-only. Write tools are annotated non-destructive and
  idempotent, and expose no delete/archive/status action.
- Prebid file inputs must be JSON, stay below `PREBID_MAX_CONFIG_BYTES`, and resolve inside
  `PREBID_CONFIG_ALLOWED_DIRS` (or the process working directory when the allowlist is empty).
- `PREBID_MAX_BUCKETS` prevents unexpectedly large custom bucket outputs.
- Tool errors are allowlisted summaries; upstream response bodies, stacks, and credentials are not
  returned.

## Architecture

```text
MCP tool (src/tools)
  -> service (src/gam/services)
    -> repository (src/gam/repositories)
      -> REST or SOAP adapter (src/gam/adapters)
        -> auth/client boundary (src/gam/auth, src/gam/clients)
```

`GamSoapAdapter` exposes the required `get*ByStatement` operations plus only explicit typed
create/update methods. Write tools still
depend on services and repositories, never directly on an adapter or Google client.

## Safe writes

Every write call defaults to `dryRun: true`. Network execution occurs only when the caller sends
`dryRun: false`, `GAM_READ_ONLY=false`, and `GAM_DRY_RUN=false`. Existing Orders must also be in
`GAM_ALLOWED_ORDER_IDS`; Line Item ownership is resolved before authorization. Creative operations
require an allowlisted Order as context and verify that its advertiser matches the Creative.

Creates search by `externalOrderId`, `externalId`, or natural identity before writing. Equivalent
resources return idempotent success; conflicting duplicates fail without mutation. Updates accept
only resource-specific allowlisted patches and return `before`, `proposed`, and `diff` during dry-run,
then `before` and `after` after execution. Creative snippets are represented by length and SHA-256 in
results and audit logs.

Singular and bounded bulk inputs are supported. `GAM_MAX_BULK_CREATE` and `GAM_MAX_BULK_UPDATE`
default to 50. `continueOnError` must be explicit. `rollbackOnFailure` is available for update batches
and replays the prior allowlisted values in reverse order; creates and associations are never deleted
as compensation.

Every item emits a structured stderr audit event with timestamp, tool, Network, Order when
applicable, resource, operation, before/after, dry-run, success, and safe error. Non-idempotent creates
are not retried automatically; idempotent updates retain transient retry/backoff.

## Audits

`gam_audit_order` correlates the Order, Line Items, Custom Targeting keys and values, creative
placeholders, LICAs, and Creatives. It reports paused/archived resources, missing creatives,
priority/type and currency inconsistencies, unresolved targeting, size mismatches, and apparent
duplicates.

`gam_audit_inventory` correlates Ad Units, sizes, Placements, and targeted Line Items. It reports
coverage, unassociated resources, missing sizes, and possible same-priority targeting conflicts.

Findings use `INFO`, `WARNING`, `HIGH`, and `CRITICAL`. An unavailable sub-API produces a partial
audit and a `CRITICAL` finding instead of discarding data already collected. Audit caches exist only
for one execution.

`prebid_compare_gam` correlates expected `hb_pb` strings with the values actually targeted by the
Order. It reports correct, missing, and extra buckets; non-canonical precision; CPM/currency
mismatches; duplicated buckets; absent or divergent targeting; Universal Creative markers;
placeholder/1x1 dimensions; and distinct active creatives per Line Item. Optional keys such as
`hb_bidder`, `hb_adid`, `hb_size`, `hb_format`, `hb_source`, and `hb_deal` are required only when the
provided configuration explicitly declares them. `hb_pb` is always required.

`prebid_audit_order` performs the GAM audit once and returns both the GAM findings and the Prebid
comparison, sharing the execution-local audit cache. `simultaneousAdUnits` controls the minimum
number of distinct active creatives expected per Line Item.

## Granularity planning

`prebid_plan_granularity` supports `standard`, `dense`, `auto`, `custom`, and `recommend`. Historical
input can be raw bids, a weighted histogram, or both. The planner calculates average CPM, p50, p75,
p90, p95, p99, floor exclusions, cap exposure, and observed rounding loss. Currency conversion is
never inferred.

In `recommend` mode, the planner does not default to dense. It requires enough observations eligible
after the floor plus an explicit `maxLineItems` or `maximumAverageRoundingLoss` constraint. Otherwise
it returns `COMPARISON_ONLY`, null loss estimates when data is unavailable, and explains why no ideal
choice can be supported.

`prebid_simulate_granularity` compares any standard presets and named custom alternatives.
`gam_plan_prebid_granularity` reads an Order and produces only a proposed structure: Line Items to
create or alter, targeting key/value identities, CPM, priority, type, placeholders, distinct creatives
and associations needed, preserved resources, warnings, and conflicts. Missing targeting values,
partial audits, ambiguous mappings, and currency mismatches block future execution. Every plan has a
stable canonical SHA-256 `planHash` and shortened `planId`; no plan executes GAM changes.

## Controlled granularity application

Application is a persisted state machine and cannot be combined with plan creation in one MCP call:

```text
AUDIT + PLAN -> DRY RUN -> VALIDATE + SEAL -> APPLY -> POST AUDIT
```

`prebid_create_granularity_plan` performs a fresh Order audit, calculates expected buckets, plans
only missing Line Items, and persists a versioned plan under `GAM_PLAN_STORE_DIR`. New Line Items use
an explicit `baseLineItemId` so inventory and non-`hb_pb` targeting are preserved; the `hb_pb`
criterion is replaced with the exact existing GAM key/value ids. Missing targeting values, partial
audits, ambiguous mappings, incomplete base delivery fields, currency mismatches, or HIGH/CRITICAL
conflicts block execution.

The only way to record the mandatory simulation is
`prebid_apply_granularity_plan({ planId, dryRun: true })`. Validation then re-audits GAM, rejects any
Order, Line Item, Creative, association, Custom Targeting, or newly-added Line Item drift, and seals
the canonical plan hash. The plan store refuses mutation of sealed content.

A real apply requires `dryRun: false`, a `VALIDATED` plan, both global write gates disabled, and
Network/Order allowlists. Actions run in dependency order and logical batches of
`GAM_WRITE_BATCH_SIZE`. A failed action stops execution, records the exact action and completed
resources, captures a new checkpoint, and permits idempotent resume without replaying completed
actions. `prebid_post_apply_audit` independently proves missing buckets, duplicates, targeting, CPM,
creative coverage, and partial-audit status.

Creative behavior is always explicit: `none`, `reuse`, `clone`, or `create`. `clone` requires a
source Creative; `create` requires a typed ThirdPartyCreative template. No plan silently clones a
Creative. Plan files use owner-only permissions, are excluded by `.gitignore`, and expire after
`GAM_PLAN_MAX_AGE_MS`.

## Pagination and limits

- `GAM_PAGE_SIZE`: page size sent to APIs.
- `GAM_DEFAULT_LIST_LIMIT`: default tool result limit.
- `GAM_MAX_LIST_LIMIT`: maximum caller-selected list limit.
- `GAM_AUDIT_MAX_RESOURCES`: audit safety ceiling.
- `GAM_AUDIT_CONCURRENCY`: maximum parallel audit lookups.
- `PREBID_CONFIG_ALLOWED_DIRS`: comma-separated directories permitted for JSON file input.
- `PREBID_MAX_CONFIG_BYTES`: maximum Prebid JSON file size.
- `PREBID_MAX_BUCKETS`: maximum number of generated `hb_pb` values.
- `GAM_MAX_BULK_CREATE`: maximum resources in one create/clone/associate call.
- `GAM_MAX_BULK_UPDATE`: maximum resources in one update call.
- `GAM_WRITE_BATCH_SIZE`: application checkpoint batch size (default `20`, maximum `50`).
- `GAM_PLAN_STORE_DIR`: local persistent plan/checkpoint directory.
- `GAM_PLAN_MAX_AGE_MS`: maximum plan lifetime before a new audit/plan is required.

List tools automatically consume API pages up to their limit and return `truncated`,
`nextPageToken`, and warnings when more data exists.

## MCP call examples

The following are JSON-RPC messages a connected MCP client can send after initialization:

```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "tools/call",
  "params": {
    "name": "gam_list_orders",
    "arguments": { "status": "APPROVED", "name": "homepage", "limit": 100 }
  }
}
```

Direct Prebid analysis:

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "tools/call",
  "params": {
    "name": "prebid_analyze_granularity",
    "arguments": { "config": { "priceGranularity": "dense" } }
  }
}
```

Custom granularity loaded from a file:

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "tools/call",
  "params": {
    "name": "prebid_generate_price_buckets",
    "arguments": { "filePath": "/opt/gam-prebid/config/prebid.config.json" }
  }
}
```

Read-only GAM + Prebid Order audit for five simultaneous Ad Units:

```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "method": "tools/call",
  "params": {
    "name": "prebid_audit_order",
    "arguments": {
      "orderId": "12345",
      "simultaneousAdUnits": 5,
      "config": {
        "priceGranularity": "dense",
        "currency": "USD",
        "targetingKeys": ["hb_pb", "hb_bidder", "hb_adid", "hb_size"],
        "universalCreative": { "enabled": true, "require1x1": true }
      }
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "tools/call",
  "params": {
    "name": "gam_list_line_items",
    "arguments": {
      "orderId": "12345",
      "lineItemType": "STANDARD",
      "adUnitId": "67890",
      "limit": 500
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "tools/call",
  "params": { "name": "gam_audit_order", "arguments": { "orderId": "12345" } }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "tools/call",
  "params": { "name": "gam_audit_inventory", "arguments": {} }
}
```

Recommendation with weighted historical bids and an operational ceiling:

```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "method": "tools/call",
  "params": {
    "name": "prebid_plan_granularity",
    "arguments": {
      "mode": "recommend",
      "currency": "USD",
      "maxLineItems": 300,
      "historicalData": {
        "floorPrice": 0.5,
        "currency": "USD",
        "histogram": [
          { "cpm": 0.75, "count": 1200 },
          { "cpm": 1.25, "count": 900 },
          { "cpm": 4.8, "count": 250 }
        ]
      }
    }
  }
}
```

Non-executing GAM plan:

```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "method": "tools/call",
  "params": {
    "name": "gam_plan_prebid_granularity",
    "arguments": {
      "mode": "dense",
      "currency": "USD",
      "orderId": "12345",
      "lineItemTemplate": {
        "namePrefix": "Prebid USD",
        "priority": 12,
        "lineItemType": "PRICE_PRIORITY",
        "creativePlaceholderSizes": ["1x1"],
        "simultaneousAdUnits": 5
      }
    }
  }
}
```

Dry-run Order update, which is also the behavior when `dryRun` is omitted:

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "method": "tools/call",
  "params": {
    "name": "gam_update_order",
    "arguments": {
      "dryRun": true,
      "update": {
        "orderId": "12345",
        "patch": { "name": "Prebid 2026 — reviewed", "notes": "Audited by MCP" }
      }
    }
  }
}
```

A real execution uses the same typed payload but requires `dryRun: false` plus both global write
gates disabled. Bulk calls use the plural field (`orders`, `updates`, `lineItems`, `creatives`,
`associations`, or `clones`).

## Current scope

Implemented: complete GAM read paths, optional direct/file Prebid parsing, standard and custom price
bucket generation, GAM + Prebid comparison, statistically guarded granularization simulation and
planning, hashed non-executing GAM plans, safe structured outputs, controlled concurrency,
execution-local caches, partial audits, structured findings, typed create/update/clone operations,
idempotency checks, bounded bulk processing, logical update rollback, and structured write audits.

Not implemented: deletion, archive/unarchive, pause/activate, approval actions, generic updates,
non-ThirdPartyCreative creation, or automatic application of a granularity plan.
