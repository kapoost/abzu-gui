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
  el.textContent = text;
  el.className = `text-xs px-2 py-0.5 rounded ${
    ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
  }`;
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

const LAST_PLAN_KEY = "abzu.lastPlanId";

function getLastPlanId() {
  try { return localStorage.getItem(LAST_PLAN_KEY) || ""; } catch { return ""; }
}

function setLastPlanId(planId) {
  if (!planId) return;
  try { localStorage.setItem(LAST_PLAN_KEY, planId); } catch {}
  for (const input of $$(".plan-input")) {
    if (!input.value) input.value = planId;
  }
}

async function refreshKnownPlans() {
  try {
    const r = await abzu("/governance/plans");
    if (!r.ok) return;
    const dl = $("#known-plans");
    dl.innerHTML = "";
    for (const p of r.body?.plans ?? []) {
      const opt = document.createElement("option");
      opt.value = p.plan_id;
      opt.label = p.brand_domain ? `${p.brand_domain} · ${p.synced_at.slice(0, 19)}` : p.synced_at.slice(0, 19);
      dl.appendChild(opt);
    }
  } catch {}
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
    .map((i) => `<li><code class="font-mono text-xs bg-rose-100 px-1 rounded mr-2">${esc(i.path || "·")}</code><span>${esc(i.message)}</span></li>`)
    .join("");
  return `<ul class="space-y-1 text-sm text-rose-900">${rows}</ul>`;
}

function renderError(target, status, body) {
  const code = body?.code ?? body?.error ?? "error";
  const issues = body?.issues;
  const issuesEl = Array.isArray(issues) ? fmtIssues(issues) : "";
  target.innerHTML = `
    <div class="border border-rose-200 bg-rose-50 rounded p-3 space-y-2">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-rose-800">HTTP ${status} · ${esc(code)}</div>
        <button class="text-xs text-rose-700 hover:underline" data-toggle-raw>raw</button>
      </div>
      <div class="text-sm text-rose-900">${esc(body?.error ?? "(no message)")}</div>
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
      top_n: Number(fd.get("top_n") || 3),
    };
    const r = await abzu("/planning/brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    renderDiagnostics(r);
    if (r.ok) renderProposals(r.body);
  });

  $("#buy-cancel")?.addEventListener("click", () => $("#buy-panel").classList.add("hidden"));
  $("#delivery-pull")?.addEventListener("click", pullDelivery);

  $("#buy-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData($("#buy-form"));
    const body = {
      seller_id: fd.get("seller_id"),
      plan_id: fd.get("plan_id"),
      account: {
        brand: { domain: fd.get("brand_domain") },
        operator: fd.get("brand_domain"),
      },
      brand: { domain: fd.get("brand_domain"), name: "Acme" },
      product_id: fd.get("product_id"),
      pricing_option_id: fd.get("pricing_option_id"),
      budget: Number(fd.get("buy_budget")),
      currency: "USD",
      flight: { start: fd.get("buy_start"), end: fd.get("buy_end") },
      accept_conditions: fd.get("accept_conditions") === "on",
    };
    const r = await abzu("/execution/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setLastPlanId(String(fd.get("plan_id") ?? ""));
      refreshKnownPlans();
    }
    renderBuyResult(r);

    const imageUrl = String(fd.get("creative_image_url") ?? "").trim();
    if (r.ok && imageUrl && r.body?.media_buy?.media_buy_id) {
      const clickUrl = String(fd.get("creative_click_url") ?? "").trim();
      const altText = String(fd.get("creative_alt_text") ?? "").trim();
      const creativeName = String(fd.get("creative_name") ?? "").trim();
      const creativeId = creativeName || `abzu-${Date.now()}`;
      const syncPayload = {
        seller_id: String(fd.get("seller_id") ?? ""),
        account: {
          brand: { domain: String(fd.get("brand_domain") ?? "") },
          operator: String(fd.get("brand_domain") ?? ""),
        },
        creatives: [{
          creative_id: creativeId,
          name: creativeId,
          format_id: { agent_url: "https://creative.adcontextprotocol.org", id: "display_300x250" },
          assets: {
            image: {
              asset_type: "image",
              url: imageUrl,
              width: 300,
              height: 250,
              alt_text: altText || creativeId,
            },
            click_url: { asset_type: "url", url: clickUrl || imageUrl },
          },
        }],
      };
      const cs = await abzu("/creatives/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(syncPayload),
      });
      renderCreativeSyncResult(cs);
    }
  });
}

function renderDiagnostics(r) {
  const el = $("#brief-diagnostics");
  el.classList.remove("hidden");
  if (!r.ok) {
    renderError(el, r.status, r.body);
    return;
  }
  const d = r.body?.diagnostics || {};
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="flex gap-6 text-slate-600">
      <span>Queried: <b class="text-slate-900">${d.sellers_queried ?? "?"}</b></span>
      <span>Responded: <b class="text-slate-900">${d.sellers_responded ?? "?"}</b></span>
      <span>Partial: <b class="text-slate-900">${d.partial ? "yes" : "no"}</b></span>
      <span>Proposals: <b class="text-slate-900">${r.body.proposals?.length ?? 0}</b></span>
    </div>
    <details class="mt-3"><summary class="text-slate-500 cursor-pointer">Per-seller</summary>${fmtJson(d.sellers)}</details>
  `;
}

function renderProposals(body) {
  const wrap = $("#proposals");
  const tbody = $("#proposals-tbody");
  tbody.innerHTML = "";
  const proposals = body.proposals || [];
  if (proposals.length === 0) {
    wrap.classList.remove("hidden");
    tbody.innerHTML = `<tr><td colspan="6" class="px-3 py-3 text-slate-500">No proposals.</td></tr>`;
    return;
  }
  proposals.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.className = "border-t border-slate-100 hover:bg-slate-50";
    tr.innerHTML = `
      <td class="px-3 py-2 text-slate-500">${i + 1}</td>
      <td class="px-3 py-2">${esc(p.seller_id)}</td>
      <td class="px-3 py-2">
        <div>${esc(p.product?.name ?? p.product?.product_id)}</div>
        <div class="text-xs text-slate-500">${esc(p.product?.product_id)}</div>
      </td>
      <td class="px-3 py-2 text-slate-600">${esc(p.product?.delivery_type ?? "—")}</td>
      <td class="px-3 py-2">
        <span class="font-medium">${p.score.toFixed(2)}</span>
        <span class="text-xs text-slate-400">
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
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
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
      <div><div class="text-xs text-slate-500">media_buy_id</div><div class="font-mono">${esc(mb?.media_buy_id ?? "—")}</div></div>
      <div><div class="text-xs text-slate-500">status</div><div>${esc(mb?.media_buy_status ?? mb?.status ?? "—")}</div></div>
      <div><div class="text-xs text-slate-500">outcome</div><div class="outcome-${esc(r.body?.outcome?.outcome_state)}">${esc(r.body?.outcome?.outcome_state ?? "—")} · ${r.body?.outcome?.committed_budget ?? "—"} ${esc(r.body?.buy_intake?.currency ?? "")}</div></div>
    </div>
    <details><summary class="text-slate-500 cursor-pointer text-sm">Full response</summary>${fmtJson(r.body)}</details>
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
    <p class="text-xs text-slate-500">Status <code class="font-mono">pending_review</code> means seller operator must approve in admin UI before /live/result-slot serves it.</p>
    <table class="min-w-full text-sm border border-slate-200 rounded">
      <thead class="bg-slate-50 text-xs uppercase text-slate-500">
        <tr><th class="text-left px-3 py-2">creative_id</th><th class="text-left px-3 py-2">action</th><th class="text-left px-3 py-2">status</th></tr>
      </thead>
      <tbody>${rows.map((c) => `<tr class="border-t border-slate-100"><td class="px-3 py-2 font-mono text-xs">${esc(c.creative_id)}</td><td class="px-3 py-2">${esc(c.action ?? "—")}</td><td class="px-3 py-2">${esc(c.status ?? "—")}</td></tr>`).join("")}</tbody>
    </table>
    <details><summary class="text-slate-500 cursor-pointer text-sm">Full response</summary>${fmtJson(r.body)}</details>
  `;
}

function showDeliveryPanel(ctx) {
  const panel = $("#delivery-panel");
  panel.classList.remove("hidden");
  $("#delivery-snapshot").innerHTML = `
    <div><div class="text-xs text-slate-500">seller</div><div class="font-mono text-xs">${esc(ctx.seller_id)}</div></div>
    <div><div class="text-xs text-slate-500">media_buy_id</div><div class="font-mono text-xs">${esc(ctx.media_buy_id)}</div></div>
    <div><div class="text-xs text-slate-500">plan</div><div class="font-mono text-xs">${esc(ctx.plan_id)}</div></div>
    <div><div class="text-xs text-slate-500">last pull</div><div class="text-slate-500">never</div></div>
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
    <div><div class="text-xs text-slate-500">impressions</div><div class="font-semibold">${buy.impressions ?? "0"}</div></div>
    <div><div class="text-xs text-slate-500">spend</div><div class="font-semibold">${buy.spend ?? "0"}</div></div>
    <div><div class="text-xs text-slate-500">status</div><div>${esc(buy.status ?? buy.media_buy_status ?? "—")}</div></div>
    <div><div class="text-xs text-slate-500">last pull</div><div class="text-slate-500">${now} (UTC)</div></div>
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
    const r = await abzu("/governance/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const el = $("#plan-result");
    el.classList.remove("hidden");
    if (r.ok) {
      el.innerHTML = `
        <div class="border border-emerald-200 bg-emerald-50 rounded p-3 space-y-1">
          <div class="text-sm font-semibold text-emerald-800">Plan registered</div>
          <div class="text-xs text-emerald-700">plan_id = <code class="font-mono">${esc(fd.get("plan_id"))}</code>, status = active</div>
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
    <span>Plan <b class="text-slate-900">${esc(plan?.plan_id)}</b></span> ·
    <span>Status <b class="text-slate-900">${esc(plan?.status)}</b></span> ·
    <span>Authorized <b class="text-slate-900">${plan?.budget?.authorized ?? "—"}</b></span> ·
    <span>Checks <b class="text-slate-900">${plan?.summary?.checks_performed ?? 0}</b></span> ·
    <span>Outcomes <b class="text-slate-900">${plan?.summary?.outcomes_reported ?? 0}</b></span>
  `;

  const entries = plan?.entries || [];
  renderConditionsQueue(plan?.plan_id, entries);

  const tbody = $("#audit-tbody");
  tbody.innerHTML = "";
  entries.forEach((e) => {
    const tr = document.createElement("tr");
    tr.className = "border-t border-slate-100";
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
      <td class="px-3 py-2 text-slate-600">${esc(e.caller ?? "—")}</td>
      <td class="px-3 py-2 text-xs text-slate-500">${detailParts.join(" · ") || esc(e.id)}</td>
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
          <code class="font-mono text-xs text-slate-600">${esc(f.policy_id ?? "—")}</code>
          <span class="block text-slate-700 ml-1">${esc(f.explanation)}</span>
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
  $("#sponsor-load")?.addEventListener("click", () => loadSponsor($("#sponsor-plan-id").value));
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
  $("#sponsor-timeline-wrap").classList.remove("hidden");
  const timeline = $("#sponsor-timeline");
  timeline.innerHTML = "";
  (plan?.entries || []).forEach((e) => {
    const li = document.createElement("li");
    li.className = "flex items-start gap-3 border-l-2 border-slate-200 pl-3";
    const label = e.type === "check"
      ? `<span class="verdict-${esc(e.verdict)}">check · ${esc(e.verdict)}</span>`
      : `<span class="outcome-accepted">outcome · ${esc(e.outcome)}</span>`;
    li.innerHTML = `
      <div class="text-xs font-mono text-slate-500 w-44">${esc(e.timestamp)}</div>
      <div class="flex-1 text-sm">${label}</div>
    `;
    timeline.appendChild(li);
  });
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
    tbody.innerHTML = `<tr><td colspan="6" class="px-2 py-3 text-slate-400">No creatives in this status.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => {
    const img = pickUrl(row.assets?.image);
    const thumb = img
      ? `<img src="${esc(img)}" alt="" class="w-12 h-9 object-contain bg-white border border-slate-200" onerror="this.style.display='none';">`
      : '<span class="text-slate-300 text-xs">—</span>';
    const fmt = row.format_id?.id ?? "—";
    const statusColor = row.status === "approved" ? "text-emerald-700"
      : row.status === "rejected" ? "text-rose-700"
      : row.status === "pending_review" ? "text-amber-700" : "text-slate-600";
    const submitted = new Date(row.submitted_at).toLocaleString();
    const action = row.status === "pending_review"
      ? `<button class="op-approve px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-500" data-id="${esc(row.creative_id)}">Approve</button>
         <button class="op-reject px-2 py-1 rounded bg-transparent text-rose-700 border border-rose-300 text-xs hover:bg-rose-50 ml-1" data-id="${esc(row.creative_id)}">Reject</button>`
      : `<span class="text-slate-400 text-xs">${row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : "—"}</span>`;
    return `<tr class="border-b border-slate-100 align-middle">
      <td class="px-2 py-2">${thumb}</td>
      <td class="px-2 py-2 font-mono text-xs">${esc(row.creative_id)}</td>
      <td class="px-2 py-2 text-xs">${esc(fmt)}</td>
      <td class="px-2 py-2 text-xs font-semibold ${statusColor}">${esc(row.status)}</td>
      <td class="px-2 py-2 text-xs text-slate-500">${esc(submitted)}</td>
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
  loadOperatorCreatives();
}

function bindOperator() {
  $("#operator-reload")?.addEventListener("click", loadOperatorCreatives);
  $("#operator-status")?.addEventListener("change", loadOperatorCreatives);
}

function boot() {
  const url = new URL(window.location.href);
  const role = url.searchParams.get("role") || "sam";
  for (const link of $$(".role-link")) {
    link.addEventListener("click", () => activateRole(link.dataset.role));
  }
  activateRole(role);
  bindSam();
  bindJordan();
  bindOperator();
  bindSponsor();
  refreshKnownPlans();
  setInterval(refreshKnownPlans, 15000);
  loadKnownBrands();
  wireBrandAutofill();
  const last = getLastPlanId();
  if (last) {
    for (const input of $$(".plan-input")) input.value = last;
  }
  probeAbzu();
  setInterval(probeAbzu, 30000);
}

document.addEventListener("DOMContentLoaded", boot);
