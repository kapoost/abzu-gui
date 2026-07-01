#!/usr/bin/env bun
/*
 * Post-deploy end-to-end.
 *
 * Purrsonality-seller's startup wipes creatives on every boot (test
 * hygiene), so every deploy leaves both live slots without an approved
 * AdCP creative — the slots then fall back to the house "generic
 * campaign" banner. This script re-seeds the state through the public
 * AdCP flow so at least one creative is approved per placement, giving
 * the demo the "AdCP protocol" badge instead of the fallback the moment
 * a visitor lands.
 *
 * Flow (real endpoints, no fixtures):
 *   1. POST /governance/plans                — register a seed plan
 *   2. POST /execution/buy                    — one buy per placement
 *   3. POST /creatives/sync                   — attach an agent-crafted
 *      SVG (seller /generated/agent-creative.svg) and let Abzu chain
 *      update_media_buy(creative_assignments) via assign_to_media_buy_id
 *   4. POST /seller/creatives/:id/approve     — through Abzu's server-
 *      side proxy so we don't need the seller's bearer token locally
 *   5. GET  /live/{landing,result}-slot       — assert the AdCP badge
 *   6. Playwright chromium                    — open landing + a persona
 *      page on purrsonality.rocketscience.pl with consent granted and
 *      assert an iframe is injected pointing at the seller slot
 *
 * Usage:
 *   bun scripts/post-deploy-e2e.mjs
 *
 * Env overrides:
 *   ABZU_URL         (default https://api.rocketscience.pl)
 *   SELLER_URL       (default https://seller.purrsonality.rocketscience.pl)
 *   PURRSONALITY_URL (default https://purrsonality.rocketscience.pl)
 *   RUN_ID           (default post-deploy-<epoch>)
 *   SEED_BRAND       (default acme.example.com)
 *   SEED_BRAND_NAME  (default Acme)
 *   SKIP_PLAYWRIGHT  (set to any value to skip the UI check)
 */

const ABZU = process.env.ABZU_URL ?? "https://api.rocketscience.pl";
const SELLER = process.env.SELLER_URL ?? "https://seller.purrsonality.rocketscience.pl";
const PURRSONALITY = process.env.PURRSONALITY_URL ?? "https://purrsonality.rocketscience.pl";
const RUN_ID = process.env.RUN_ID ?? `post-deploy-${Date.now()}`;
const BRAND = process.env.SEED_BRAND ?? "acme.example.com";
const BRAND_NAME = process.env.SEED_BRAND_NAME ?? "Acme";

const PLACEMENTS = [
  {
    key: "landing",
    productId: "purr_landing_rectangle_v1",
    pricingOptionId: "cpm_fixed_1",
    formatId: "display_300x250",
    size: "300x250",
    w: 300,
    h: 250,
    personaPath: "/",
  },
  {
    key: "result",
    productId: "purr_result_card_v1",
    pricingOptionId: "cpm_fixed_1",
    formatId: "display_300x250",
    size: "300x250",
    w: 300,
    h: 250,
    personaPath: "/r/hunter",
  },
];

async function step(name, fn) {
  const start = Date.now();
  try {
    const r = await fn();
    console.log(`  ✓ ${name} · ${Date.now() - start}ms`);
    return r;
  } catch (err) {
    console.error(`  ✗ ${name} · ${Date.now() - start}ms · ${err.message}`);
    throw err;
  }
}

async function fetchJson(url, init = {}) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) {
    const preview = typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200);
    throw new Error(`HTTP ${r.status} ${url} — ${preview}`);
  }
  return body;
}

async function registerPlan(planId) {
  return fetchJson(`${ABZU}/governance/plans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      plans: [{
        plan_id: planId,
        brand: { domain: BRAND },
        objectives: "post-deploy seed: keep at least one AdCP creative live per placement",
        budget: { total: 10000, currency: "USD", reallocation_threshold: 5000 },
        flight: { start: "2026-07-15T00:00:00Z", end: "2026-08-15T23:59:59Z" },
      }],
    }),
  });
}

async function executeBuy(planId, productId, pricingOptionId) {
  return fetchJson(`${ABZU}/execution/buy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      seller_id: "purrsonality-seller",
      plan_id: planId,
      account: { brand: { domain: BRAND }, operator: BRAND },
      brand: { domain: BRAND, name: BRAND_NAME },
      product_id: productId,
      pricing_option_id: pricingOptionId,
      budget: 1500,
      currency: "USD",
      flight: { start: "2026-07-15T00:00:00Z", end: "2026-08-15T23:59:59Z" },
      accept_conditions: false,
    }),
  });
}

async function syncAndAssign(mediaBuyId, placement, creativeId) {
  const svgUrl = `${SELLER}/generated/agent-creative.svg?brand=${encodeURIComponent(BRAND_NAME)}&product=${encodeURIComponent(placement.productId)}&size=${placement.size}`;
  return fetchJson(`${ABZU}/creatives/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      seller_id: "purrsonality-seller",
      assign_to_media_buy_id: mediaBuyId,
      account: { brand: { domain: BRAND }, operator: BRAND },
      creatives: [{
        creative_id: creativeId,
        name: creativeId,
        format_id: { agent_url: "https://creative.adcontextprotocol.org", id: placement.formatId },
        assets: {
          image: { asset_type: "image", url: svgUrl, width: placement.w, height: placement.h, alt_text: `${BRAND_NAME} — ${placement.key}` },
          click_url: { asset_type: "url", url: `https://${BRAND}` },
        },
      }],
    }),
  });
}

async function approveCreative(creativeId) {
  return fetchJson(`${ABZU}/seller/creatives/${encodeURIComponent(creativeId)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function verifySlot(placement) {
  const url = `${SELLER}/live/${placement}-slot`;
  const r = await fetch(url);
  const html = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  if (html.includes("AdCP protocol")) return { url, badge: "AdCP protocol" };
  if (html.includes("generic campaign")) throw new Error(`${placement}: still on generic fallback — seed didn't stick`);
  throw new Error(`${placement}: unrecognized slot response`);
}

async function verifyIframeInBrowser() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("  ⚠  playwright not installed — skipping UI check");
    console.log("     add it with:  bun add -d playwright && bunx playwright install chromium");
    return;
  }
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    // Pre-grant consent so the inline injector runs the iframe path
    // without ConsentBanner interaction.
    const purrHost = new URL(PURRSONALITY).host;
    await context.addCookies([{ name: "purr_consent", value: "accepted", domain: purrHost, path: "/" }]);
    for (const p of PLACEMENTS) {
      const target = `${PURRSONALITY}${p.personaPath}`;
      const page = await context.newPage();
      await page.goto(target, { waitUntil: "domcontentloaded" });
      // AdSlot injects the iframe asynchronously in the client after the
      // consent check; wait for one anchored on /live/<placement>-slot.
      try {
        await page.waitForSelector(`iframe[src*="/live/${p.key}-slot"]`, { timeout: 8000 });
        console.log(`  ✓ ${p.key}: iframe present at ${target}`);
      } catch {
        throw new Error(`${p.key}: iframe not injected within 8s at ${target}`);
      }
      await page.close();
    }
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Post-deploy seed · run_id=${RUN_ID}`);
  console.log(`  abzu:          ${ABZU}`);
  console.log(`  seller:        ${SELLER}`);
  console.log(`  purrsonality:  ${PURRSONALITY}`);
  console.log();

  console.log("Registering plan:");
  await step(`plan ${RUN_ID}`, () => registerPlan(RUN_ID));

  console.log();
  console.log("Buying + syncing + approving per placement:");
  for (const p of PLACEMENTS) {
    const creativeId = `${RUN_ID}__${p.key}`.slice(0, 96);
    const buy = await step(`buy ${p.productId}`, () => executeBuy(RUN_ID, p.productId, p.pricingOptionId));
    const mbId = buy.media_buy?.media_buy_id;
    if (!mbId) throw new Error(`no media_buy_id in buy response: ${JSON.stringify(buy).slice(0, 200)}`);
    await step(`sync + assign → ${mbId.slice(0, 24)}…`, () => syncAndAssign(mbId, p, creativeId));
    await step(`approve ${creativeId}`, () => approveCreative(creativeId));
  }

  console.log();
  console.log("Verifying live slots serve AdCP badge:");
  for (const p of PLACEMENTS) {
    const v = await step(`${p.key}-slot`, () => verifySlot(p.key));
    console.log(`      ${v.url} → ${v.badge}`);
  }

  if (process.env.SKIP_PLAYWRIGHT) {
    console.log();
    console.log("Skipping playwright UI check (SKIP_PLAYWRIGHT set).");
  } else {
    console.log();
    console.log("Verifying iframe injection on purrsonality:");
    await verifyIframeInBrowser();
  }

  console.log();
  console.log(`✓ Post-deploy seed complete. Both placements are serving AdCP creatives.`);
}

main().catch((err) => {
  console.error();
  console.error(`✗ FAILED: ${err.message}`);
  process.exit(1);
});
