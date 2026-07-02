# SDK 9.3 `create_media_buy` overrides adopter's task-envelope `status`

**Target repo:** `adcontextprotocol/adcp-client`
**Suggested labels:** bug, wire-format, media-buy-3.1

## Problem

In AdCP 3.1 the top-level `status` on `create-media-buy-response.json` is the **task-envelope status**
(`completed / submitted / failed / …`), while the lifecycle value lives on `media_buy_status`
(`pending_creatives / pending_start / active / paused / …`). See
`protocols/media-buy/scenarios/pending_creatives_to_start.yaml` validations on `create_buy_no_creatives`:

```yaml
- check: field_value
  path: "media_buy_status"
  value: "pending_creatives"
- check: field_value
  path: "status"
  value: "completed"
```

Adopters returning `{ media_buy_status: 'pending_creatives', status: 'completed', … }` still fail the
`status: 'completed'` check on the wire.

## Suspicion

The runtime projector wraps the adopter's `CreateMediaBuySuccess` in a task envelope (either through
`routeIfHandoff → projectSync` or `dispatchHitl`). The envelope's `status` appears to override the value the
adopter set — so no matter what the adopter returns for top-level `status`, the storyboard reads the
projector's envelope status.

## Impact

The `pending_creatives_to_start/create_without_creatives` storyboard cannot pass unless the projector's
envelope status is `completed` for the synchronous-success arm — or the projector defers to the adopter's
`status` when present.

## Suggested fix

Either:
- Make the projector's task envelope prefer the adopter's `status` when the adopter set it and its value is a
  valid task-status enum member;
- Or, make the projector always set `status: 'completed'` on the synchronous-success arm regardless of the
  adopter's value (matches the storyboard expectation, given the adopter still owns `media_buy_status`).

Option 2 seems cleaner: adopters can't accidentally leak lifecycle values into the task envelope, and 3.1's
separation of concerns holds without adopter-side vigilance.

## Reproduction

Observed on `https://seller.purrsonality.rocketscience.pl/mcp`. Adopter code sets:

```ts
media_buy_status: status,  // MediaBuyStatus
status: 'completed',        // task envelope
```

Storyboard reports `FAILED: create_buy_no_creatives — Create buy in pending_creatives`, expected
`status: completed`.
