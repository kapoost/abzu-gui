# Reference implementer field notes, part 2 — the pot-holes

Three things I'd tell anyone shipping an AdCP reference implementer on `@adcp/sdk 9.3`.

**1. Wire impression attribution to Postgres, not in-memory.** `impressionsStore.record({media_buy_id: 'live-result-slot'})` was the first version — one static string, all impressions land there, `getMediaBuyDelivery(mb_abzu_...)` returns zero forever. The fix is a schema migration: `creatives.assigned_media_buy_id`, populated on `update_media_buy(creative_assignments)`, read by `/live/*-slot`. Persistent link survives seller restarts (in-memory `mockUpstream` doesn't). [`f6c9fdc`](https://github.com/kapoost/purrsonality-seller-agent/commit/f6c9fdc).

**2. Ship a fallback creative before you ship the buy form.** Most demo runs the tester leaves the banner URL blank. Without a fallback, the live slot serves broken images or nothing. `GET /generated/agent-creative.svg?brand=X&product=Y&size=WxH` renders a branded SVG on the fly — gradient hue hashed from the brand name, `AGENT-CRAFTED` badge in the corner. GUI wires the URL into `sync_creatives` when the image field is empty. Load-bearing for a demo that random visitors land on cold. [`2630ca0`](https://github.com/kapoost/purrsonality-seller-agent/commit/2630ca0).

**3. Three SDK 9.3 wire-projection gaps block the 3.1 badge on the seller.**
- `list_accounts` — SDK emits `next_cursor` top-level; 3.1 schema requires a `pagination` block ([`adcp#5723`](https://github.com/adcontextprotocol/adcp/issues/5723)).
- `create_media_buy` — adapter sets `status: 'completed'`, projector overwrites with the lifecycle value ([`adcp#5416`](https://github.com/adcontextprotocol/adcp/issues/5416)).
- `sync_creatives` — top-level `assignments` never reaches `sales.syncCreatives(creatives, ctx)`; `creative_fate_after_cancellation` is unimplementable ([`adcp#5797`](https://github.com/adcontextprotocol/adcp/issues/5797)).

None of these are adopter-side bugs. All three are why Purrsonality Seller badges at Media Buy Agent **3.0** instead of 3.1 today. Real buyers on 3.0 don't see any of it — the gap only surfaces in the conformance harness, which is exactly what a reference implementer cares about.

**What I'd do differently.** Read `dist/lib/server/decisioning/runtime/from-platform.js` before writing the adapter. File issues as you find them, not at the end. Wire the seed script into the deploy pipeline so the demo never goes cold. Everything else was fine on the first try — these three weren't.

---

Live: [`abzu.rocketscience.pl`](https://abzu.rocketscience.pl) · [`purrsonality.rocketscience.pl`](https://purrsonality.rocketscience.pl). Repos on [`github.com/kapoost`](https://github.com/kapoost). Łukasz Kapuśniak, `kapoost@gmail.com`.
