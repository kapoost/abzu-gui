# Reference implementer field notes, part 1 — the shape

Live at [`abzu.rocketscience.pl`](https://abzu.rocketscience.pl). Four role tabs — governance reviewer, buyer operator, publisher operator, sponsor — over four AAO-verified agents. Every button is a real MCP call. No fixtures.

**Four agents because AdCP splits three concerns that usually get blurred.**
- **Abzu Governance** (`governance/3.1`) owns budget caps + audit ledger.
- **Abzu Orchestrator** (`media-buy/3.1`) fans a brief out to 12 sellers, ranks proposals, executes buys.
- **Purrsonality Seller** (`media-buy/3.0` — one of ours; the other 11 come from the AAO registry) publishes inventory, reviews creatives, serves banners on `purrsonality.rocketscience.pl`.
- **Purrsonality Signals** (`signals/3.1`) is the audience-provider surface — separate protocol, separate agent.

**The fan-out is real.** 12 sellers, mostly failing on any given run. Auth-not-configured, cold starts, unreachable URLs, version mismatches — the GUI classifies each red pill so the story reads as "your buyer is doing its job; the ecosystem isn't there yet." Only Purrsonality Seller reliably completes the full loop end-to-end. That's fine — the point of the fan-out is to be honest about what an AdCP buyer actually sees today. Classifier: [`2c83e78`](https://github.com/kapoost/abzu-gui/commit/2c83e78).

**Governance runs before every buy.** `check_governance → create_media_buy → sync_creatives → update_media_buy(creative_assignments) → report_plan_outcome`. Five MCP writes per Sam-side execution. Skip the check and the Sponsor tab has nothing to read.

**State is the protocol traffic itself.** Sam's buy flows through localStorage into the breadcrumb; the Operator queue picks up the new pending creative; Sponsor's audit reads the same governance ledger. Every tab is a projection, not a separate workflow.

**Post-deploy seed keeps it warm.** Fly redeploys wipe the seller's creatives table. `bun run seed:post-deploy` walks the full flow twice (once per placement) so both live slots serve `AdCP protocol`-badged banners the moment the demo goes live. Playwright asserts the iframe injection actually fires.

Part 2 is the pot-holes.

---

Repos: [`abzu-orchestrator`](https://github.com/kapoost/abzu-orchestrator) · [`abzu-gui`](https://github.com/kapoost/abzu-gui) · [`purrsonality-seller-agent`](https://github.com/kapoost/purrsonality-seller-agent) · [`purrsonality-site`](https://github.com/kapoost/purrsonality-site) · Łukasz Kapuśniak, `kapoost@gmail.com`.
