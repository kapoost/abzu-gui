# SDK 9.3 `sync_creatives` handler doesn't receive top-level `assignments`

**Target repo:** `adcontextprotocol/adcp-client`
**Suggested labels:** bug, adopter-api, media-buy-3.1

## Problem

`sync-creatives-request.json` (3.1) declares two ways to attach creatives to packages:
- Per-creative: `creatives[i].assignments`
- Bulk top-level: `assignments: [{ creative_id, package_id, weight?, targeting? }]`

The SDK adopter contract for sales platforms is `sales.syncCreatives(creatives, ctx)` — only the `creatives`
array is passed positionally. The runtime projector reads `params.creatives` and drops `params.assignments`:

```js
// src/lib/server/decisioning/runtime/from-platform.js ~L3221
syncCreatives: async (params, ctx) => {
    const reqCtx = ctxFor(ctx, params);
    const creatives = params.creatives ?? [];
    // ... params.assignments is never surfaced to the adapter
    const result = await sales.syncCreatives(creatives, reqCtx);
    // ...
},
```

Adapters trying to reach `assignments` via `ctx.input.assignments` find `ctx.input` unpopulated (or containing
a projection that already dropped the field).

## Impact

The compliance storyboard `media_buy_seller/creative_fate_after_cancellation/reuse_creative_on_new_buy`
issues:

```yaml
task: sync_creatives
sample_request:
  creatives: [{ creative_id: "acme_reuse_banner_001", ... }]
  assignments:
    - creative_id: "acme_reuse_banner_001"
      package_id: "$context.second_package_id"
```

The adapter has no way to observe the bulk `assignments` list, so it cannot bind the reused creative to the
new buy's package. Adopters implementing the alternate `creatives[i].assignments` per-creative form pass; the
bulk form is unimplementable through this SDK.

## Suggested fix

Either:
- Widen the adopter contract to `sales.syncCreatives(creatives, assignments, ctx)` — dropping the assignments
  arg to `undefined` when omitted preserves backwards compatibility;
- Or expose `params.assignments` on `ctx` (e.g. `ctx.input.assignments` guaranteed).

Either variant lets adopters implement the bulk-assignment form without accessing framework internals.

## Reproduction

Observed on `https://seller.purrsonality.rocketscience.pl/mcp`. Adapter reads `ctx.input?.assignments`;
returns empty on the storyboard's `reassign_creative` step, so the seller's package-creative assignment map
never learns of the reuse. Storyboard fails with `Assign the original creative_id to the new package`.
