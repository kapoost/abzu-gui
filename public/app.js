"use strict";

const ABZU = window.ABZU_BASE_URL || "http://localhost:8787";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function activateRole(role) {
  for (const link of $$(".role-link")) {
    link.classList.toggle("active", link.dataset.role === role);
  }
  for (const view of $$("[data-view]")) {
    view.classList.toggle("hidden", view.dataset.view !== role);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("role", role);
  history.replaceState(null, "", url.toString());
}

function setStatus(text, ok = true) {
  const el = $("#status-pill");
  if (!el) return;
  el.textContent = text;
  el.className = `pill ${ok ? "pill-ok" : "pill-err"}`;
}

async function probeAbzu() {
  try {
    const r = await fetch(`${ABZU}/healthz`);
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    setStatus(`abzu ${d.version}`, true);
  } catch (err) {
    setStatus("abzu unreachable", false);
  }
}

const DEMO_STATE_KEY = "abzu.demoState";
const LAST_PLAN_KEY = "abzu.lastPlanId";

/* Shared demo state — the linear thread through Jordan → Sam → Riley → Taylor.
 * Each tab's success action writes to it, and every tab's breadcrumb + auto-fill
 * reads from it. Keys never expire; "Reset demo" clears them. */
function getDemoState() {
  try {
    const raw = localStorage.getItem(DEMO_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function patchDemoState(patch) {
  const next = { ...getDemoState(), ...patch, updated_at: new Date().toISOString() };
  try { localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(next)); } catch {}
  updateBreadcrumb();
  return next;
}

/* Pull plan.brand_domain + plan.objectives into Sam's brief form so the
 * user doesn't re-type the same info Jordan already approved. Brief text
 * gets pre-filled from objectives only when the user hasn't touched it yet
 * (preserves manual edits across navigation). */
function applyPlanInheritsToBrief() {
  const state = getDemoState();
  if (!state.plan_brand_domain && !state.plan_objectives) return;
  const briefForm = document.getElementById("brief-form");
  if (!briefForm) return;
  const advDomain = briefForm.querySelector('[name="advertiser_domain"]');
  if (advDomain && state.plan_brand_domain && (!advDomain.value || advDomain.value === "acme.example.com")) {
    advDomain.value = state.plan_brand_domain;
    advDomain.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const briefText = briefForm.querySelector('[name="brief"]');
  if (briefText && state.plan_objectives && !briefText.dataset.userTouched) {
    briefText.value = state.plan_objectives;
  }
  // Same for the buy form's brand_domain so executing the buy doesn't
  // re-prompt for the brand the plan was registered against.
  const buyForm = document.getElementById("buy-form");
  if (buyForm && state.plan_brand_domain) {
    const brandDomain = buyForm.querySelector('[name="brand_domain"]');
    if (brandDomain && (!brandDomain.value || brandDomain.value === "acme.example.com")) {
      brandDomain.value = state.plan_brand_domain;
    }
  }
}

function updateBreadcrumb() {
  const state = getDemoState();
  for (const el of $$(".breadcrumb")) {
    const steps = el.querySelectorAll(".step");
    if (!steps.length) return;
    const hasPlan = !!state.plan_id;
    const hasBuy = !!state.media_buy_id;
    const hasCreative = !!state.creative_id;
    const hasApproved = !!state.creative_approved;
    steps.forEach((step) => {
      const key = step.dataset.step;
      step.classList.remove("done", "active");
      if (key === "plan" && hasPlan) step.classList.add("done");
      else if (key === "buy" && hasBuy) step.classList.add("done");
      else if (key === "creative" && hasCreative) step.classList.add(hasApproved ? "done" : "active");
      else if (key === "audit" && hasApproved) step.classList.add("done");
    });
  }
}

function getLastPlanId() {
  const state = getDemoState();
  if (state.plan_id) return state.plan_id;
  try { return localStorage.getItem(LAST_PLAN_KEY) || ""; } catch { return ""; }
}

function setLastPlanId(planId) {
  if (!planId) return;
  try { localStorage.setItem(LAST_PLAN_KEY, planId); } catch {}
  patchDemoState({ plan_id: planId });
  for (const input of $$(".plan-input")) {
    if (!input.value) input.value = planId;
  }
}

let knownPlansCache = [];

// setInterval that skips ticks while the tab is hidden and does one
// catch-up refresh when it comes back. Background tabs were the main
// driver of abzu's Neon compute burn (three pollers × every open tab).
function visibleInterval(fn, ms) {
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) fn();
  });
  return id;
}

async function refreshKnownPlans() {
  const status = $("#plans-listing-status");
  const samStatus = $("#sam-plan-select-status");
  if (status) status.textContent = "loading…";
  try {
    const r = await abzu("/governance/plans");
    if (!r.ok) {
      if (status) status.textContent = `error · HTTP ${r.status}`;
      if (samStatus) samStatus.textContent = "unavailable";
      return;
    }
    const plans = Array.isArray(r.body?.plans) ? r.body.plans : [];
    knownPlansCache = plans;
    const dl = $("#known-plans");
    if (dl) {
      dl.innerHTML = "";
      for (const p of plans) {
        const opt = document.createElement("option");
        opt.value = p.plan_id;
        opt.label = p.brand_domain ? `${p.brand_domain} · ${p.synced_at.slice(0, 19)}` : p.synced_at.slice(0, 19);
        dl.appendChild(opt);
      }
    }
    renderPlansListing(plans);
    renderSamPlansSelect(plans);
    renderSponsorCampaignsListing(plans);
    const sponsorStatus = $("#sponsor-campaigns-status");
    if (sponsorStatus) sponsorStatus.textContent = `${plans.length} plan${plans.length === 1 ? "" : "s"} · ${new Date().toLocaleTimeString()}`;
    if (status) status.textContent = `${plans.length} plan${plans.length === 1 ? "" : "s"} · ${new Date().toLocaleTimeString()}`;
    if (samStatus) samStatus.textContent = `${plans.length} available`;
  } catch (err) {
    if (status) status.textContent = "error";
    if (samStatus) samStatus.textContent = "unavailable";
  }
}

function renderPlansListing(plans) {
  const tbody = $("#plans-listing-tbody");
  if (!tbody) return;
  if (!plans.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-2 py-3 text-zinc-500 text-sm">No plans registered yet. Fill the form above and click <em>Register plan</em>.</td></tr>`;
    return;
  }
  tbody.innerHTML = plans.map((p) => {
    const synced = p.synced_at ? new Date(p.synced_at).toLocaleString() : "—";
    const brand = p.brand_domain ?? "—";
    return `<tr class="border-b border-zinc-800 hover:bg-zinc-800/30">
      <td class="px-2 py-2 font-mono text-xs text-zinc-100">${esc(p.plan_id)}</td>
      <td class="px-2 py-2 text-zinc-300">${esc(brand)}</td>
      <td class="px-2 py-2 text-xs text-zinc-500">${esc(synced)}</td>
      <td class="px-2 py-2 text-right whitespace-nowrap">
        <button class="plan-load text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800/40" data-plan-id="${esc(p.plan_id)}" data-brand-domain="${esc(brand)}">Load</button>
        <button class="plan-audit text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800/40 ml-1" data-plan-id="${esc(p.plan_id)}">Audit</button>
      </td>
    </tr>`;
  }).join("");
  for (const btn of tbody.querySelectorAll(".plan-load")) {
    btn.addEventListener("click", () => loadPlanIntoJordanForm(btn.dataset.planId, btn.dataset.brandDomain));
  }
  for (const btn of tbody.querySelectorAll(".plan-audit")) {
    btn.addEventListener("click", () => {
      const input = $("#audit-plan-id");
      if (input) input.value = btn.dataset.planId;
      loadAudit(btn.dataset.planId);
    });
  }
}

function renderSamPlansSelect(plans) {
  const sel = $("#sam-plan-select");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">— pick a plan —</option>` + plans.map((p) => {
    const label = p.brand_domain
      ? `${p.plan_id} · ${p.brand_domain}`
      : p.plan_id;
    return `<option value="${esc(p.plan_id)}" data-brand-domain="${esc(p.brand_domain ?? "")}">${esc(label)}</option>`;
  }).join("");
  if (current && plans.some((p) => p.plan_id === current)) {
    sel.value = current;
  } else {
    const last = getLastPlanId();
    if (last && plans.some((p) => p.plan_id === last)) sel.value = last;
  }
}

function loadPlanIntoJordanForm(planId, brandDomain) {
  const form = $("#plan-form");
  if (!form) return;
  const planIdInput = form.querySelector('[name="plan_id"]');
  if (planIdInput) planIdInput.value = planId;
  const brandInput = form.querySelector('[name="brand_domain"]');
  if (brandInput && brandDomain && brandDomain !== "—") brandInput.value = brandDomain;
  const auditInput = $("#audit-plan-id");
  if (auditInput) auditInput.value = planId;
  setLastPlanId(planId);
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyPlanSelectionToSam(planId) {
  const plan = knownPlansCache.find((p) => p.plan_id === planId);
  if (!plan) return;
  setLastPlanId(planId);
  const briefForm = $("#brief-form");
  const advDomain = briefForm?.querySelector('[name="advertiser_domain"]');
  if (advDomain && plan.brand_domain && !advDomain.dataset.userTouched) {
    advDomain.value = plan.brand_domain;
    advDomain.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const buyForm = $("#buy-form");
  if (buyForm) {
    const planInput = buyForm.querySelector('[name="plan_id"]');
    if (planInput) planInput.value = planId;
    const brandDomain = buyForm.querySelector('[name="brand_domain"]');
    if (brandDomain && plan.brand_domain) brandDomain.value = plan.brand_domain;
  }
  patchDemoState({
    plan_id: planId,
    ...(plan.brand_domain ? { plan_brand_domain: plan.brand_domain } : {}),
  });
}

const brandsByDomain = new Map();

async function loadKnownBrands() {
  try {
    const res = await fetch("/brands.json");
    if (!res.ok) return;
    const body = await res.json();
    const dl = $("#known-brands");
    if (!dl) return;
    dl.innerHTML = "";
    for (const b of body?.brands ?? []) {
      if (!b?.domain) continue;
      brandsByDomain.set(b.domain.toLowerCase(), b.name ?? b.domain);
      const opt = document.createElement("option");
      opt.value = b.domain;
      opt.label = b.name ?? b.domain;
      dl.appendChild(opt);
    }
  } catch {}
}

let brandSearchTimer = null;
let brandSearchSeq = 0;
let liveBrandSearchDisabled = false;

async function liveBrandSearch(query) {
  if (liveBrandSearchDisabled) return;
  const seq = ++brandSearchSeq;
  try {
    const r = await abzu(`/brands?search=${encodeURIComponent(query)}&limit=30`);
    if (seq !== brandSearchSeq) return;
    if (r.status === 503) {
      liveBrandSearchDisabled = true;
      return;
    }
    if (!r.ok) return;
    const dl = $("#known-brands");
    if (!dl) return;
    for (const b of r.body?.brands ?? []) {
      if (!b?.domain) continue;
      const key = b.domain.toLowerCase();
      if (brandsByDomain.has(key)) continue;
      brandsByDomain.set(key, b.name ?? b.domain);
      const opt = document.createElement("option");
      opt.value = b.domain;
      opt.label = b.name ?? b.domain;
      dl.appendChild(opt);
    }
  } catch {}
}

let brandResolveTimer = null;
let brandResolveSeq = 0;
const brandResolveCache = new Map();

/* Try to fetch /.well-known/brand.json on the typed domain via Abzu's
 * proxy. If the brand publishes one, lift name/tagline into the form so
 * the user doesn't have to type their own brand back at us. Static
 * brands.json autofill (brandsByDomain) runs first; this is a richer
 * upgrade for domains that adopt AdCP brand.json. */
async function resolveBrandFromDomain(domain, form) {
  if (!domain || !form) return;
  const key = domain.toLowerCase();
  if (brandResolveCache.has(key)) return;
  brandResolveCache.set(key, "pending");
  const seq = ++brandResolveSeq;
  try {
    const r = await abzu(`/brand-resolve?domain=${encodeURIComponent(domain)}`);
    if (seq !== brandResolveSeq) return;
    if (!r.ok || !r.body?.found) return;
    brandResolveCache.set(key, r.body);
    const advertiserName = form.querySelector('[name="advertiser_name"]');
    if (advertiserName && r.body.name && !advertiserName.dataset.userTouched) {
      advertiserName.value = r.body.name;
    }
    const briefText = form.querySelector('[name="brief"]');
    if (briefText && r.body.tagline && !briefText.dataset.userTouched) {
      const cats = Array.isArray(r.body.categories) && r.body.categories.length > 0
        ? ` Audience interests: ${r.body.categories.slice(0, 4).join(", ")}.`
        : "";
      briefText.value = `${r.body.tagline}${cats}`;
    }
  } catch {}
}

function wireBrandAutofill() {
  document.body.addEventListener("input", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (!el.classList.contains("brand-input")) return;
    const raw = el.value.trim();
    const domain = raw.toLowerCase();
    const name = brandsByDomain.get(domain);
    if (name) {
      const form = el.form;
      const advertiserName = form?.querySelector('[name="advertiser_name"]');
      if (advertiserName instanceof HTMLInputElement && !advertiserName.dataset.userTouched) {
        advertiserName.value = name;
      }
    }
    if (raw.length >= 2) {
      clearTimeout(brandSearchTimer);
      brandSearchTimer = setTimeout(() => liveBrandSearch(raw), 300);
    }
    // Try /.well-known/brand.json once the typed value looks like a real
    // domain. Cheap server-side fetch — debounced + cached.
    if (/^[a-z0-9-]+(\.[a-z]{2,})+$/i.test(raw)) {
      clearTimeout(brandResolveTimer);
      brandResolveTimer = setTimeout(() => resolveBrandFromDomain(raw, el.form), 600);
    }
  });
  document.body.addEventListener("input", (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.name === "advertiser_name") {
      el.dataset.userTouched = "1";
    }
  }, true);
}

async function abzu(path, options = {}) {
  const r = await fetch(`${ABZU}${path}`, options);
  let body;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  return { status: r.status, ok: r.ok, body };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function fmtJson(value) {
  return `<pre class="json">${esc(JSON.stringify(value, null, 2))}</pre>`;
}

function fmtIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return "";
  const rows = issues
    .map((i) => `<li class="flex items-start gap-2"><code class="font-mono text-xs bg-rose-900/30 text-rose-300 px-1.5 py-0.5 rounded">${esc(i.path || "·")}</code><span>${esc(i.message)}</span></li>`)
    .join("");
  return `<ul class="space-y-1 text-sm text-rose-100/90">${rows}</ul>`;
}

function renderError(target, status, body) {
  const code = body?.code ?? body?.error ?? "error";
  const issues = body?.issues;
  const issuesEl = Array.isArray(issues) ? fmtIssues(issues) : "";
  target.innerHTML = `
    <div class="alert-error space-y-2">
      <div class="flex items-center justify-between">
        <div class="alert-title">HTTP ${status} · ${esc(code)}</div>
        <button class="text-xs text-rose-300 hover:text-rose-100 hover:underline" data-toggle-raw>raw</button>
      </div>
      <div class="alert-body">${esc(body?.error ?? "(no message)")}</div>
      ${issuesEl}
      <details class="hidden" data-raw>${fmtJson(body)}</details>
    </div>
  `;
  const btn = target.querySelector("[data-toggle-raw]");
  const raw = target.querySelector("[data-raw]");
  if (btn && raw) {
    btn.addEventListener("click", () => raw.classList.toggle("hidden"));
  }
}

/* SAM ---------------------------------------------------------------- */

function bindSam() {
  const form = $("#brief-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const advertiser = { name: fd.get("advertiser_name") };
    const domain = String(fd.get("advertiser_domain") || "").trim();
    if (domain) advertiser.domain = domain;
    const body = {
      advertiser,
      brief: fd.get("brief"),
      budget: {
        amount: Number(fd.get("budget_amount")),
        currency: String(fd.get("budget_currency") || "USD").toUpperCase(),
      },
      flight: { start: fd.get("flight_start"), end: fd.get("flight_end") },
      channels: String(fd.get("channels") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      formats: fd.getAll("formats").map((s) => String(s).trim()).filter(Boolean),
      top_n: Number(fd.get("top_n") || 3),
    };
    const submitBtn = $("#brief-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Querying sellers…";
    showDiscoveryProgress();
    const startedAt = Date.now();
    const r = await abzu("/planning/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const elapsedMs = Date.now() - startedAt;
    hideDiscoveryProgress();
    submitBtn.disabled = false;
    submitBtn.textContent = "Discover products";
    renderDiagnostics(r, elapsedMs);
    if (r.ok) renderProposals(r.body);
  });

  $("#buy-cancel")?.addEventListener("click", () => $("#buy-panel").classList.add("hidden"));
  $("#delivery-pull")?.addEventListener("click", pullDelivery);
  $("#signals-discover")?.addEventListener("click", discoverSignals);
  for (const r of document.querySelectorAll('input[name="creative_mode"]')) {
    r.addEventListener("change", updateCreativeModeVisibility);
  }
  $("#creative-audience-fanout")?.addEventListener("click", fanoutAudienceFirstRow);
  $("#creative-generate")?.addEventListener("click", generateCreativesForAudienceRows);
  $("#signals-results")?.addEventListener("change", onSignalSelectionChange);
  // Live update of the "empty → default X" hint. Same handler covers
  // single-mode fields and per-audience-mode grid inputs (delegated on
  // the buy-form container so late-rendered rows still fire it).
  const buyForm = $("#buy-form");
  if (buyForm) {
    buyForm.addEventListener("input", updateCreativeDefaultsHint);
    buyForm.addEventListener("change", updateCreativeDefaultsHint);
  }
  updateCreativeDefaultsHint();
  // Brand.json readiness indicator — debounced on brand_domain edits and
  // fired once on panel open. Buyer sees at a glance whether the
  // generative pipeline will pull real brand context or fall back to
  // Claude picking colors from scratch.
  const brandDomainInput = buyForm?.querySelector('input[name="brand_domain"]');
  if (brandDomainInput) {
    let debounce = 0;
    const trigger = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => refreshBrandJsonStatus(brandDomainInput.value), 400);
    };
    brandDomainInput.addEventListener("input", trigger);
    brandDomainInput.addEventListener("change", () => refreshBrandJsonStatus(brandDomainInput.value));
    refreshBrandJsonStatus(brandDomainInput.value);
  }
  // Path A restoration — replay cached Sam state so the buyer doesn't lose
  // Discover / selection / generated banners on a refresh. Runs once per
  // Sam view init; a Reset demo click still clears everything via
  // samStateClear on the reset flow.
  restoreSamStateFromLocalStorage();
  // Save the brief on blur — the raw text is what feeds every downstream
  // step (Discover signals, Generate creatives, brand.json resolution).
  const briefEl = document.querySelector('#brief-form [name="brief"]');
  if (briefEl) {
    briefEl.addEventListener("blur", () => samStateWrite(SAM_STATE_KEYS.brief, briefEl.value));
  }

  $("#buy-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData($("#buy-form"));
    const buyBtn = $("#buy-submit");
    const firstOverride = {
      seller_id: String(fd.get("seller_id") ?? ""),
      product_id: String(fd.get("product_id") ?? ""),
      pricing_option_id: String(fd.get("pricing_option_id") ?? ""),
    };
    const queue = Array.isArray(multiBuyQueue) ? multiBuyQueue.slice() : [];
    const isMulti = queue.length > 0;

    const results = [];
    const runSet = [firstOverride, ...queue.map((p) => ({
      seller_id: p.seller_id,
      product_id: p.product?.product_id ?? "",
      pricing_option_id: p.product?.pricing_options?.[0]?.pricing_option_id ?? "",
    }))];

    if (buyBtn) buyBtn.disabled = true;
    for (let i = 0; i < runSet.length; i++) {
      const override = runSet[i];
      if (buyBtn) buyBtn.textContent = isMulti ? `Executing ${i + 1}/${runSet.length}…` : "Executing…";
      const res = await executeSingleBuy(fd, override);
      results.push({ override, ...res });
    }
    if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = "Execute buy"; }

    if (isMulti) {
      renderMultiBuyResults(results);
      clearMultiBuyBanner();
    } else {
      const only = results[0];
      renderBuyResult(only.buyRes);
      if (only.syncRes) renderCreativeSyncResult(only.syncRes);
    }
  });
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i;
const IMAGE_MIME_RE = /^image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml)/i;

/* Best-effort probe: URL extension check + HEAD to sniff content-type.
 * Some CDNs strip HEAD; if HEAD fails we fall back to the extension
 * signal so a valid URL with a stripped HEAD does not block the buy. */
async function probeImageUrl(url) {
  if (!url) return { ok: false, reason: "empty" };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `unsupported protocol ${parsed.protocol}` };
  }
  const extHit = IMAGE_EXT_RE.test(parsed.pathname);
  try {
    const r = await fetch(url, { method: "HEAD", mode: "cors", cache: "no-store" });
    if (!r.ok) {
      if (extHit) return { ok: true, source: "extension (HEAD " + r.status + ")", contentType: null };
      return { ok: false, reason: `HEAD returned ${r.status}` };
    }
    const ct = r.headers.get("content-type") ?? "";
    if (IMAGE_MIME_RE.test(ct)) return { ok: true, source: "content-type", contentType: ct };
    if (extHit) return { ok: true, source: "extension (content-type " + (ct || "none") + ")", contentType: ct };
    return { ok: false, reason: `content-type "${ct || "none"}" is not image/*` };
  } catch (err) {
    if (extHit) return { ok: true, source: "extension (HEAD blocked)", contentType: null };
    return { ok: false, reason: "HEAD blocked and URL does not end in an image extension" };
  }
}

/* Server-side companion probe: asks Abzu backend to fetch the URL with a
 * bare fetch (no browser fingerprint) — the same shape the seller uses in
 * /live/*-slot when inlining creative bytes. Hotlink-protected origins
 * (lays.pl, most e-commerce CDNs) return 200 to the browser but 403 to a
 * bare fetch; the browser probe alone can't tell. Returns null when the
 * backend endpoint isn't reachable (dev, older backend) — caller should
 * degrade to the browser-probe result. */
async function probeImageUrlServerSide(url) {
  try {
    const r = await fetch(`${ABZU}/api/probe-image?url=${encodeURIComponent(url)}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function wireImageUrlCheck() {
  const input = $("#creative-image-url");
  const out = $("#creative-image-check");
  if (!input || !out) return;
  let seq = 0;
  input.addEventListener("blur", async () => {
    const url = input.value.trim();
    if (!url) {
      out.textContent = "";
      out.className = "mt-1 text-xs text-zinc-500 min-h-[1em]";
      return;
    }
    const my = ++seq;
    out.textContent = "checking…";
    out.className = "mt-1 text-xs text-zinc-500 min-h-[1em]";
    const [res, serverRes] = await Promise.all([
      probeImageUrl(url),
      probeImageUrlServerSide(url),
    ]);
    if (my !== seq) return;
    if (!res.ok) {
      out.textContent = `not an image · ${res.reason}`;
      out.className = "mt-1 text-xs text-rose-400 min-h-[1em]";
      return;
    }
    // Browser probe passed. Cross-check the server-side result: hotlink-
    // protected origins (lays.pl et al.) return 200 to the browser HEAD
    // but 403 to a bare fetch, so a "green" URL still silently disappears
    // from seller rotation. Size overflow (> 1 MB) is another silent-drop
    // path — the seller's inline budget rejects the bytes and the loop
    // skips the creative. When the server disagrees, downgrade to a
    // warning so the operator knows to swap the URL.
    if (serverRes && !serverRes.ok) {
      out.textContent = `⚠ ${serverRes.reason}`;
      out.className = "mt-1 text-xs text-amber-400 min-h-[1em]";
      return;
    }
    const sizeSuffix = serverRes?.sizeBytes
      ? ` · ${(serverRes.sizeBytes / 1024).toFixed(0)} KB`
      : "";
    out.textContent = `image ok · ${res.source}${res.contentType ? " · " + res.contentType : ""}${sizeSuffix}`;
    out.className = "mt-1 text-xs text-emerald-400 min-h-[1em]";
  });
}

/* Build the seller-side SVG creative URL used when the buyer skipped
 * the creative_image_url field. The endpoint (seller /generated/
 * agent-creative.svg) renders a branded banner sized to the placement,
 * so the ad slot never serves a blank iframe for an approved buy. */
function agentCraftedCreativeUrl(brand, productId, size) {
  const seller = "https://seller.purrsonality.rocketscience.pl";
  const qs = new URLSearchParams({
    brand: brand || "Advertiser",
    product: productId || "adcp_placement",
    size: size || "300x250",
  });
  return `${seller}/generated/agent-creative.svg?${qs.toString()}`;
}

/* Default landing page for empty Click URL — pointed at rocketscience.pl
 * rather than the image URL itself so the ad never opens the raw asset
 * in a new tab when clicked. */
const DEFAULT_CLICK_URL = "https://rocketscience.pl/";

/* Live hint under the Creative fieldset explaining what defaults will
 * apply on submit. Debounces on input events so it feels responsive
 * without churning DOM on every keystroke. Persona / audience mode uses
 * the same defaults per row — the hint stays valid there too. */
function updateCreativeDefaultsHint() {
  const hint = document.getElementById("creative-defaults-hint");
  if (!hint) return;
  const mode = document.querySelector('input[name="creative_mode"]:checked')?.value ?? "single";
  const missing = [];
  if (mode === "single") {
    const img = document.querySelector('#creative-single input[name="creative_image_url"]')?.value?.trim();
    const click = document.querySelector('#creative-single input[name="creative_click_url"]')?.value?.trim();
    const alt = document.querySelector('#creative-single input[name="creative_alt_text"]')?.value?.trim();
    const name = document.querySelector('#creative-single input[name="creative_name"]')?.value?.trim();
    if (!img) missing.push("Image → generic seller-crafted SVG");
    if (!click) missing.push(`Click → ${DEFAULT_CLICK_URL}`);
    if (!alt) missing.push("Alt text → auto-generated from creative name");
    if (!name) missing.push("Creative name → auto-generated abzu-&lt;timestamp&gt;");
  } else {
    const grid = document.getElementById("creative-audience-grid");
    if (grid) {
      let rowsWithImage = 0;
      let rowsWithoutClick = 0;
      for (const row of grid.querySelectorAll("div.grid.grid-cols-\\[160px_1fr_1fr\\]")) {
        const img = row.querySelector('input[data-audience-field="image_url"]')?.value?.trim();
        if (!img) continue;
        rowsWithImage++;
        const click = row.querySelector('input[data-audience-field="click_url"]')?.value?.trim();
        if (!click) rowsWithoutClick++;
      }
      if (rowsWithImage === 0) {
        missing.push("no rows have Image URL — the buy will succeed but no creatives sync");
      } else if (rowsWithoutClick > 0) {
        missing.push(`${rowsWithoutClick} rows will use Click → ${DEFAULT_CLICK_URL}`);
      }
    }
  }
  if (missing.length === 0) {
    hint.classList.add("hidden");
    hint.innerHTML = "";
    return;
  }
  hint.classList.remove("hidden");
  hint.innerHTML = `Empty fields will use defaults: <span class="text-amber-100">${missing.join(" · ")}</span>`;
}

async function executeSingleBuy(fd, override) {
  const body = {
    seller_id: override.seller_id,
    plan_id: fd.get("plan_id"),
    account: {
      brand: { domain: fd.get("brand_domain") },
      operator: fd.get("brand_domain"),
    },
    brand: { domain: fd.get("brand_domain"), name: "Acme" },
    product_id: override.product_id,
    pricing_option_id: override.pricing_option_id,
    budget: Number(fd.get("buy_budget")),
    currency: "USD",
    flight: { start: fd.get("buy_start"), end: fd.get("buy_end") },
    accept_conditions: fd.get("accept_conditions") === "on",
  };
  const buyRes = await abzu("/execution/buy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (buyRes.ok) {
    setLastPlanId(String(fd.get("plan_id") ?? ""));
    refreshKnownPlans();
    const mb = buyRes.body?.media_buy?.media_buy_id;
    if (mb) patchDemoState({ media_buy_id: mb });
    // Path C stub — governance ledger snapshot of the discovery context
    // that fed this buy: brief, discovered signals, selection, generated
    // banners. Fire-and-forget so a governance outage never blocks the
    // buy path. Endpoint expects a schema addition (audit event); we send
    // a well-known shape today and the governance side will pick it up
    // when it lands. Comment-only until governance/audit accepts arbitrary
    // ext events; no-op on 404 for now.
    // TODO(#creative-audit): remove the guard once governance ships a
    // /governance/discovery-context endpoint. Discussed in the plan-scoped
    // storage narada (Path B).
    const briefEl = document.querySelector('#brief-form [name="brief"]');
    const briefSnap = briefEl?.value?.trim() ?? "";
    const disc = samStateRead(SAM_STATE_KEYS.discovery);
    const selection = samStateRead(SAM_STATE_KEYS.selection);
    const generated = samStateRead(SAM_STATE_KEYS.generated);
    if (briefSnap || disc || selection || generated) {
      const snapshot = {
        plan_id: String(fd.get("plan_id") ?? ""),
        media_buy_id: mb ?? null,
        brief: briefSnap,
        discovery: disc,
        selection: Array.isArray(selection) ? selection : [],
        generated_variants: Array.isArray(generated) ? generated : [],
        submitted_at: new Date().toISOString(),
      };
      void abzu("/governance/discovery-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      }).catch(() => {});
    }
  }

  let syncRes = null;
  const brandDomain = String(fd.get("brand_domain") ?? "").trim();
  // Purrsonality's two placements are both 300x250 rectangles now; the
  // 728x90 leaderboard was retired because it overflowed the landing
  // page's mobile-first layout. Kept the branch shape for future
  // re-differentiation on other seller products.
  const fallbackSize = "300x250";
  const creativeFormatId = "display_300x250";
  const creativeWidth = 300;
  const creativeHeight = 250;
  const planIdForCreative = String(fd.get("plan_id") ?? "").trim() || "no-plan";
  const mode = String(fd.get("creative_mode") ?? "single");
  // Collect creative rows into a normalized shape before deciding whether to
  // fire sync_creatives. Empty rows in audience mode silently skip — the seller
  // uses the fallback bucket for those audiences until they get filled in.
  let creativeRows = [];
  if (mode === "audience") {
    const grid = document.getElementById("creative-audience-grid");
    if (grid && buyRes.ok && buyRes.body?.media_buy?.media_buy_id) {
      const bySlug = new Map();
      for (const el of grid.querySelectorAll("input[data-audience-field]")) {
        const slug = el.dataset.audienceSlug;
        if (!bySlug.has(slug)) bySlug.set(slug, {});
        bySlug.get(slug)[el.dataset.audienceField] = el.value.trim();
      }
      for (const [slug, fields] of bySlug) {
        // Empty row = skip this audience. Seller falls through to fallback
        // bucket (or a filled fallback row) — no agent-crafted SVG per
        // audience because that would emit N identical SVGs. Row's "slug"
        // is actually the signal_id (or "__fallback" for the untagged row).
        const rawImg = (fields.image_url ?? "").trim();
        if (!rawImg) continue;
        creativeRows.push({
          slug,
          image: rawImg,
          click_url: fields.click_url ?? "",
          alt_text: fields.alt_text ?? "",
          name_hint: fields.name ?? "",
        });
      }
    }
  } else {
    const rawImg = String(fd.get("creative_image_url") ?? "").trim();
    const image = rawImg || agentCraftedCreativeUrl(brandDomain, override.product_id, fallbackSize);
    if (buyRes.ok && image && buyRes.body?.media_buy?.media_buy_id) {
      creativeRows.push({
        slug: null,
        image,
        click_url: String(fd.get("creative_click_url") ?? "").trim(),
        alt_text: String(fd.get("creative_alt_text") ?? "").trim(),
        name_hint: String(fd.get("creative_name") ?? "").trim(),
      });
    }
  }
  if (creativeRows.length > 0) {
    const creatives = creativeRows.map((row) => {
      // Force unique creative_id per buy — reusing the exact name across
      // media buys would either dedupe on sync or attach one creative to
      // multiple buys, which defeats the per-buy attribution the demo
      // relies on. creative_id embeds the plan_id so the Sponsor view can
      // attribute impressions back to a plan without a separate plan_id
      // column on the seller's creatives table (startsWith match).
      const base = row.name_hint || `abzu-${Date.now()}`;
      // Suffix segment identifies the audience row inside the buy — signal
      // ids can contain slashes and dots (e.g. purrsonality.rocketscience.pl/
      // purr_persona_trickster), so squash to [a-z0-9_-] before splicing
      // into the creative_id. Fallback rows contribute the literal "fallback".
      const suffixCore = row.slug === "__fallback"
        ? "fallback"
        : (row.slug || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
      const slugSuffix = suffixCore ? `__${suffixCore}` : "";
      const creativeId = `${planIdForCreative}__${base}__${override.product_id}${slugSuffix}`.slice(0, 96);
      const image = {
        asset_type: "image",
        url: row.image,
        width: creativeWidth,
        height: creativeHeight,
        alt_text: row.alt_text || creativeId,
      };
      // Off-protocol convention (schema-legal): assets.image.audience_tag
      // carries the full signal id so the seller live-slot can route
      // /live/result-slot?audience=<slug> to the matching creative.
      // Fallback rows keep the tag empty so they serve the untagged
      // impressions (no ?audience= query, or an unknown audience). Row's
      // "slug" already holds the full signal_id straight from the picked
      // signal, so it becomes the tag verbatim.
      if (row.slug && row.slug !== "__fallback") {
        image.audience_tag = row.slug;
      }
      return {
        creative_id: creativeId,
        name: creativeId,
        format_id: { agent_url: "https://creative.adcontextprotocol.org", id: creativeFormatId },
        assets: {
          image,
          click_url: { asset_type: "url", url: row.click_url || DEFAULT_CLICK_URL },
        },
      };
    });
    const syncPayload = {
      seller_id: override.seller_id,
      assign_to_media_buy_id: buyRes.body.media_buy.media_buy_id,
      account: {
        brand: { domain: brandDomain },
        operator: brandDomain,
      },
      creatives,
    };
    syncRes = await abzu("/creatives/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(syncPayload),
    });
    if (syncRes.ok) {
      const cid = syncRes.body?.creatives?.[0]?.creative_id;
      if (cid) patchDemoState({ creative_id: cid });
    }
  }
  return { buyRes, syncRes };
}

function renderMultiBuyResults(results) {
  const el = $("#buy-result");
  if (!el) return;
  el.classList.remove("hidden");
  const rows = results.map((r, i) => {
    const buy = r.buyRes;
    const sync = r.syncRes;
    const mb = buy.body?.media_buy?.media_buy_id ?? "—";
    const verdict = buy.body?.governance_check?.verdict ?? "—";
    const buyStatus = buy.ok
      ? `<span class="verdict-${esc(verdict)}">${esc(verdict)}</span>`
      : `<span class="text-rose-400">HTTP ${buy.status} · ${esc(buy.body?.code ?? buy.body?.error ?? "error")}</span>`;
    const syncStatus = sync
      ? (sync.ok
          ? `<span class="text-emerald-400">synced</span>`
          : `<span class="text-rose-400">sync HTTP ${sync.status}</span>`)
      : `<span class="text-zinc-500">no creative</span>`;
    return `<tr class="border-t border-zinc-800">
      <td class="px-3 py-2 text-zinc-500">${i + 1}</td>
      <td class="px-3 py-2 font-mono text-xs">${esc(r.override.seller_id)}</td>
      <td class="px-3 py-2 font-mono text-xs">${esc(r.override.product_id)}</td>
      <td class="px-3 py-2 font-mono text-xs">${esc(mb)}</td>
      <td class="px-3 py-2 text-xs">${buyStatus}</td>
      <td class="px-3 py-2 text-xs">${syncStatus}</td>
    </tr>`;
  }).join("");
  const okCount = results.filter((r) => r.buyRes.ok).length;
  el.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-base font-semibold">Multi-buy executed · ${okCount}/${results.length} succeeded</h3>
    </div>
    <table class="min-w-full text-sm border border-zinc-800 rounded">
      <thead class="bg-zinc-800/30 text-xs uppercase text-zinc-500">
        <tr>
          <th class="text-left px-3 py-2">#</th>
          <th class="text-left px-3 py-2">Seller</th>
          <th class="text-left px-3 py-2">Product</th>
          <th class="text-left px-3 py-2">media_buy_id</th>
          <th class="text-left px-3 py-2">Verdict</th>
          <th class="text-left px-3 py-2">Creative</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <details class="mt-2 text-xs text-zinc-500"><summary class="cursor-pointer hover:text-zinc-300">Raw responses</summary>${fmtJson(results.map((r) => ({ override: r.override, buy: r.buyRes.body, sync: r.syncRes?.body ?? null })))}</details>
  `;
  $("#delivery-panel")?.classList.add("hidden");
  lastBuyContext = null;
}

const KNOWN_SELLER_PLACEHOLDERS = [
  "purrsonality-seller", "gumgum-sales-agent", "loopme-sales-agent",
  "bidmachine-seller-agent", "equativ", "inmobi-exchange",
  "triton-digital", "weather-company-scope3", "ozone-project",
  "adzymic-sph", "mamamia", "impaired-test-seller",
];

function showDiscoveryProgress() {
  $("#brief-diagnostics")?.classList.add("hidden");
  $("#proposals")?.classList.add("hidden");
  const wrap = $("#discovery-progress");
  const grid = $("#discovery-progress-grid");
  if (!wrap || !grid) return;
  wrap.classList.remove("hidden");
  grid.innerHTML = KNOWN_SELLER_PLACEHOLDERS.map((id, i) => `
    <div class="seller-card flex items-center justify-between gap-2 rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs" style="--i: ${i}">
      <div class="flex items-center min-w-0 flex-1">
        <span class="status-spinning"></span>
        <span class="font-mono text-zinc-200 truncate">${esc(id)}</span>
      </div>
      <span class="text-[10px] uppercase tracking-wider text-zinc-500">waiting</span>
    </div>
  `).join("");
}

function hideDiscoveryProgress() {
  $("#discovery-progress")?.classList.add("hidden");
}

function renderDiagnostics(r, elapsedMs) {
  const el = $("#brief-diagnostics");
  el.classList.remove("hidden");
  if (!r.ok) {
    renderError(el, r.status, r.body);
    return;
  }
  const d = r.body?.diagnostics || {};
  const proposals = r.body?.proposals || [];
  const sellers = Array.isArray(d.sellers) ? d.sellers : [];
  el.innerHTML = `
    <div class="flex items-center flex-wrap gap-2 mb-4">
      <span class="pill pill-info">Queried · ${d.sellers_queried ?? "?"}</span>
      <span class="pill ${d.sellers_responded > 0 ? "pill-ok" : "pill-err"}">Responded · ${d.sellers_responded ?? "?"}</span>
      <span class="pill ${d.partial ? "pill-warn" : "pill-ok"}">${d.partial ? "Partial" : "Complete"}</span>
      <span class="pill pill-brand">Proposals · ${proposals.length}</span>
      ${elapsedMs ? `<span class="pill pill-info">${(elapsedMs / 1000).toFixed(1)}s</span>` : ""}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2" id="seller-cards"></div>
    <details class="mt-3 text-xs text-zinc-500">
      <summary class="cursor-pointer hover:text-zinc-300">Raw diagnostics</summary>
      ${fmtJson(d)}
    </details>
  `;
  const grid = $("#seller-cards");
  if (grid) {
    grid.innerHTML = sellers.map((s, i) => sellerCardHtml(s, i)).join("");
  }
}

/* Turn the raw seller failure into a category the demo audience actually
 * cares about. Everything used to bucket into "incompatible", which is
 * misleading: most failures are auth-not-configured or fly cold starts,
 * not spec mismatches. Categories map to color + short label. */
function classifySellerFailure(s) {
  const issues = Array.isArray(s.validation_issues) ? s.validation_issues.join(" | ") : "";
  const err = String(s.error ?? "");
  const combined = `${err} ${issues}`.toLowerCase();
  const detailSource = issues || err;

  if (combined.includes("authentication required") || combined.includes("no oauth metadata") || combined.includes("provide auth_token")) {
    return { label: "auth", color: "text-sky-400", tooltip: "seller requires OAuth or auth token — none configured in sellers.json", detail: detailSource };
  }
  if (combined.includes("failed to discover mcp endpoint")) {
    return { label: "unreachable", color: "text-zinc-400", tooltip: "MCP endpoint URL invalid — agent_uri doesn't resolve to an MCP server", detail: detailSource };
  }
  if (combined.includes("timeout")) {
    return { label: "timeout", color: "text-amber-400", tooltip: "seller did not respond within the 8s deadline (possibly cold start)", detail: detailSource };
  }
  if (combined.includes("version_unsupported") || combined.includes("version '")) {
    return { label: "version", color: "text-fuchsia-400", tooltip: "AdCP version mismatch — seller does not support 3.1", detail: detailSource };
  }
  if (combined.includes("unexpected_keyword_argument") || combined.includes("output validation error") || combined.includes("mcp_error")) {
    return { label: "protocol", color: "text-orange-400", tooltip: "protocol-level error — seller SDK/schema mismatch", detail: detailSource };
  }
  if (combined.includes("validation_failed") || (Array.isArray(s.validation_issues) && s.validation_issues.length > 0)) {
    return { label: "incompatible", color: "text-rose-400", tooltip: "capabilities response did not validate against 3.1 schema", detail: detailSource };
  }
  return { label: "error", color: "text-rose-400", tooltip: err || "unknown failure", detail: detailSource };
}

function sellerCardHtml(s, i) {
  const isOk = s.ok === true;
  let statusClass, statusLabel, statusColor, tooltip = "";
  let detailText = "";
  if (isOk) {
    statusClass = "status-done";
    statusLabel = "ok";
    statusColor = "text-emerald-400";
  } else {
    const cls = classifySellerFailure(s);
    statusLabel = cls.label;
    statusColor = cls.color;
    tooltip = cls.tooltip;
    detailText = cls.detail;
    statusClass = statusLabel === "timeout" ? "status-timeout" : "status-error";
  }
  const productsLine = isOk && (s.products_returned ?? 0) > 0
    ? `<div class="text-xs text-zinc-400 mt-1">${s.products_returned} product${s.products_returned === 1 ? "" : "s"} returned</div>`
    : "";
  const errLine = !isOk && detailText
    ? `<div class="text-xs text-zinc-500 mt-1 truncate" title="${esc(detailText)}">${esc(detailText.slice(0, 80))}${detailText.length > 80 ? "…" : ""}</div>`
    : "";
  const badgeTitle = tooltip ? ` title="${esc(tooltip)}"` : "";
  return `
    <div class="seller-card rounded-md border border-zinc-700 bg-zinc-900/50 px-3 py-2.5" style="--i: ${i}">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center min-w-0 flex-1">
          <span class="${statusClass}"></span>
          <span class="font-mono text-xs text-zinc-200 truncate">${esc(s.seller_id)}</span>
        </div>
        <span${badgeTitle} class="text-xs font-semibold ${statusColor} uppercase tracking-wider">${statusLabel}</span>
      </div>
      ${productsLine}
      ${errLine}
    </div>
  `;
}

let currentProposals = [];
let multiBuyQueue = null;

/* Persistent Sam-view state — survives refresh + hard reload + browser
 * restart. Written on every meaningful click; read once on Sam view init.
 * Fits under Storage.localStorage's typical 5–10MB per origin, and each
 * value is under ~50KB (signals responses top out around ~15KB, variant
 * URLs are just strings).
 *
 * Namespaced with sam.* so a future multi-view state layer can co-exist.
 * Global (not per plan_id) for MVP — Sam demo runs one plan at a time.
 * See README roadmap: cross-device restore via governance ledger is
 * planned as Path B; this is Path A + a Path C stub on Execute buy. */
const SAM_STATE_KEYS = {
  brief: "sam.brief",
  discovery: "sam.discovery",          // full signals[] + diagnostics from last /discovery/signals
  selection: "sam.discovery_selection", // array of signal_ids checked
  generated: "sam.generated_variants", // array of variant records populated into the audience grid
};

function samStateRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function samStateWrite(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* Quota exceeded / private mode — silently drop; state is a cache,
     * not a source of truth. */
  }
}
function samStateClear() {
  for (const k of Object.values(SAM_STATE_KEYS)) {
    try { localStorage.removeItem(k); } catch {}
  }
}
/* Path A restoration on Sam view init — no server round-trip, no plan_id
 * required. Reads every SAM_STATE_KEYS entry, feeds discovery-related
 * state back into the in-memory modules (selectedAudienceSignals,
 * discoveryHasRun, lastDiscoveredSignals), and repaints the two visible
 * panels (Discover signals card + audience creative grid) so the buyer
 * lands on the same view they left. */
function restoreSamStateFromLocalStorage() {
  const briefEl = document.querySelector('#brief-form [name="brief"]');
  const savedBrief = samStateRead(SAM_STATE_KEYS.brief);
  if (briefEl && typeof savedBrief === "string" && savedBrief.length > 0 && !briefEl.value.trim()) {
    briefEl.value = savedBrief;
  }
  const disc = samStateRead(SAM_STATE_KEYS.discovery);
  const selection = samStateRead(SAM_STATE_KEYS.selection);
  if (disc && Array.isArray(disc.signals)) {
    discoveryHasRun = true;
    lastDiscoveredSignals = disc.signals.map((s) => ({
      signal_id: String(s.signal_id ?? ""),
      name: String(s.name || s.signal_id || ""),
      agent_id: String(s.agent_id ?? ""),
    })).filter((s) => s.signal_id);
    if (Array.isArray(selection)) {
      const known = new Set(lastDiscoveredSignals.map((s) => s.signal_id));
      selectedAudienceSignals = selection
        .filter((id) => known.has(id))
        .map((id) => {
          const hit = lastDiscoveredSignals.find((s) => s.signal_id === id);
          return { signal_id: id, ...(hit?.name && { name: hit.name }) };
        });
    }
    // Repaint the signals card. Same renderer path as fresh /discovery/signals
    // — synthesizes a fake response object from what we cached so status +
    // diagnostics + result cards all reappear with the checkboxes ticked.
    replayDiscoveryUI(disc);
    // Grid + defaults hint also need a refresh so the audience mode has
    // rows waiting for the buyer.
    if ($("#creative-audience-grid")) renderAudienceCreativeGrid();
  }
}

/* Renders the Discover signals status + diagnostics + result cards from a
 * cached payload. Mirrors the DOM writes inside discoverSignals(), split
 * out so both the fresh-fetch and restore paths share the same layout. */
function replayDiscoveryUI(cached) {
  const statusEl = $("#signals-status");
  const diagEl = $("#signals-diagnostics");
  const resultsEl = $("#signals-results");
  const signals = Array.isArray(cached.signals) ? cached.signals : [];
  const d = cached.diagnostics ?? {};
  if (statusEl) {
    statusEl.textContent = `${signals.length} signal${signals.length === 1 ? "" : "s"} · ${d.agents_responded ?? 0}/${d.agents_queried ?? 0} agents responded · restored from previous session`;
  }
  if (diagEl && Array.isArray(d.agents)) {
    diagEl.classList.remove("hidden");
    diagEl.innerHTML = d.agents.map((a) => {
      const ok = a.ok === true;
      const cls = ok ? "text-emerald-400" : "text-rose-400";
      const label = ok ? `${a.signals_returned ?? 0} returned` : classifySignalsFailure(a);
      const tooltip = ok ? "" : ` title="${esc(a.error ?? (a.validation_issues || []).join(" | "))}"`;
      return `<span${tooltip} class="text-xs px-2 py-1 rounded border border-zinc-700 bg-zinc-900/40"><span class="font-mono text-zinc-300 mr-1">${esc(a.agent_id)}</span><span class="${cls} font-semibold">${esc(label)}</span></span>`;
    }).join("");
  }
  if (resultsEl && signals.length > 0) {
    resultsEl.classList.remove("hidden");
    const selectedIds = new Set(selectedAudienceSignals.map((s) => s.signal_id));
    resultsEl.innerHTML = signals.map((s) => {
      const signalId = String(s.signal_id ?? "");
      const name = String(s.name || s.signal_id || "");
      const coverage = typeof s.coverage_percentage === "number"
        ? `<span class="text-xs text-emerald-300">${s.coverage_percentage.toFixed(1)}% coverage</span>`
        : "";
      const provider = s.data_provider ? `<span class="text-xs text-zinc-500">${esc(s.data_provider)}</span>` : "";
      const type = s.signal_type ? `<span class="text-[10px] uppercase tracking-wider text-violet-300">${esc(s.signal_type)}</span>` : "";
      const checked = selectedIds.has(signalId) ? " checked" : "";
      return `<div class="border border-zinc-800 rounded p-3 space-y-1">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex items-start gap-3">
            <label class="pt-1 cursor-pointer" title="Add this audience segment to the per-audience creative grid">
              <input type="checkbox" data-signal-select data-signal-id="${esc(signalId)}" data-signal-name="${esc(name)}"${checked} />
            </label>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-mono text-xs text-zinc-500">${esc(s.agent_id)}</span>
                <span class="font-semibold text-zinc-100">${esc(name)}</span>
                ${type}
              </div>
              ${s.description ? `<div class="text-xs text-zinc-400 mt-0.5">${esc(s.description)}</div>` : ""}
            </div>
          </div>
          <div class="text-right whitespace-nowrap flex flex-col gap-0.5 items-end">${coverage}${provider}</div>
        </div>
      </div>`;
    }).join("");
  }
}

/* Best-effort variant URL lookup for the audience grid populate. Keyed by
 * signal_id — the same id we send to the creative agent and get back on
 * variant.audience_slug / audience_tag. */
function samStateGeneratedMap() {
  const arr = samStateRead(SAM_STATE_KEYS.generated);
  const m = new Map();
  if (!Array.isArray(arr)) return m;
  for (const v of arr) {
    const id = String(v?.audience_tag ?? v?.audience_slug ?? "");
    if (id) m.set(id, v);
  }
  return m;
}

/* Hardcoded cat-persona defaults for the audience grid when the buyer has
 * never opened Discover signals in this session. Once they run Discover +
 * check any signal cards, selectedAudienceSignals takes over and the grid
 * only shows their selection. Signal id form matches what the signals
 * agent emits so the sync payload writes it verbatim into audience_tag. */
const DEFAULT_AUDIENCE_SIGNALS = [
  { signal_id: "purr_persona_angel", name: "angel" },
  { signal_id: "purr_persona_hunter", name: "hunter" },
  { signal_id: "purr_persona_tornado", name: "tornado" },
  { signal_id: "purr_persona_trickster", name: "trickster" },
  { signal_id: "purr_persona_tyrant", name: "tyrant" },
];
let discoveryHasRun = false;
let selectedAudienceSignals = [];
let lastDiscoveredSignals = [];

/* Rows the audience grid should render, in order:
 *   - selection non-empty → the buyer's picks
 *   - buyer never ran Discover → hardcoded cat personas (so the demo works
 *     without a Discover click)
 *   - Discover ran but selection empty → empty list (fallback row still
 *     renders in renderAudienceCreativeGrid) */
function currentAudienceRows() {
  if (selectedAudienceSignals.length > 0) return selectedAudienceSignals;
  if (!discoveryHasRun) return DEFAULT_AUDIENCE_SIGNALS;
  return [];
}

/* Audience-signals discovery — orchestrator fan-out over every configured
 * signals agent using the brief text as `get_signals` input. Renders per-
 * agent diagnostics + ranked segments; auth failures show alongside
 * successes so the buyer sees which agents responded. */
async function discoverSignals() {
  const briefEl = document.querySelector('#brief-form [name="brief"]');
  const brief = String(briefEl?.value ?? "").trim();
  const statusEl = $("#signals-status");
  const diagEl = $("#signals-diagnostics");
  const resultsEl = $("#signals-results");
  const btn = $("#signals-discover");
  if (!brief) {
    statusEl && (statusEl.textContent = "Write the brief above first, then click Discover signals.");
    return;
  }
  btn && (btn.disabled = true);
  if (statusEl) statusEl.textContent = "Querying signals agents…";
  diagEl?.classList.add("hidden");
  resultsEl?.classList.add("hidden");
  requestAnimationFrame(() => statusEl?.scrollIntoView({ behavior: "smooth", block: "center" }));
  const started = Date.now();
  const r = await abzu("/discovery/signals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brief, top_n: 20 }),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  btn && (btn.disabled = false);
  if (!r.ok) {
    if (statusEl) statusEl.textContent = `discovery failed — HTTP ${r.status} · ${r.body?.error ?? "unknown"}`;
    return;
  }
  const d = r.body?.diagnostics ?? {};
  const signals = Array.isArray(r.body?.signals) ? r.body.signals : [];
  // Remember every signal we saw this session so the checkbox handler can
  // resolve a signal_id back to its full record when the buyer toggles it.
  // Also keep a canonical (id, name) form for the audience grid — the raw
  // response has a mix of string and object signal_id shapes, so we
  // normalize once here.
  discoveryHasRun = true;
  lastDiscoveredSignals = signals.map((s) => ({
    signal_id: String(s.signal_id ?? ""),
    name: String(s.name || s.signal_id || ""),
    agent_id: String(s.agent_id ?? ""),
  })).filter((s) => s.signal_id);
  // Drop selections that no longer appear in the latest Discover — a signal
  // that vanished from the catalog probably shouldn't ship an ad.
  const stillPresent = new Set(lastDiscoveredSignals.map((s) => s.signal_id));
  selectedAudienceSignals = selectedAudienceSignals.filter((s) => stillPresent.has(s.signal_id));
  // Cache the raw response so a refresh restores the diagnostics chips +
  // signal cards without re-running Discover. Selection carries its own
  // key so the checkbox render can reconstruct the checked state.
  samStateWrite(SAM_STATE_KEYS.discovery, { signals, diagnostics: d });
  samStateWrite(SAM_STATE_KEYS.selection, selectedAudienceSignals.map((s) => s.signal_id));
  if ($("#creative-audience-grid")) renderAudienceCreativeGrid();
  if (statusEl) statusEl.textContent = `${signals.length} signal${signals.length === 1 ? "" : "s"} · ${d.agents_responded ?? 0}/${d.agents_queried ?? 0} agents responded · ${elapsed}s`;
  if (diagEl) {
    diagEl.classList.remove("hidden");
    diagEl.innerHTML = (d.agents ?? []).map((a) => {
      const ok = a.ok === true;
      const cls = ok ? "text-emerald-400" : "text-rose-400";
      const label = ok ? `${a.signals_returned ?? 0} returned` : classifySignalsFailure(a);
      const tooltip = ok ? "" : ` title="${esc(a.error ?? (a.validation_issues || []).join(" | "))}"`;
      return `<span${tooltip} class="text-xs px-2 py-1 rounded border border-zinc-700 bg-zinc-900/40"><span class="font-mono text-zinc-300 mr-1">${esc(a.agent_id)}</span><span class="${cls} font-semibold">${esc(label)}</span></span>`;
    }).join("");
  }
  if (resultsEl) {
    if (signals.length === 0) {
      resultsEl.classList.remove("hidden");
      resultsEl.innerHTML = `<div class="text-sm text-zinc-500">No signals returned. Auth or connectivity errors show up in the diagnostics row above.</div>`;
    } else {
      resultsEl.classList.remove("hidden");
      const selectedIds = new Set(selectedAudienceSignals.map((s) => s.signal_id));
      resultsEl.innerHTML = signals.map((s) => {
        const signalId = String(s.signal_id ?? "");
        const name = String(s.name || s.signal_id || "");
        const coverage = typeof s.coverage_percentage === "number"
          ? `<span class="text-xs text-emerald-300">${s.coverage_percentage.toFixed(1)}% coverage</span>`
          : "";
        const provider = s.data_provider ? `<span class="text-xs text-zinc-500">${esc(s.data_provider)}</span>` : "";
        const type = s.signal_type ? `<span class="text-[10px] uppercase tracking-wider text-violet-300">${esc(s.signal_type)}</span>` : "";
        const checked = selectedIds.has(signalId) ? " checked" : "";
        return `<div class="border border-zinc-800 rounded p-3 space-y-1">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex items-start gap-3">
              <label class="pt-1 cursor-pointer" title="Add this audience segment to the per-audience creative grid">
                <input type="checkbox" data-signal-select data-signal-id="${esc(signalId)}" data-signal-name="${esc(name)}"${checked} />
              </label>
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-xs text-zinc-500">${esc(s.agent_id)}</span>
                  <span class="font-semibold text-zinc-100">${esc(name)}</span>
                  ${type}
                </div>
                ${s.description ? `<div class="text-xs text-zinc-400 mt-0.5">${esc(s.description)}</div>` : ""}
              </div>
            </div>
            <div class="text-right whitespace-nowrap flex flex-col gap-0.5 items-end">${coverage}${provider}</div>
          </div>
        </div>`;
      }).join("");
    }
  }
}

/* Delegated handler for signal-card checkboxes — rebuilds
 * selectedAudienceSignals from the current DOM state and re-renders the
 * audience grid so newly-checked signals get their own row + newly-
 * unchecked signals drop out. */
function onSignalSelectionChange(evt) {
  const t = evt.target;
  if (!(t instanceof HTMLInputElement) || !t.matches("[data-signal-select]")) return;
  const checked = document.querySelectorAll("input[data-signal-select]:checked");
  selectedAudienceSignals = [...checked].map((el) => ({
    signal_id: el.dataset.signalId ?? "",
    name: el.dataset.signalName ?? (el.dataset.signalId ?? ""),
  })).filter((s) => s.signal_id);
  samStateWrite(SAM_STATE_KEYS.selection, selectedAudienceSignals.map((s) => s.signal_id));
  renderAudienceCreativeGrid();
}

function classifySignalsFailure(a) {
  const msg = String(a.error ?? (a.validation_issues || []).join(" ")).toLowerCase();
  if (msg.includes("authentication required") || msg.includes("bearer")) return "auth";
  if (msg.includes("timeout")) return "timeout";
  if (msg.includes("unreachable") || msg.includes("failed to discover mcp")) return "unreachable";
  if (msg.includes("version_unsupported")) return "version";
  return "error";
}

function renderProposals(body) {
  const wrap = $("#proposals");
  const tbody = $("#proposals-tbody");
  tbody.innerHTML = "";
  currentProposals = body.proposals || [];
  const proposals = currentProposals;
  if (proposals.length === 0) {
    wrap.classList.remove("hidden");
    tbody.innerHTML = `<tr><td colspan="7" class="px-3 py-3 text-zinc-500">No proposals.</td></tr>`;
    updateProposalsSelectionUI();
    return;
  }
  proposals.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.className = "border-t border-zinc-800 hover:bg-zinc-800/30";
    tr.innerHTML = `
      <td class="px-3 py-2 align-middle"><input type="checkbox" data-select-idx="${i}" class="proposal-select align-middle" /></td>
      <td class="px-3 py-2 text-zinc-500">${i + 1}</td>
      <td class="px-3 py-2 text-zinc-200">${esc(p.seller_id)}</td>
      <td class="px-3 py-2">
        <div class="text-zinc-100">${esc(p.product?.name ?? p.product?.product_id)}</div>
        <div class="text-xs text-zinc-500 font-mono">${esc(p.product?.product_id)}</div>
      </td>
      <td class="px-3 py-2 text-zinc-300">${esc(p.product?.delivery_type ?? "—")}</td>
      <td class="px-3 py-2">
        <span class="font-medium text-zinc-100">${p.score.toFixed(2)}</span>
        <span class="text-xs text-zinc-500">
          f=${p.breakdown.format_match}
          c=${p.breakdown.channel_match}
          d=${p.breakdown.delivery_match}
          b=${p.breakdown.brief_response}
        </span>
      </td>
      <td class="px-3 py-2 text-right">
        <button data-idx="${i}" class="buy-button px-3 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500">Buy</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  wrap.classList.remove("hidden");
  $$(".buy-button", tbody).forEach((btn) => {
    btn.addEventListener("click", () => openBuyPanel(proposals[Number(btn.dataset.idx)]));
  });
  $$(".proposal-select", tbody).forEach((cb) => {
    cb.addEventListener("change", updateProposalsSelectionUI);
  });
  const selectAll = $("#proposals-select-all");
  if (selectAll) selectAll.checked = false;
  updateProposalsSelectionUI();
}

function getSelectedProposalIndexes() {
  return $$(".proposal-select").filter((cb) => cb.checked).map((cb) => Number(cb.dataset.selectIdx));
}

function updateProposalsSelectionUI() {
  const count = getSelectedProposalIndexes().length;
  const label = $("#proposals-select-count");
  const btn = $("#proposals-buy-selected");
  if (label) label.textContent = `${count} selected`;
  if (btn) {
    btn.textContent = count > 1 ? `Buy ${count} selected` : "Buy selected";
    btn.classList.toggle("hidden", count === 0);
    btn.disabled = count === 0;
  }
  const selectAll = $("#proposals-select-all");
  const total = $$(".proposal-select").length;
  if (selectAll && total > 0) {
    selectAll.checked = count === total;
    selectAll.indeterminate = count > 0 && count < total;
  }
}

function openMultiBuyPanel() {
  const indexes = getSelectedProposalIndexes();
  if (indexes.length === 0) return;
  const selectedProposals = indexes.map((i) => currentProposals[i]).filter(Boolean);
  if (selectedProposals.length === 0) return;
  // For a single selection, fall through to the standard single-buy panel
  // so nothing changes for the pre-existing flow.
  if (selectedProposals.length === 1) {
    openBuyPanel(selectedProposals[0]);
    return;
  }
  // Multi mode: fill the form with the first proposal, queue the rest so
  // submitBuy iterates through them using the same form values (creative,
  // budget split, flight). Format per creative is derived per product_id
  // at sync time (see the existing productId → format branch).
  multiBuyQueue = selectedProposals.slice(1);
  openBuyPanel(selectedProposals[0]);
  renderMultiBuyBanner(selectedProposals);
}

function renderMultiBuyBanner(proposals) {
  const panel = $("#buy-panel");
  if (!panel) return;
  const existing = panel.querySelector("[data-multi-banner]");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.setAttribute("data-multi-banner", "1");
  banner.className = "alert-success border border-violet-500/40 bg-violet-500/10 text-violet-100 rounded p-3 text-sm space-y-1";
  const rows = proposals.map((p, i) => `<li class="font-mono text-xs">${i + 1}. ${esc(p.seller_id)} · ${esc(p.product?.product_id ?? "")}</li>`).join("");
  banner.innerHTML = `
    <div class="font-semibold">Multi-buy · ${proposals.length} proposals queued</div>
    <div class="text-xs text-violet-200/80">Budget below applies per buy. Execute buy runs them sequentially; creative sync attaches to each media_buy, format auto-picks per product_id.</div>
    <ul class="mt-1 space-y-0.5">${rows}</ul>
  `;
  const h2 = panel.querySelector("h2");
  if (h2 && h2.parentNode) h2.parentNode.insertBefore(banner, h2.nextSibling);
}

function clearMultiBuyBanner() {
  multiBuyQueue = null;
  const banner = document.querySelector("#buy-panel [data-multi-banner]");
  if (banner) banner.remove();
}

function openBuyPanel(proposal) {
  const panel = $("#buy-panel");
  panel.classList.remove("hidden");
  const f = $("#buy-form");
  f.seller_id.value = proposal.seller_id;
  f.product_id.value = proposal.product?.product_id ?? "";
  f.pricing_option_id.value = proposal.product?.pricing_options?.[0]?.pricing_option_id ?? "";
  if (!f.plan_id.value) {
    f.plan_id.value = getLastPlanId() || `plan_${Date.now()}`;
  }
  // Ensure audience grid is populated when the panel opens (works even if
  // the buyer never ran Discover signals — falls back to hardcoded slugs).
  renderAudienceCreativeGrid();
  // Per-audience routing only *serves* on purr_result_card_v1 (where the
  // cats /r/[persona] page passes ?persona=<slug>). Other products still
  // sync the tagged creatives, they just aren't audience-routed at serve
  // time; the tooltip on the radio explains why.
  syncCreativeModeForProduct(proposal.product?.product_id ?? "");
  updateCreativeDefaultsHint();
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Rebuild the per-audience creative grid rows in place. Called from
 * openBuyPanel and whenever discoveredAudienceSlugs changes. Rows preserve
 * their current input values so the buyer doesn't lose typing when the
 * grid re-renders after a Discover signals click. */
function renderAudienceCreativeGrid() {
  const grid = document.getElementById("creative-audience-grid");
  if (!grid) return;
  // Preserve typed inputs across re-renders, keyed by the row's signal_id
  // (or the literal "__fallback" marker for the untagged row).
  const priorValues = new Map();
  for (const el of grid.querySelectorAll("input[data-audience-field]")) {
    const key = `${el.dataset.audienceSlug}__${el.dataset.audienceField}`;
    priorValues.set(key, el.value);
  }
  const signalRows = currentAudienceRows();
  const rows = [...signalRows.map((s) => ({ ...s, isFallback: false })), { signal_id: "__fallback", name: "fallback", isFallback: true }];
  // Empty state — Discover ran, buyer hasn't picked a signal yet. Show a
  // hint above the fallback row so it's clear WHY there are no audience
  // rows even though Discover found some.
  const hint = discoveryHasRun && signalRows.length === 0
    ? `<div class="text-xs text-amber-300/80 border border-amber-500/30 bg-amber-500/5 rounded p-2">Pick one or more signals in the Discover signals card above — each checked signal gets its own row here.</div>`
    : "";
  grid.innerHTML = hint + rows.map((row) => {
    const rowKey = row.isFallback ? "__fallback" : row.signal_id;
    const nameHtml = row.isFallback
      ? `<span class="text-zinc-500 uppercase tracking-wider text-[10px]">fallback</span>`
      : `<span class="text-violet-300 font-semibold text-xs truncate block">${esc(row.name)}</span>`;
    const tagHtml = row.isFallback
      ? `<span class="text-[10px] text-zinc-600">no tag</span>`
      : `<span class="text-[10px] text-zinc-500 font-mono break-all">${esc(row.signal_id)}</span>`;
    const val = (field) => esc(priorValues.get(`${rowKey}__${field}`) ?? "");
    return `<div class="grid grid-cols-[160px_1fr_1fr] gap-2 items-start p-2 rounded border border-zinc-800 bg-zinc-900/40">
      <div class="text-xs pt-1.5 space-y-0.5 min-w-0">${nameHtml}<div>${tagHtml}</div></div>
      <div class="grid grid-cols-2 gap-2 col-span-2">
        <input type="url" placeholder="Image URL" data-audience-field="image_url" data-audience-slug="${esc(rowKey)}" value="${val("image_url")}" class="w-full border border-zinc-700 rounded px-2 py-1 text-xs" />
        <input type="url" placeholder="Click URL" data-audience-field="click_url" data-audience-slug="${esc(rowKey)}" value="${val("click_url")}" class="w-full border border-zinc-700 rounded px-2 py-1 text-xs" />
        <input placeholder="Alt text" data-audience-field="alt_text" data-audience-slug="${esc(rowKey)}" value="${val("alt_text")}" class="w-full border border-zinc-700 rounded px-2 py-1 text-xs" />
        <input placeholder="Creative name" data-audience-field="name" data-audience-slug="${esc(rowKey)}" value="${val("name")}" class="w-full border border-zinc-700 rounded px-2 py-1 text-xs" />
      </div>
    </div>`;
  }).join("");
  // Re-apply cached generated variants after a re-render — so a Sam view
  // refresh restores the URLs onto their rows even before the buyer
  // touches Generate creatives again. Only fills empty inputs to avoid
  // clobbering something the buyer typed manually since the last save.
  const cachedGen = samStateGeneratedMap();
  if (cachedGen.size > 0) {
    for (const [signalId, v] of cachedGen) {
      const img = grid.querySelector(`input[data-audience-field="image_url"][data-audience-slug="${cssEscape(signalId)}"]`);
      if (img && !img.value && v?.image_url) img.value = String(v.image_url);
      const alt = grid.querySelector(`input[data-audience-field="alt_text"][data-audience-slug="${cssEscape(signalId)}"]`);
      if (alt && !alt.value && v?.alt_text) alt.value = String(v.alt_text);
    }
  }
}

/* Per-audience routing only *serves* through /live/result-slot?audience=<slug>,
 * which the seller wires to purr_result_card_v1. For other products the
 * uploaded audience-tagged creatives still sync + get reviewed; they just
 * won't be audience-routed at impression time (they fall through the normal
 * bucket rules). We keep the radio clickable and surface the caveat as a
 * tooltip so the buyer isn't blocked from experimenting on a non-result
 * product. */
function syncCreativeModeForProduct(productId) {
  const audienceRadio = document.querySelector('input[name="creative_mode"][value="audience"]');
  if (!audienceRadio) return;
  const audienceLabel = audienceRadio.closest("label");
  const eligible = productId === "purr_result_card_v1";
  audienceRadio.disabled = false;
  if (audienceLabel) {
    audienceLabel.style.opacity = "1";
    audienceLabel.title = eligible
      ? ""
      : `Only purr_result_card_v1 exposes ?audience= at serve time — audience-tagged creatives will still sync + be reviewed on ${productId || "this product"}, but the seller won't audience-route them.`;
  }
}

/* Toggle the single-vs-audience sub-panels based on the currently checked
 * radio. Idempotent — safe to call from radio change + from openBuyPanel. */
function updateCreativeModeVisibility() {
  const mode = document.querySelector('input[name="creative_mode"]:checked')?.value ?? "single";
  const single = document.getElementById("creative-single");
  const audience = document.getElementById("creative-audience");
  if (single) single.classList.toggle("hidden", mode !== "single");
  if (audience) audience.classList.toggle("hidden", mode !== "audience");
}

/* Brand.json presence + completeness indicator. Called from a debounced
 * listener on the Brand domain input; hits abzu /brand-resolve (which
 * server-side fetches the /.well-known/brand.json off the target origin)
 * and reports what the creative generator will actually see. Rated
 * traffic-light style: green = ready for generation, amber = usable but
 * missing colors/logo/voice, red = no brand.json at all (generator will
 * use fallback palette). Only affects the display badge — no gate.
 */
let brandJsonProbeSeq = 0;
async function refreshBrandJsonStatus(rawDomain) {
  const el = document.getElementById("brand-json-status");
  if (!el) return;
  const domain = String(rawDomain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    el.textContent = "";
    el.className = "mt-1 text-xs min-h-[1em]";
    return;
  }
  const my = ++brandJsonProbeSeq;
  el.textContent = "checking brand.json…";
  el.className = "mt-1 text-xs text-zinc-500 min-h-[1em]";
  const r = await abzu(`/brand-resolve?domain=${encodeURIComponent(domain)}`);
  if (my !== brandJsonProbeSeq) return;
  if (!r.ok || !r.body?.found) {
    el.textContent = `no brand.json at ${domain}/.well-known/brand.json — generator will pick a fallback palette`;
    el.className = "mt-1 text-xs text-amber-300/80 min-h-[1em]";
    return;
  }
  const b = r.body ?? {};
  const has = {
    name: typeof b.name === "string" && b.name.length > 0,
    tagline: typeof b.tagline === "string" && b.tagline.length > 0,
    colors: b.colors && typeof b.colors === "object" && Object.values(b.colors).some((v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)),
    voice: typeof b.voice === "string" && b.voice.length > 0,
    logo: typeof b.logo_url === "string" && b.logo_url.length > 0,
  };
  const missing = ["name", "tagline", "colors", "voice", "logo"].filter((k) => !has[k]);
  const parts = [`✓ brand.json found`, has.name ? esc(b.name) : "unnamed"];
  if (has.tagline) parts.push(`“${esc(String(b.tagline).slice(0, 60))}”`);
  const line = parts.join(" · ");
  if (missing.length === 0) {
    el.textContent = `${line} · full palette + voice + logo — best generation quality`;
    el.className = "mt-1 text-xs text-emerald-400 min-h-[1em]";
  } else if (has.name && has.colors) {
    el.textContent = `${line} · missing: ${missing.join(", ")}`;
    el.className = "mt-1 text-xs text-emerald-300/80 min-h-[1em]";
  } else {
    el.textContent = `${line} · missing: ${missing.join(", ")} — generator may fall back to defaults for those fields`;
    el.className = "mt-1 text-xs text-amber-300/85 min-h-[1em]";
  }
}

/* "Generate creatives" — fires the creative-generative agent through the
 * abzu proxy, polls the task until every requested variant lands, and
 * writes each variant's opaque image_url straight into the matching
 * audience-grid row. The buyer never has to touch a file uploader; they
 * click Discover signals → check the segments they want → click Generate,
 * and the grid populates.
 *
 * Auth: the shared demo instance gates generation behind an
 * X-Creative-Trust-Key. We stash it in localStorage under
 * "creative_trust_key" — first click prompts once, subsequent calls send
 * silently. A caller who wants to rotate the key wipes localStorage. */
const CREATIVE_TRUST_KEY_STORAGE = "creative_trust_key";

function readTrustKey() {
  try { return localStorage.getItem(CREATIVE_TRUST_KEY_STORAGE) ?? ""; } catch { return ""; }
}
function saveTrustKey(v) {
  try { localStorage.setItem(CREATIVE_TRUST_KEY_STORAGE, v); } catch {}
}
function promptForTrustKey() {
  const stored = readTrustKey();
  if (stored) return stored;
  const entered = window.prompt(
    "Creative generation is invite-only. Paste your trust key to unlock the button — it stays in your browser (localStorage).",
    "",
  );
  const trimmed = String(entered ?? "").trim();
  if (!trimmed) return "";
  saveTrustKey(trimmed);
  return trimmed;
}

/* Collect the audience segments currently rendered in the grid, skipping
 * the fallback marker. Each becomes one requested variant per format the
 * caller picked. */
function collectAudienceGridAudiences() {
  const grid = document.getElementById("creative-audience-grid");
  if (!grid) return [];
  const seen = new Map();
  for (const el of grid.querySelectorAll("input[data-audience-slug]")) {
    const slug = el.dataset.audienceSlug;
    if (!slug || slug === "__fallback") continue;
    if (seen.has(slug)) continue;
    // Best-effort — look up name/description from the last-known signals
    // response so the composer gets a rich prompt. Falls back to the
    // slug itself when we haven't run Discover in this session.
    const hit = Array.isArray(lastDiscoveredSignals)
      ? lastDiscoveredSignals.find((s) => s.signal_id === slug)
      : null;
    seen.set(slug, {
      signal_id: slug,
      ...(hit?.name && { name: hit.name }),
      ...(hit?.agent_id === "purrsonality-signals" && slug.startsWith("purrsonality.rocketscience.pl/purr_persona_")
        ? { description: "Mischievous / playful / calm / dominant / high-energy cat person — persona from Purrsonality quiz" }
        : {}),
    });
  }
  return [...seen.values()];
}

async function generateCreativesForAudienceRows() {
  const btn = $("#creative-generate");
  const status = $("#creative-generate-status");
  const brief = String($("#brief-form [name=\"brief\"]")?.value ?? "").trim();
  const brandDomain = String($("#buy-form [name=\"brand_domain\"]")?.value ?? "").trim();
  if (!brief) {
    if (status) {
      status.classList.remove("hidden");
      status.textContent = "Write the brief first — it seeds every generated variant.";
    }
    return;
  }
  if (!brandDomain) {
    if (status) {
      status.classList.remove("hidden");
      status.textContent = "Brand domain must be set — brand.json colors + voice drive the composer.";
    }
    return;
  }
  const audiences = collectAudienceGridAudiences();
  if (audiences.length === 0) {
    if (status) {
      status.classList.remove("hidden");
      status.textContent = "Check at least one signal in the Discover signals card first — that's what tells the agent what to generate.";
    }
    return;
  }
  const trustKey = promptForTrustKey();
  if (!trustKey) {
    if (status) {
      status.classList.remove("hidden");
      status.textContent = "Trust key required to generate. Skip for now — you can still paste image URLs by hand.";
    }
    return;
  }
  // MVP: single format hardcoded at 300×250 — matches purr_result_card_v1
  // and purr_landing_rectangle_v1. Multi-format lands with the modal
  // expansion.
  const formats = [{ format_id: "display_300x250", width: 300, height: 250 }];
  const payload = { brief, brand: { domain: brandDomain }, formats, audiences, quality: "draft" };
  if (btn) btn.disabled = true;
  if (status) {
    status.classList.remove("hidden");
    status.textContent = `Ren is rendering ${audiences.length} × ${formats.length} = ${audiences.length * formats.length} banner${audiences.length * formats.length === 1 ? "" : "s"}…`;
  }
  const started = Date.now();
  const orderRes = await abzu("/creative/order", {
    method: "POST",
    headers: { "content-type": "application/json", "x-creative-trust-key": trustKey },
    body: JSON.stringify(payload),
  });
  if (!orderRes.ok) {
    if (btn) btn.disabled = false;
    if (status) status.textContent = `Order failed — HTTP ${orderRes.status} · ${orderRes.body?.reason ?? orderRes.body?.error ?? orderRes.body?.message ?? "unknown"}`;
    if (orderRes.status === 401 || orderRes.status === 403) {
      try { localStorage.removeItem(CREATIVE_TRUST_KEY_STORAGE); } catch {}
    }
    return;
  }
  const taskId = orderRes.body?.task_id;
  if (!taskId) {
    if (btn) btn.disabled = false;
    if (status) status.textContent = "Order accepted but the agent returned no task_id. Reload and try again.";
    return;
  }
  const expected = Number(orderRes.body?.variants_expected ?? audiences.length * formats.length);
  const finalRec = await pollCreativeTask(taskId, expected, (rec) => {
    if (!status) return;
    const got = Array.isArray(rec.variants) ? rec.variants.length : 0;
    const el = ((Date.now() - started) / 1000).toFixed(1);
    status.textContent = `${got}/${expected} banners ready · ${el}s · status ${rec.status}`;
  });
  if (btn) btn.disabled = false;
  if (!finalRec) {
    if (status) status.textContent = "Poll timed out — the task is still running. Refresh the page and try again.";
    return;
  }
  const variants = Array.isArray(finalRec.variants) ? finalRec.variants : [];
  if (variants.length > 0) samStateWrite(SAM_STATE_KEYS.generated, variants);
  const filled = applyGeneratedVariantsToGrid(variants);
  const el = ((Date.now() - started) / 1000).toFixed(1);
  if (status) {
    if (variants.length === 0) {
      status.textContent = `Ren returned 0 variants · ${el}s · ${(finalRec.errors ?? []).slice(0, 2).join(" | ") || "no errors reported"}`;
    } else {
      status.textContent = `Ren delivered ${variants.length} banner${variants.length === 1 ? "" : "s"} · ${filled} audience row${filled === 1 ? "" : "s"} filled · ${el}s`;
    }
  }
}

async function pollCreativeTask(taskId, expected, onTick) {
  const deadline = Date.now() + 90_000;
  let last = null;
  while (Date.now() < deadline) {
    const r = await abzu(`/creative/status/${encodeURIComponent(taskId)}`);
    if (!r.ok) return null;
    last = r.body;
    if (typeof onTick === "function") onTick(last);
    const done = String(last?.status ?? "") === "completed" || String(last?.status ?? "") === "failed";
    const enough = Array.isArray(last?.variants) && last.variants.length >= expected;
    if (done || enough) return last;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return last;
}

/* Copy generated variant URLs onto the matching audience-grid rows in
 * place. Returns the count of rows we filled so the status line can show
 * "N audiences populated." */
function applyGeneratedVariantsToGrid(variants) {
  const grid = document.getElementById("creative-audience-grid");
  if (!grid || !Array.isArray(variants)) return 0;
  let filled = 0;
  for (const v of variants) {
    const slug = String(v?.audience_slug ?? v?.audience_tag ?? "");
    if (!slug) continue;
    const imageInput = grid.querySelector(`input[data-audience-field="image_url"][data-audience-slug="${cssEscape(slug)}"]`);
    if (!imageInput) continue;
    imageInput.value = String(v.image_url ?? "");
    const altInput = grid.querySelector(`input[data-audience-field="alt_text"][data-audience-slug="${cssEscape(slug)}"]`);
    if (altInput && !altInput.value && v.alt_text) altInput.value = String(v.alt_text);
    const nameInput = grid.querySelector(`input[data-audience-field="name"][data-audience-slug="${cssEscape(slug)}"]`);
    if (nameInput && !nameInput.value) nameInput.value = `abzu-generated-${Date.now().toString(36)}-${slug.slice(-8)}`;
    filled += 1;
  }
  updateCreativeDefaultsHint();
  return filled;
}

/* Renders the topbar health strip: one coloured dot per downstream
 * agent + a self-dot for the abzu orchestrator. Colour ladder:
 *   green   → responded ok and under 400ms (warm)
 *   amber   → responded ok but slow (starting up / cold path)
 *   rose    → probe failed or non-2xx (down or unreachable)
 *   zinc    → probe skipped (agent not configured on abzu env)
 * Tooltip on each dot spells out the agent id + latency ms + last-seen
 * time so a hover reveals the details. Runs on init + on a 15s
 * setInterval, and the fetch itself is bounded by abzu's 2.5s per-agent
 * timeout inside /agents/status. */
async function refreshAgentStatusStrip() {
  const strip = document.getElementById("agent-status-strip");
  if (!strip) return;
  const r = await abzu("/agents/status");
  if (!r.ok) {
    strip.innerHTML = `<span title="abzu unreachable" class="w-2 h-2 rounded-full bg-rose-500"></span>`;
    return;
  }
  const now = new Date().toLocaleTimeString();
  const dots = [{ id: "abzu", ok: true, latency_ms: 0 }, ...(Array.isArray(r.body?.agents) ? r.body.agents : [])];
  strip.innerHTML = dots.map((a) => {
    const color = !a.ok
      ? "#f43f5e"          // rose-500
      : a.id === "abzu"
        ? "#10b981"        // emerald-500
        : (typeof a.latency_ms === "number" && a.latency_ms < 400 ? "#10b981" : "#fbbf24"); // amber-400
    const latency = typeof a.latency_ms === "number" ? `${a.latency_ms}ms` : "—";
    // Human-friendly display names — internal ids stay stable for API contracts.
    const display = ({ abzu: "abzu", seller: "seller", signals: "signals", governance: "governance", creative: "Ren" })[a.id] ?? a.id;
    const label = a.ok ? `${display} · ${latency}` : `${display} · down${a.error ? " · " + a.error : ""}`;
    // Inline style is intentional — Tailwind JIT doesn't scan w-2/h-2/bg-*
    // used only inside a JS template string, so classes silently drop from
    // the bundle. Hex colours ship in the app.js bytes, always render.
    return `<span title="${esc(label)} · updated ${esc(now)}" style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${color}"></span>`;
  }).join("");
}

function cssEscape(s) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return String(s).replace(/["\\]/g, "\\$&");
}

/* "Fill from first row" — mirrors the first audience row's inputs into every
 * other audience row + the fallback. Łukasz's sensible default from the
 * humanmcp narada: buyer uploads one banner, gets diversifiable defaults. */
function fanoutAudienceFirstRow() {
  const grid = document.getElementById("creative-audience-grid");
  if (!grid) return;
  const rows = new Map();
  for (const el of grid.querySelectorAll("input[data-audience-field]")) {
    const slug = el.dataset.audienceSlug;
    if (!rows.has(slug)) rows.set(slug, {});
    rows.get(slug)[el.dataset.audienceField] = el;
  }
  const [firstSlug] = rows.keys();
  if (!firstSlug) return;
  const src = rows.get(firstSlug);
  for (const [slug, fields] of rows) {
    if (slug === firstSlug) continue;
    for (const field of ["image_url", "click_url", "alt_text", "name"]) {
      if (fields[field] && src[field]) fields[field].value = src[field].value;
    }
  }
}

let lastBuyContext = null;

function renderBuyResult(r) {
  const el = $("#buy-result");
  el.classList.remove("hidden");
  if (!r.ok) {
    $("#delivery-panel").classList.add("hidden");
    lastBuyContext = null;
    if (Array.isArray(r.body?.issues)) {
      renderError(el, r.status, r.body);
    } else {
      const code = r.body?.code ?? "error";
      el.innerHTML = `
        <div class="border border-rose-200 bg-rose-50 rounded p-3 space-y-2">
          <div class="text-sm font-semibold text-rose-800">HTTP ${r.status} · ${esc(code)}</div>
          <div class="text-sm text-rose-900">${esc(r.body?.error ?? "(no message)")}</div>
          ${r.body?.detail ? fmtJson(r.body.detail) : ""}
        </div>
      `;
    }
    return;
  }
  const verdict = r.body?.governance_check?.verdict;
  const mb = r.body?.media_buy;
  el.innerHTML = `
    <div class="flex items-center justify-between">
      <h3 class="text-base font-semibold">Buy executed</h3>
      <span class="verdict-${esc(verdict)}">verdict: ${esc(verdict)}</span>
    </div>
    <div class="grid grid-cols-3 gap-3 text-sm">
      <div><div class="text-xs text-zinc-500">media_buy_id</div><div class="font-mono">${esc(mb?.media_buy_id ?? "—")}</div></div>
      <div><div class="text-xs text-zinc-500">status</div><div>${esc(mb?.media_buy_status ?? mb?.status ?? "—")}</div></div>
      <div><div class="text-xs text-zinc-500">outcome</div><div class="outcome-${esc(r.body?.outcome?.outcome_state)}">${esc(r.body?.outcome?.outcome_state ?? "—")} · ${r.body?.outcome?.committed_budget ?? "—"} ${esc(r.body?.buy_intake?.currency ?? "")}</div></div>
    </div>
    <details><summary class="text-zinc-500 cursor-pointer text-sm">Full response</summary>${fmtJson(r.body)}</details>
  `;

  if (mb?.media_buy_id && r.body?.governance_check?.governance_context) {
    lastBuyContext = {
      seller_id: r.body?.buy_intake?.seller_id,
      media_buy_id: mb.media_buy_id,
      plan_id: r.body?.buy_intake?.plan_id,
      governance_context: r.body.governance_check.governance_context,
    };
    showDeliveryPanel(lastBuyContext);
  } else {
    $("#delivery-panel").classList.add("hidden");
    lastBuyContext = null;
  }
}

function renderCreativeSyncResult(r) {
  const el = $("#creative-sync-result");
  if (!el) return;
  el.classList.remove("hidden");
  if (!r.ok) {
    el.innerHTML = `
      <div class="border border-rose-200 bg-rose-50 rounded p-3 space-y-2">
        <div class="text-sm font-semibold text-rose-800">Creative sync failed · HTTP ${r.status}</div>
        <div class="text-sm text-rose-900">${esc(r.body?.error ?? "(no message)")}</div>
        ${Array.isArray(r.body?.issues) ? fmtIssues(r.body.issues) : ""}
      </div>
    `;
    return;
  }
  const rows = Array.isArray(r.body?.creatives) ? r.body.creatives : [];
  el.innerHTML = `
    <h3 class="text-base font-semibold">Creative synced to seller</h3>
    <p class="text-xs text-zinc-500">Status <code class="font-mono">pending_review</code> means seller operator must approve in admin UI before /live/result-slot serves it.</p>
    <table class="min-w-full text-sm border border-zinc-800 rounded">
      <thead class="bg-zinc-800/30 text-xs uppercase text-zinc-500">
        <tr><th class="text-left px-3 py-2">creative_id</th><th class="text-left px-3 py-2">action</th><th class="text-left px-3 py-2">status</th></tr>
      </thead>
      <tbody>${rows.map((c) => `<tr class="border-t border-zinc-800"><td class="px-3 py-2 font-mono text-xs">${esc(c.creative_id)}</td><td class="px-3 py-2">${esc(c.action ?? "—")}</td><td class="px-3 py-2">${esc(c.status ?? "—")}</td></tr>`).join("")}</tbody>
    </table>
    <details><summary class="text-zinc-500 cursor-pointer text-sm">Full response</summary>${fmtJson(r.body)}</details>
  `;
}

function showDeliveryPanel(ctx) {
  const panel = $("#delivery-panel");
  panel.classList.remove("hidden");
  $("#delivery-snapshot").innerHTML = `
    <div><div class="text-xs text-zinc-500">seller</div><div class="font-mono text-xs">${esc(ctx.seller_id)}</div></div>
    <div><div class="text-xs text-zinc-500">media_buy_id</div><div class="font-mono text-xs">${esc(ctx.media_buy_id)}</div></div>
    <div><div class="text-xs text-zinc-500">plan</div><div class="font-mono text-xs">${esc(ctx.plan_id)}</div></div>
    <div><div class="text-xs text-zinc-500">last pull</div><div class="text-zinc-500">never</div></div>
  `;
  $("#delivery-outcome").innerHTML = "";
  $("#delivery-error").classList.add("hidden");
}

async function pullDelivery() {
  if (!lastBuyContext) return;
  const r = await abzu("/execution/delivery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lastBuyContext),
  });
  const errEl = $("#delivery-error");
  if (!r.ok) {
    errEl.classList.remove("hidden");
    renderError(errEl, r.status, r.body);
    return;
  }
  errEl.classList.add("hidden");
  const buy = r.body?.delivery?.media_buys?.[0] || {};
  const now = new Date().toISOString().slice(11, 19);
  $("#delivery-snapshot").innerHTML = `
    <div><div class="text-xs text-zinc-500">impressions</div><div class="font-semibold">${buy.impressions ?? "0"}</div></div>
    <div><div class="text-xs text-zinc-500">spend</div><div class="font-semibold">${buy.spend ?? "0"}</div></div>
    <div><div class="text-xs text-zinc-500">status</div><div>${esc(buy.status ?? buy.media_buy_status ?? "—")}</div></div>
    <div><div class="text-xs text-zinc-500">last pull</div><div class="text-zinc-500">${now} (UTC)</div></div>
  `;
  $("#delivery-outcome").innerHTML = `
    <span class="outcome-${esc(r.body?.outcome?.outcome_state)}">governance outcome: ${esc(r.body?.outcome?.outcome_state ?? "—")}</span>
    · <code class="font-mono text-xs">${esc(r.body?.outcome?.outcome_id ?? "")}</code>
  `;
}

/* JORDAN ------------------------------------------------------------- */

function bindJordan() {
  $("#plan-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData($("#plan-form"));
    const body = {
      plans: [
        {
          plan_id: fd.get("plan_id"),
          brand: { domain: fd.get("brand_domain") },
          objectives: fd.get("objectives"),
          budget: {
            total: Number(fd.get("budget_total")),
            currency: String(fd.get("budget_currency") || "USD").toUpperCase(),
            reallocation_threshold: Number(fd.get("reallocation_threshold")),
          },
          flight: { start: fd.get("flight_start"), end: fd.get("flight_end") },
        },
      ],
    };
    const planBtn = $("#plan-submit");
    if (planBtn) { planBtn.disabled = true; planBtn.textContent = "Registering…"; }
    const r = await abzu("/governance/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (planBtn) { planBtn.disabled = false; planBtn.textContent = "Register plan"; }
    const el = $("#plan-result");
    el.classList.remove("hidden");
    if (r.ok) {
      const planBrandDomain = String(fd.get("brand_domain") || "");
      const planObjectives = String(fd.get("objectives") || "");
      patchDemoState({
        plan_brand_domain: planBrandDomain,
        plan_objectives: planObjectives,
      });
      applyPlanInheritsToBrief();
      el.innerHTML = `
        <div class="alert-success">
          <div class="alert-title">✓ Plan registered</div>
          <div class="alert-body">plan_id = <code class="font-mono">${esc(fd.get("plan_id"))}</code>, status = active. Brand and objectives carry over to Sam's brief.</div>
        </div>
      `;
      const planId = String(fd.get("plan_id"));
      $("#audit-plan-id").value = planId;
      setLastPlanId(planId);
      refreshKnownPlans();
    } else {
      renderError(el, r.status, r.body);
    }
  });

  $("#audit-load")?.addEventListener("click", () => loadAudit($("#audit-plan-id").value));
}

async function loadAudit(planId) {
  if (!planId) return;
  const r = await abzu(`/governance/audit?plan_ids=${encodeURIComponent(planId)}&include_entries=true`);
  if (!r.ok) {
    $("#audit-summary").innerHTML = `<span class="text-rose-700">HTTP ${r.status}: ${esc(r.body?.error ?? "")}</span>`;
    $("#audit-table-wrap").classList.add("hidden");
    $("#conditions-queue-wrap").classList.add("hidden");
    return;
  }
  const plan = r.body?.plans?.[0];
  $("#audit-summary").innerHTML = `
    <span>Plan <b class="text-zinc-100">${esc(plan?.plan_id)}</b></span> ·
    <span>Status <b class="text-zinc-100">${esc(plan?.status)}</b></span> ·
    <span>Authorized <b class="text-zinc-100">${plan?.budget?.authorized ?? "—"}</b></span> ·
    <span>Checks <b class="text-zinc-100">${plan?.summary?.checks_performed ?? 0}</b></span> ·
    <span>Outcomes <b class="text-zinc-100">${plan?.summary?.outcomes_reported ?? 0}</b></span>
  `;

  const entries = plan?.entries || [];
  renderConditionsQueue(plan?.plan_id, entries);

  const tbody = $("#audit-tbody");
  tbody.innerHTML = "";
  entries.forEach((e) => {
    const tr = document.createElement("tr");
    tr.className = "border-t border-zinc-800";
    const tag = e.type === "check"
      ? `<span class="verdict-${esc(e.verdict)}">check · ${esc(e.verdict)}</span>`
      : `<span class="outcome-accepted">outcome · ${esc(e.outcome)}</span>`;
    const detailParts = [];
    if (e.tool) detailParts.push(`<code class="font-mono text-xs">${esc(e.tool)}</code>`);
    if (Array.isArray(e.findings) && e.findings.length > 0) {
      detailParts.push(`<span class="text-xs text-amber-700">${e.findings.length} finding(s)</span>`);
    }
    tr.innerHTML = `
      <td class="px-3 py-2 text-xs font-mono">${esc(e.timestamp)}</td>
      <td class="px-3 py-2">${esc(e.type)}</td>
      <td class="px-3 py-2">${tag}</td>
      <td class="px-3 py-2 text-zinc-400">${esc(e.caller ?? "—")}</td>
      <td class="px-3 py-2 text-xs text-zinc-500">${detailParts.join(" · ") || esc(e.id)}</td>
    `;
    tbody.appendChild(tr);
  });
  $("#audit-table-wrap").classList.toggle("hidden", entries.length === 0);
}

function renderConditionsQueue(planId, entries) {
  const wrap = $("#conditions-queue-wrap");
  const list = $("#conditions-queue");
  const conditionsEntries = entries.filter((e) => e.type === "check" && e.verdict === "conditions");
  if (conditionsEntries.length === 0) {
    wrap.classList.add("hidden");
    list.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");
  list.innerHTML = "";
  for (const entry of conditionsEntries) {
    const card = document.createElement("div");
    card.className = "border border-amber-200 bg-amber-50 rounded p-3 space-y-2";
    const findingsHtml = (entry.findings || [])
      .map((f) => `
        <li class="text-sm">
          <span class="severity-${esc(f.severity)}">${esc(f.severity)}</span>
          <code class="font-mono text-xs text-zinc-400">${esc(f.policy_id ?? "—")}</code>
          <span class="block text-zinc-300 ml-1">${esc(f.explanation)}</span>
        </li>
      `).join("");
    const samLink = `?role=sam`;
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-amber-900">${esc(entry.tool ?? "check")} · ${entry.timestamp.slice(0, 19)}</div>
        <code class="font-mono text-xs text-amber-700">${esc(entry.id)}</code>
      </div>
      <ul class="space-y-1">${findingsHtml}</ul>
      <div class="flex items-center gap-2 pt-1">
        <button class="copy-check-id text-xs px-2 py-1 rounded border border-amber-300 hover:bg-amber-100" data-check-id="${esc(entry.id)}">Copy check_id</button>
        <a href="${samLink}" class="text-xs px-2 py-1 rounded border border-amber-300 hover:bg-amber-100" data-plan-id="${esc(planId)}" data-sam-link>Open Sam (acknowledge)</a>
      </div>
    `;
    list.appendChild(card);
  }
  for (const btn of list.querySelectorAll(".copy-check-id")) {
    btn.addEventListener("click", () => navigator.clipboard?.writeText(btn.dataset.checkId));
  }
  for (const link of list.querySelectorAll("[data-sam-link]")) {
    link.addEventListener("click", () => setLastPlanId(link.dataset.planId));
  }
}

/* SPONSOR ------------------------------------------------------------ */

function bindSponsor() {
  $("#sponsor-campaigns-reload")?.addEventListener("click", refreshKnownPlans);
}

/* Cached seller creatives — reloaded when Sponsor asks for delivery. Keeps
 * repeated aggregations cheap and lets multiple planId queries share the
 * same round-trip. Populated lazily by ensureSellerCreativesLoaded. */
let sponsorSellerCreativesCache = null;

async function ensureSellerCreativesLoaded(force = false) {
  if (!force && sponsorSellerCreativesCache) return sponsorSellerCreativesCache;
  const r = await abzu("/seller/creatives?limit=200");
  if (!r.ok) throw new Error(`seller creatives fetch failed: HTTP ${r.status}`);
  sponsorSellerCreativesCache = Array.isArray(r.body?.creatives) ? r.body.creatives : [];
  return sponsorSellerCreativesCache;
}

function renderSponsorCampaignsListing(plans) {
  const tbody = $("#sponsor-campaigns-tbody");
  if (!tbody) return;
  if (!plans.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-2 py-3 text-zinc-500 text-sm">No plans registered.</td></tr>`;
    return;
  }
  tbody.innerHTML = plans.map((p) => {
    const synced = p.synced_at ? new Date(p.synced_at).toLocaleString() : "—";
    const brand = p.brand_domain ?? "—";
    return `<tr class="border-b border-zinc-800 hover:bg-zinc-800/30">
      <td class="px-2 py-2 font-mono text-xs text-zinc-100">${esc(p.plan_id)}</td>
      <td class="px-2 py-2 text-zinc-300">${esc(brand)}</td>
      <td class="px-2 py-2 text-xs text-zinc-500">${esc(synced)}</td>
      <td class="px-2 py-2 text-right whitespace-nowrap">
        <button class="sponsor-delivery text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800/40" data-plan-id="${esc(p.plan_id)}">Delivery</button>
        <button class="sponsor-audit text-xs px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800/40 ml-1" data-plan-id="${esc(p.plan_id)}">Audit</button>
      </td>
    </tr>`;
  }).join("");
  for (const btn of tbody.querySelectorAll(".sponsor-audit")) {
    btn.addEventListener("click", () => loadSponsor(btn.dataset.planId));
  }
  for (const btn of tbody.querySelectorAll(".sponsor-delivery")) {
    btn.addEventListener("click", () => loadSponsorDelivery(btn.dataset.planId));
  }
}

async function loadSponsor(planId) {
  if (!planId) return;
  const r = await abzu(`/governance/audit?plan_ids=${encodeURIComponent(planId)}&include_entries=true`);
  if (!r.ok) {
    setStatus(`audit error: ${r.status}`, false);
    return;
  }
  const plan = r.body?.plans?.[0];
  $("#sponsor-summary").classList.remove("hidden");
  $('[data-stat="authorized"]').textContent = plan?.budget?.authorized ?? "—";
  $('[data-stat="checks"]').textContent = plan?.summary?.checks_performed ?? 0;
  $('[data-stat="outcomes"]').textContent = plan?.summary?.outcomes_reported ?? 0;
  $('[data-stat="status"]').textContent = plan?.status ?? "—";
  const timelineWrap = $("#sponsor-timeline-wrap");
  timelineWrap?.classList.remove("hidden");
  const planLabel = $("#sponsor-timeline-plan");
  if (planLabel) planLabel.textContent = planId;
  const timeline = $("#sponsor-timeline");
  timeline.innerHTML = "";
  requestAnimationFrame(() =>
    timelineWrap?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
  (plan?.entries || []).forEach((e) => {
    const li = document.createElement("li");
    li.className = "flex items-start gap-3 border-l-2 border-zinc-800 pl-3";
    const label = e.type === "check"
      ? `<span class="verdict-${esc(e.verdict)}">check · ${esc(e.verdict)}</span>`
      : `<span class="outcome-accepted">outcome · ${esc(e.outcome)}</span>`;
    li.innerHTML = `
      <div class="text-xs font-mono text-zinc-500 w-44">${esc(e.timestamp)}</div>
      <div class="flex-1 text-sm">${label}</div>
    `;
    timeline.appendChild(li);
  });
}

/* Estimated spend uses the placement's min_cpm: leaderboard-like landing
 * placement historically 1.0 USD, medium-rectangle result 1.5 USD. Both
 * placements are 300x250 now but the min_cpm split is retained in seller
 * config, so this table mirrors it. */
const SPONSOR_PRODUCT_CPM = {
  "purr_landing_rectangle_v1": 1.0,
  "purr_landing_leaderboard_v1": 1.0,
  "purr_result_card_v1": 1.5,
};

function inferProductIdFromCreative(creative) {
  const cid = creative?.creative_id ?? "";
  if (cid.includes("purr_landing")) return "purr_landing_rectangle_v1";
  if (cid.includes("purr_result")) return "purr_result_card_v1";
  const fmtId = creative?.format_id?.id;
  if (fmtId === "display_728x90") return "purr_landing_leaderboard_v1";
  return "purr_result_card_v1";
}

async function loadSponsorDelivery(planId) {
  if (!planId) return;
  const wrap = $("#sponsor-delivery-wrap");
  const totalsEl = $("#sponsor-delivery-totals");
  const perBuyEl = $("#sponsor-delivery-per-buy");
  const planLabel = $("#sponsor-delivery-plan");
  if (planLabel) planLabel.textContent = planId;
  if (wrap) wrap.classList.remove("hidden");
  if (totalsEl) totalsEl.innerHTML = `<div class="text-zinc-500 text-sm">Loading…</div>`;
  if (perBuyEl) perBuyEl.innerHTML = "";
  requestAnimationFrame(() =>
    wrap?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );

  let creatives;
  try {
    creatives = await ensureSellerCreativesLoaded(true);
  } catch (err) {
    if (totalsEl) totalsEl.innerHTML = `<div class="text-rose-400 text-sm">${esc(err.message)}</div>`;
    return;
  }

  // Match creatives whose creative_id carries this plan_id as a prefix
  // ("<plan_id>__..."). Precise-prefix avoids false hits between plan_ids
  // that share a substring (e.g. "test" vs "test0"). Both the Sam
  // single-buy path and the post-deploy seed script now emit
  // <plan_id>__<name>__<product_id>.
  const matching = creatives.filter((c) => (c.creative_id || "").startsWith(planId + "__"));
  const byBuy = new Map();
  let totalImpr = 0;
  let totalClicks = 0;
  let totalSpend = 0;
  for (const c of matching) {
    const impr = Number(c?.stats?.impressions ?? 0);
    const clicks = Number(c?.stats?.clicks ?? 0);
    const productId = inferProductIdFromCreative(c);
    const cpm = SPONSOR_PRODUCT_CPM[productId] ?? 1.5;
    const spend = +(impr * cpm / 1000).toFixed(4);
    totalImpr += impr;
    totalClicks += clicks;
    totalSpend += spend;
    const buyId = c.assigned_media_buy_id ?? "unassigned";
    const bucket = byBuy.get(buyId) ?? { buyId, impressions: 0, clicks: 0, spend: 0, creatives: [] };
    bucket.impressions += impr;
    bucket.clicks += clicks;
    bucket.spend += spend;
    bucket.creatives.push({ id: c.creative_id, impressions: impr, clicks, productId });
    byBuy.set(buyId, bucket);
  }

  if (totalsEl) {
    totalsEl.innerHTML = `
      <div class="card p-4">
        <div class="text-xs text-zinc-500">Total impressions</div>
        <div class="text-lg font-semibold">${totalImpr}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-zinc-500">Total clicks</div>
        <div class="text-lg font-semibold">${totalClicks}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-zinc-500">Estimated spend (USD)</div>
        <div class="text-lg font-semibold">${totalSpend.toFixed(4)}</div>
      </div>
    `;
  }

  if (perBuyEl) {
    if (byBuy.size === 0) {
      perBuyEl.innerHTML = `<div class="text-sm text-zinc-500">No creatives found for this plan. Delivery is inferred from <code>creative_id</code> containing the plan_id — buys made with non-tagged creative names won't roll up here.</div>`;
    } else {
      const rows = [...byBuy.values()].map((b) => {
        const creatives = b.creatives.map((c) => `<li class="font-mono text-xs text-zinc-400">${esc(c.id)} · ${c.impressions} impr · ${c.clicks} clicks</li>`).join("");
        return `<div class="border border-zinc-800 rounded p-3 space-y-1">
          <div class="flex items-center justify-between">
            <div class="font-mono text-xs text-zinc-300">${esc(b.buyId)}</div>
            <div class="text-xs text-zinc-500">${b.impressions} impressions · ${b.clicks} clicks · $${b.spend.toFixed(4)}</div>
          </div>
          <ul class="pl-3 space-y-0.5">${creatives}</ul>
        </div>`;
      }).join("");
      perBuyEl.innerHTML = rows;
    }
  }
}

/* BOOT --------------------------------------------------------------- */

function pickUrl(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof v.url === "string") return v.url;
  return null;
}

async function loadOperatorCreatives() {
  const statusSel = $("#operator-status");
  const tbody = $("#operator-tbody");
  const line = $("#operator-status-line");
  const status = statusSel.value;
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", "50");
  line.textContent = "loading…";
  const r = await abzu(`/seller/creatives?${params}`);
  if (!r.ok) {
    line.textContent = `error · HTTP ${r.status}`;
    tbody.innerHTML = `<tr><td colspan="6" class="px-2 py-3 text-rose-700">${esc(r.body?.error ?? "fetch failed")}</td></tr>`;
    return;
  }
  const rows = r.body?.creatives ?? [];
  line.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${new Date().toLocaleTimeString()}`;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-2 py-3 text-zinc-500">No creatives in this status.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => {
    const img = pickUrl(row.assets?.image);
    const thumb = img
      ? `<img src="${esc(img)}" alt="" class="w-12 h-9 object-contain bg-white border border-zinc-800" onerror="this.style.display='none';">`
      : '<span class="text-slate-300 text-xs">—</span>';
    const fmt = row.format_id?.id ?? "—";
    const statusColor = row.status === "approved" ? "text-emerald-700"
      : row.status === "rejected" ? "text-rose-700"
      : row.status === "pending_review" ? "text-amber-700" : "text-zinc-400";
    const submitted = new Date(row.submitted_at).toLocaleString();
    // Approved creatives still get a Withdraw button — Riley may need to
    // pull a live creative that turned out broken (asset 404, off-brand
    // copy, wrong audience tag) without waiting for the next review
    // cycle. Backend accepts approved → rejected via the same /reject
    // endpoint, so the wire is identical to the pending-queue reject.
    const action = row.status === "pending_review"
      ? `<button class="op-approve px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500" data-id="${esc(row.creative_id)}">Approve</button>
         <button class="op-reject px-2 py-1 rounded bg-transparent text-rose-700 border border-rose-300 text-xs hover:bg-rose-50 ml-1" data-id="${esc(row.creative_id)}">Reject</button>`
      : row.status === "approved"
        ? `<div class="flex items-center gap-2"><span class="text-zinc-500 text-xs">${row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : "—"}</span>
           <button class="op-reject px-2 py-1 rounded bg-transparent text-rose-700 border border-rose-300 text-xs hover:bg-rose-50" data-id="${esc(row.creative_id)}" title="Pull this creative from the live rotation">Withdraw</button></div>`
        : `<span class="text-zinc-500 text-xs">${row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : "—"}</span>`;
    return `<tr class="border-b border-zinc-800 align-middle">
      <td class="px-2 py-2">${thumb}</td>
      <td class="px-2 py-2 font-mono text-xs">${esc(row.creative_id)}</td>
      <td class="px-2 py-2 text-xs">${esc(fmt)}</td>
      <td class="px-2 py-2 text-xs font-semibold ${statusColor}">${esc(row.status)}</td>
      <td class="px-2 py-2 text-xs text-zinc-500">${esc(submitted)}</td>
      <td class="px-2 py-2">${action}</td>
    </tr>`;
  }).join("");
  for (const btn of tbody.querySelectorAll(".op-approve")) {
    btn.addEventListener("click", () => reviewOperatorCreative(btn.dataset.id, "approve"));
  }
  for (const btn of tbody.querySelectorAll(".op-reject")) {
    btn.addEventListener("click", () => reviewOperatorCreative(btn.dataset.id, "reject"));
  }
}

async function reviewOperatorCreative(id, action) {
  let note = null;
  if (action === "reject") {
    note = window.prompt("Reject note (required):");
    if (!note) return;
  }
  const r = await abzu(`/seller/creatives/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note ? { note } : {}),
  });
  if (!r.ok) {
    alert(`${action} failed: HTTP ${r.status} ${r.body?.error ?? ""}`);
    return;
  }
  if (action === "approve") patchDemoState({ creative_approved: true });
  loadOperatorCreatives();
}

function bindOperator() {
  $("#operator-reload")?.addEventListener("click", loadOperatorCreatives);
  $("#operator-status")?.addEventListener("change", loadOperatorCreatives);
}

function wakeUpSeller() {
  // Fire-and-forget MCP ping so the seller fly machine + its /mcp route
  // handler are both warm by the time the user clicks Discover. Targeting
  // /mcp (not /.well-known/healthz) matters because Bun.serve JIT-compiles
  // per-route on first hit — warming healthz did not warm /mcp on cold
  // start, and the discovery probe still timed out on first try.
  fetch("https://seller.purrsonality.rocketscience.pl/mcp", {
    method: "POST",
    mode: "no-cors",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
  }).catch(() => {});
}

function boot() {
  wakeUpSeller();
  const url = new URL(window.location.href);
  const role = url.searchParams.get("role") || "jordan";
  for (const link of $$(".role-link")) {
    link.addEventListener("click", () => activateRole(link.dataset.role));
  }
  $("#reset-demo")?.addEventListener("click", () => {
    try { localStorage.clear(); } catch {}
    window.location.href = "/?role=jordan";
  });
  // Warmup on page load — fires the abzu /warmup fan-out so every
  // downstream Fly machine gets a wake ping before the buyer clicks
  // Discover / Generate / Execute. Fire-and-forget; response discarded.
  // Runs once per view activation, silently.
  void abzu("/warmup", { method: "POST" }).catch(() => {});
  // Live health strip in the topbar. Polls every 15s; slower than warmup
  // to keep the request rate low, fast enough that a suspended agent
  // shows up as amber within one flip-book frame after the buyer opens
  // the page.
  refreshAgentStatusStrip();
  visibleInterval(refreshAgentStatusStrip, 15_000);
  activateRole(role);
  updateBreadcrumb();
  applyPlanInheritsToBrief();
  // Mark brief textarea as touched if user types — so we don't overwrite
  // their edits when navigating back.
  const briefText = document.querySelector('#brief-form [name="brief"]');
  briefText?.addEventListener("input", () => { briefText.dataset.userTouched = "1"; });
  // Auto-load operator queue when entering that tab so the user doesn't have
  // to hunt for the Reload button after coming back from Sam's buy.
  for (const link of $$(".role-link")) {
    link.addEventListener("click", () => {
      if (link.dataset.role === "operator") {
        setTimeout(loadOperatorCreatives, 100);
      }
      if (link.dataset.role === "sponsor") {
        // Sponsor tab always shows the campaigns table (built from the same
        // refreshKnownPlans feed as Jordan). Auto-open audit + delivery for
        // the last-used plan so a returning session lands in context.
        setTimeout(() => {
          refreshKnownPlans();
          const planId = getLastPlanId();
          if (planId) {
            loadSponsor(planId);
            loadSponsorDelivery(planId);
          }
        }, 100);
      }
    });
  }
  if (role === "operator") setTimeout(loadOperatorCreatives, 100);
  if (role === "sponsor") {
    const planId = getLastPlanId();
    if (planId) {
      setTimeout(() => {
        loadSponsor(planId);
        loadSponsorDelivery(planId);
      }, 100);
    }
  }
  bindSam();
  bindJordan();
  bindOperator();
  bindSponsor();
  refreshKnownPlans();
  visibleInterval(refreshKnownPlans, 15000);
  $("#plans-listing-reload")?.addEventListener("click", refreshKnownPlans);
  $("#sam-plans-reload")?.addEventListener("click", refreshKnownPlans);
  $("#sam-plan-select")?.addEventListener("change", (e) => {
    const planId = e.target.value;
    if (planId) applyPlanSelectionToSam(planId);
  });
  $("#proposals-buy-selected")?.addEventListener("click", openMultiBuyPanel);
  wireImageUrlCheck();
  $("#proposals-select-all")?.addEventListener("change", (e) => {
    const on = e.target.checked;
    for (const cb of $$(".proposal-select")) cb.checked = on;
    updateProposalsSelectionUI();
  });
  // Clicking Buy on any row while a multi-buy queue is armed cancels
  // that queue — the user is switching to a single-buy flow.
  $("#buy-cancel")?.addEventListener("click", clearMultiBuyBanner);
  // User typed into brief's advertiser_domain — mark it so
  // applyPlanSelectionToSam doesn't overwrite their edits.
  document.body.addEventListener("input", (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.name === "advertiser_domain") {
      el.dataset.userTouched = "1";
    }
  }, true);
  loadKnownBrands();
  wireBrandAutofill();
  const last = getLastPlanId();
  if (last) {
    for (const input of $$(".plan-input")) input.value = last;
  }
  probeAbzu();
  visibleInterval(probeAbzu, 30000);
}

document.addEventListener("DOMContentLoaded", boot);
