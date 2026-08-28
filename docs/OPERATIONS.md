# Operations guide

## Installation

Requirements are Node.js 20+, a Google Cloud project, a Google Ad Manager network, and a GAM user
with API access. Install and validate locally:

```bash
cp .env.example .env
npm install
npm run check
npm run build
```

Configure an MCP client to execute `node /absolute/path/gam-prebid-mcp/dist/index.js`. The server
uses stdio: stdout is reserved for MCP JSON-RPC and structured application/audit logs go to stderr.

## Authentication and least privilege

Google Ad Manager requires OAuth 2.0. For a service account, create the account in Google Cloud,
store its JSON outside the repository, add its email as a user in GAM under **Admin > Access &
authorization > Users**, and grant only the role needed for the intended mode. Point
`GOOGLE_APPLICATION_CREDENTIALS` to the absolute JSON path. Application Default Credentials are
also supported.

For GAM-only auditing, use a read-only GAM role and keep `GAM_READ_ONLY=true`. For controlled
application, use a narrowly-scoped custom GAM role that can read Orders, Line Items, Creatives and
Custom Targeting and create/update only the required Line Items/Creatives/associations. Keep Network
and Order allowlists narrow. The OAuth scope required by the GAM API is
`https://www.googleapis.com/auth/admanager`; authorization inside GAM is still determined by the
service-account user's role.

Official references:

- [Google Ad Manager API authentication](https://developers.google.com/ad-manager/api/authentication)
- [Google Ad Manager API getting started](https://developers.google.com/ad-manager/api/start)
- [Google Ad Manager API concepts](https://developers.google.com/ad-manager/api/intro)

Never commit `.env`, credential JSON, PEM/P12 files, or `.gam-prebid-plans`. The repository ignore
rules cover the common forms, but operational secret storage remains the deployer's responsibility.

## Configuration

Required:

```dotenv
GAM_NETWORK_CODE=12345678
```

Safe global gates and allowlists:

```dotenv
GAM_READ_ONLY=true
GAM_DRY_RUN=true
GAM_ALLOWED_NETWORK_CODES=12345678
GAM_ALLOWED_ORDER_IDS=12345
```

Plan execution:

```dotenv
GAM_MAX_BULK_CREATE=50
GAM_MAX_BULK_UPDATE=50
GAM_WRITE_BATCH_SIZE=20
GAM_PLAN_STORE_DIR=.gam-prebid-plans
GAM_PLAN_MAX_AGE_MS=86400000
```

`GAM_WRITE_BATCH_SIZE` cannot exceed 50. A real plan apply additionally requires
`GAM_READ_ONLY=false`, `GAM_DRY_RUN=false`, and the call-level `dryRun:false`. Changing only one gate
does not enable writes.

Timeout, retry, pagination, audit concurrency, SOAP version, and optional Prebid file allowlist
settings are documented in `.env.example`. Retry is restricted to transient errors; creates rely on
idempotency lookup rather than blind automatic retries. Google's troubleshooting guidance recommends
batching, exponential backoff, and respecting quota/rate-limit responses:
[GAM API troubleshooting](https://developers.google.com/ad-manager/api/troubleshooting).

## MCP workflow

The GAM-only workflow is independent:

1. `gam_connection_test`
2. `gam_list_orders` / `gam_get_order`
3. `gam_audit_order`
4. `gam_audit_inventory`

No Prebid configuration is loaded by these tools.

The application workflow must use separate calls:

1. Audit with `gam_audit_order` and, when relevant, `prebid_audit_order`.
2. Create and persist a plan with `prebid_create_granularity_plan`.
3. Inspect `create`, `update`, `associate`, `unchanged`, warnings, and errors.
4. Simulate with `prebid_apply_granularity_plan` and `dryRun:true`.
5. Validate/seal with `prebid_validate_granularity_plan`.
6. Apply with `prebid_apply_granularity_plan` and `dryRun:false`.
7. Prove the outcome with `prebid_post_apply_audit`.

Example plan creation using no automatic Creative action:

```json
{
  "name": "prebid_create_granularity_plan",
  "arguments": {
    "networkCode": "12345678",
    "orderId": "12345",
    "mode": "dense",
    "currency": "USD",
    "baseLineItemId": "98765",
    "lineItemTemplate": {
      "namePrefix": "Prebid USD",
      "priority": 12,
      "lineItemType": "PRICE_PRIORITY",
      "creativePlaceholderSizes": ["1x1"],
      "simultaneousAdUnits": 5
    },
    "creativeStrategy": { "mode": "none" }
  }
}
```

Dry-run, validation, apply, and proof:

```json
{ "name": "prebid_apply_granularity_plan", "arguments": { "planId": "prebid-apply:0123456789abcdef", "dryRun": true } }
{ "name": "prebid_validate_granularity_plan", "arguments": { "planId": "prebid-apply:0123456789abcdef" } }
{ "name": "prebid_apply_granularity_plan", "arguments": { "planId": "prebid-apply:0123456789abcdef", "dryRun": false } }
{ "name": "prebid_post_apply_audit", "arguments": { "planId": "prebid-apply:0123456789abcdef" } }
```

Standard MCP clients wrap these values in `tools/call` JSON-RPC messages.

## Creative strategies

- `none`: creates no Creative or association and reports remaining manual work.
- `reuse`: requires enough explicit, already-audited `creativeIds`; size compatibility is checked.
- `clone`: requires an explicit `sourceCreativeId`; each clone has a deterministic idempotency key.
- `create`: requires an explicit ThirdPartyCreative template, including snippet and size.

No clone is inferred from a Line Item or existing association. Creative snippets are redacted in MCP
plan output and structured audit logs; the owner-only plan file retains the template because it is
required for later execution.

## Drift, failure, and recovery

Snapshots canonically hash the Order, every audited Line Item (including targeting), associated
Creatives, LICAs, and Custom Targeting keys/values. Drift produces `PLAN_STALE`; force-apply is not
available. Create a new audit and plan.

On an ordinary batch failure, the report contains `stoppedAtActionId`, `lastError`, completed counts,
and remaining action count. Resolve a transient API/quota issue and call the same validated plan again
with `dryRun:false`. Completed actions are not replayed, while the underlying resource operations
remain idempotent. If the MCP process or host is interrupted at an indeterminate network boundary,
run a GAM audit first. A detected checkpoint difference deliberately makes the plan stale; create a
new plan rather than bypassing drift protection.

There are no delete operations and no automatic compensating deletes. Resources created before a
failure are reported and preserved.

## Troubleshooting

- `NETWORK_NOT_ALLOWED` / `ORDER_NOT_ALLOWED`: update the explicit allowlist; do not broaden it beyond
  the operational scope.
- `READ_ONLY` / `DRY_RUN`: a real apply needs both global gates disabled and call-level
  `dryRun:false`.
- `PLAN_INVALID_STATE`: follow the state sequence; validation cannot precede dry-run.
- `PLAN_STALE`: GAM changed materially; audit and create a new plan.
- `PLAN_TAMPERED`: the sealed plan file changed; do not edit it—create a new plan.
- `PLAN_EXPIRED`: the plan exceeded `GAM_PLAN_MAX_AGE_MS`.
- `GAM_RATE_LIMITED`: wait, preserve the plan/checkpoint, and resume. Do not increase concurrency as
  the first response.
- Partial audit findings: restore the unavailable API/service and repeat; absence-based planning is
  blocked when the audit is partial.

SOAP Line Item and LICA operations follow the typed service contracts documented by Google:
[LineItemService reference](https://developers.google.com/ad-manager/api/reference/v202511/LineItemService).

## Production acceptance run

Before enabling real writes on a production Order, demonstrate in a test network or dedicated
allowlisted Order that the server can connect, locate/audit the Order, audit Creatives and targeting,
run GAM-only analysis, parse Prebid, generate buckets, compare gaps, create a plan, dry-run and inspect
its diff, validate/seal, apply in batches, post-audit, and obtain `matchesPlan:true`. Retain stderr
audit JSON and the final report as change evidence.
