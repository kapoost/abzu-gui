# SDK 9.3 `list_accounts` response missing `pagination` block

**Target repo:** `adcontextprotocol/adcp-client`
**Suggested labels:** bug, wire-format, media-buy-3.1

## Problem

`adopters.accounts.list` handler contract in SDK 9.3 returns `{ items, nextCursor? }`. The runtime projector in
`src/lib/server/decisioning/runtime/from-platform.js` (~L4036) maps this to the wire as:

```js
return projectSync(() => accounts.list(filter, resolveCtx), page => ({
    status: 'completed',
    accounts: page.items.map(account_1.toWireAccount),
    ...(page.nextCursor != null && { next_cursor: page.nextCursor }),
}));
```

The `next_cursor` field lands **top-level**, but the AdCP 3.1
`list-accounts-response.json` schema declares pagination through a nested `pagination` block
(`pagination.has_more`, `pagination.cursor`, `pagination.total_count`) referencing `core/pagination-response.json`.

## Impact

The compliance storyboard `pagination_integrity_list_accounts/pagination_walk` cannot pass on any adopter
using SDK 9.3, because its `first_page` validations run against `pagination.*` — those fields never appear on
the wire regardless of what the adopter returns from `.list()`:

- `field_value path: "pagination.has_more" value: true`
- `field_present path: "pagination.cursor"`

Same wire projection ships to all `sales-*` specialisms — every seller wired through `from-platform` is
affected.

## Reproduction

Any seller with 3+ sandbox accounts, using SDK 9.3, will fail the storyboard even if their `accounts.list()`
implementation returns correct `{ items, nextCursor }`. Observed on
`https://seller.purrsonality.rocketscience.pl/mcp` — quality report available on request.

## Suggested fix

Extend the runtime projector to translate `{ items, nextCursor }` into the 3.1 pagination block:

```js
return projectSync(() => accounts.list(filter, resolveCtx), page => ({
    status: 'completed',
    accounts: page.items.map(account_1.toWireAccount),
    pagination: {
        has_more: page.nextCursor != null,
        ...(page.nextCursor != null && { cursor: page.nextCursor }),
        ...(page.totalCount != null && { total_count: page.totalCount }),
    },
}));
```

Extend the `accounts.list` return type to accept optional `totalCount` so adopters can populate it. Optionally
retain `next_cursor` on the wire as a deprecated field until 4.0.

Same pattern likely applies to any other `list_*` tool that already implements pagination through the same
plumbing; a `toWirePagination` helper would consolidate the mapping.
