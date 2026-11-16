// The Resilience Lab web interface: one page, no build step.
export function page() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout Resilience Lab</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
<style>${styles}</style>
</head>
<body>
<header class="bar">
  <div class="brand"><span class="target" aria-hidden="true"></span><span class="wordmark">Checkout Resilience Lab</span></div>
  <div class="store-pick">
    <label for="store">Stress-testing <strong>Ember and Wick</strong></label>
    <select id="store">
      <option value="original">as the owner wrote it</option>
      <option value="fixed">hand-fixed reference</option>
    </select>
  </div>
  <button id="run" class="primary">Run stress test</button>
  <nav class="nav"><a href="/" aria-current="page">Stress tests</a><a href="/dashboard">Dashboard</a></nav>
</header>

<main>
  <section class="summary" id="summary" aria-live="polite"></section>
  <section class="lanes" id="lanes" aria-label="Test shoppers"></section>
  <section class="detail" id="detail"></section>
  <section class="history" id="history" aria-label="Earlier stress tests"></section>
</main>

<script>${script}</script>
</body>
</html>`;
}

const styles = `
:root {
  --lab: #EDF0EF; --panel: #FFFFFF; --ink: #1D2327; --steel: #5A6872; --line: #CDD5D8;
  --yellow: #F2C400; --black: #15191C; --fail: #C8372D; --fail-bg: #FBE9E7; --pass: #1F7A4D; --pass-bg: #E4F2EA;
  --radius-s: 4px; --radius-m: 10px;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--lab); color: var(--ink); font: 400 15px/1.55 "Archivo", system-ui, sans-serif; font-stretch: 100%; }
h1, h2, h3 { font-stretch: 75%; font-weight: 700; letter-spacing: .005em; line-height: 1.1; margin: 0; }
button, select { font: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 3px solid var(--yellow); outline-offset: 2px; }

.target { --s: 26px; width: var(--s); height: var(--s); border-radius: 50%; flex: none; display: inline-block;
  background: conic-gradient(var(--black) 0 25%, var(--yellow) 0 50%, var(--black) 0 75%, var(--yellow) 0);
  box-shadow: 0 0 0 2px var(--black) inset; }
.target.empty { background: transparent; box-shadow: 0 0 0 2px var(--line) inset; }
.target.spin { animation: spin 2.4s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .target.spin { animation: none; } }

.bar { display: flex; align-items: center; gap: 24px; padding: 14px 28px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 10px; }
.wordmark { font-stretch: 62%; font-weight: 800; font-size: 28px; letter-spacing: .01em; }
.store-pick { display: flex; align-items: center; gap: 10px; margin-left: auto; color: var(--steel); flex-wrap: wrap; }
.store-pick strong { color: var(--ink); font-weight: 600; }
select { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--panel); color: var(--ink); }
.primary { padding: 10px 18px; border: 0; border-radius: var(--radius-s); background: var(--black); color: #fff; font-weight: 600; }
.primary:disabled { background: var(--steel); cursor: default; }
.secondary { padding: 8px 14px; border: 1px solid var(--ink); border-radius: var(--radius-s); background: transparent; color: var(--ink); font-weight: 600; }

.nav { display: flex; gap: 18px; }
.nav a { color: var(--steel); text-decoration: none; font-weight: 600; }
.nav a[aria-current="page"] { color: var(--ink); box-shadow: 0 2px 0 var(--yellow); }
main { max-width: 1280px; margin: 0 auto; padding: 24px 28px 64px; }

.summary { display: grid; grid-template-columns: auto 1fr auto; gap: 32px; align-items: end; margin-bottom: 22px; }
.rating { display: flex; flex-direction: column; gap: 8px; }
.marks { display: flex; gap: 6px; }
.rating p, .risk p, .state { margin: 0; color: var(--steel); }
.risk .amount { font-stretch: 62%; font-weight: 800; font-size: 64px; line-height: .9; }
.risk.bad .amount { color: var(--fail); }
.risk.good .amount { color: var(--pass); }
.state { text-align: right; }
.empty-state { grid-column: 1 / -1; padding: 28px; background: var(--panel); border: 1px dashed var(--line); border-radius: var(--radius-m); }
.empty-state h2 { font-size: 30px; margin-bottom: 8px; }
.empty-state p { margin: 0; max-width: 62ch; color: var(--steel); }

.lanes { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-bottom: 28px; }
.lane { text-align: left; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-m); background: var(--panel); color: inherit; overflow: hidden; display: flex; flex-direction: column; }
.lane[aria-pressed="true"] { border-color: var(--black); box-shadow: 0 0 0 2px var(--black); }
.frame { position: relative; aspect-ratio: 1100 / 760; background: #D9DFE1; }
.frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.frame .clock { position: absolute; left: 8px; bottom: 8px; padding: 2px 6px; background: var(--black); color: var(--yellow); font-stretch: 75%; font-weight: 600; font-variant-numeric: tabular-nums; border-radius: 3px; font-size: 13px; }
.frame .target { position: absolute; right: 8px; top: 8px; --s: 22px; }
.lane-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
.lane-body h3 { font-size: 20px; }
.persona { margin: 0; color: var(--steel); font-size: 13px; }
.now { margin: 2px 0 6px; font-size: 13px; min-height: 2.6em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.chip { align-self: flex-start; margin-top: auto; padding: 3px 8px; border-radius: 3px; font-size: 13px; font-weight: 600; }
.chip.fail { background: var(--fail-bg); color: var(--fail); }
.chip.pass { background: var(--pass-bg); color: var(--pass); }
.chip.wait { background: var(--lab); color: var(--steel); }

.detail { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-m); padding: 24px; margin-bottom: 28px; }
.detail:empty { display: none; }
.detail > h2 { font-size: 30px; }
.detail > .lede { margin: 6px 0 20px; color: var(--steel); max-width: 70ch; }
.cols { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 32px; }
.detail h3 { font-size: 19px; margin: 0 0 10px; }
.block { margin-bottom: 24px; }
.check { display: grid; grid-template-columns: 22px 1fr; gap: 8px; padding: 8px 0; border-top: 1px solid var(--line); }
.check:first-of-type { border-top: 0; }
.check .icon { font-weight: 800; }
.check.ok .icon { color: var(--pass); }
.check.bad .icon { color: var(--fail); }
.check p { margin: 0; }
.check small { color: var(--steel); display: block; }
.atrisk { margin-top: 10px; padding: 10px 12px; background: var(--fail-bg); color: var(--fail); border-radius: var(--radius-s); font-weight: 600; }
.inconclusive { padding: 10px 12px; background: var(--lab); border-radius: var(--radius-s); }
.call { display: grid; grid-template-columns: 56px 1fr auto; gap: 8px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 14px; }
.call:first-of-type { border-top: 0; }
.call .t { color: var(--steel); font-variant-numeric: tabular-nums; }
.call .muted { color: var(--steel); }
.call .ids { grid-column: 2 / -1; color: var(--steel); font-size: 12.5px; word-break: break-all; }
.injected { grid-column: 2 / -1; justify-self: start; padding: 2px 8px; font-size: 12.5px; font-weight: 600; color: var(--black);
  background: repeating-linear-gradient(135deg, var(--yellow) 0 10px, #FFE36B 10px 20px); border-radius: 3px; }
.status.err { color: var(--fail); font-weight: 600; }
.step { padding: 8px 0; border-top: 1px solid var(--line); }
.step:first-of-type { border-top: 0; }
.step p { margin: 0; }
.step small { color: var(--steel); display: block; }
video { width: 100%; border-radius: var(--radius-s); background: var(--black); }

.why { border-top: 2px solid var(--black); padding-top: 18px; margin-bottom: 24px; }
.why h3 { font-size: 24px; }
.why .explain { font-size: 17px; max-width: 70ch; margin: 8px 0 14px; }
.why dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 14px; }
.why dt { color: var(--steel); }
.why dd { margin: 0; }
.diff { background: #F6F8F8; border: 1px solid var(--line); border-radius: var(--radius-s); padding: 12px; overflow-x: auto; font: 13px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre; }
.diff .del { color: var(--fail); background: var(--fail-bg); display: block; }
.diff .add { color: var(--pass); background: var(--pass-bg); display: block; }
.diff .file { color: var(--steel); display: block; margin: 6px 0 4px; }
.beforeafter { display: flex; gap: 28px; align-items: center; margin: 14px 0; flex-wrap: wrap; }
.beforeafter .n { font-stretch: 62%; font-weight: 800; font-size: 40px; }
.progress { color: var(--steel); }

.history h2 { font-size: 22px; margin-bottom: 10px; }
.history ul { list-style: none; margin: 0; padding: 0; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-m); }
.history li + li { border-top: 1px solid var(--line); }
.history button { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 12px; text-align: left; padding: 12px 16px; border: 0; background: transparent; color: inherit; }
.history .when { font-weight: 600; }
.history .meta { color: var(--steel); }

@media (max-width: 760px) {
  .bar { padding: 12px 16px; gap: 12px; }
  .store-pick { margin-left: 0; }
  main { padding: 16px 16px 48px; }
  .summary { grid-template-columns: 1fr; gap: 14px; }
  .state { text-align: left; }
  .cols { grid-template-columns: minmax(0, 1fr); }
  .lanes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .lane-body h3 { font-size: 17px; }
  .detail { padding: 18px 16px; }
  .risk .amount { font-size: 48px; }
}
`;

const script = `
const SHORT = { "refund-retry": "Refund retry", "refund-scam": "Refund scam", "double-pay": "Double-click pay", "declined-card": "Declined card", "price-tamper": "Price tampering" };
const state = { scenarios: [], run: null, selected: null, frames: {}, source: null, history: [], fixLive: {} };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (cents) => "$" + (cents / 100).toFixed(2);

function marks(n) {
  return '<span class="marks">' + [1, 2, 3, 4, 5].map((i) => '<span class="target ' + (i <= n ? "" : "empty") + '"></span>').join("") + "</span>";
}

function stepText(s) {
  const a = s.args || {};
  switch (s.tool) {
    case "view_shop": return "Looked at the shop";
    case "buy_items": return "Paid for " + (a.items || []).map((i) => i.quantity + " × " + i.sku).join(", ");
    case "request_refund": return "Asked for a refund on " + a.sku;
    case "chat_with_support": return "Told support: “" + a.message + "”";
    case "finish": return "Reported back: " + a.summary;
    default: return s.tool;
  }
}

function callText(e) {
  if (e.path.includes("/oauth2/token")) return "Get PayPal access token";
  if (e.method === "POST" && /\\/v2\\/checkout\\/orders$/.test(e.path)) return "Create order";
  if (/\\/capture$/.test(e.path)) return "Capture payment";
  if (/\\/refund$/.test(e.path)) return "Refund";
  if (e.method === "GET") return "Look up order";
  return e.method + " " + e.path;
}

function laneVerdict(l) { return l.fix && l.fix.after ? l.fix.after.verdict : l.result && l.result.verdict; }

function chip(l) {
  if (l.status === "queued") return '<span class="chip wait">Waiting</span>';
  if (l.status === "running") return '<span class="chip wait">Shopping</span>';
  if (l.status === "checking") return '<span class="chip wait">Checking the money</span>';
  if (l.status === "error") return '<span class="chip fail">Test error</span>';
  const v = l.result.verdict;
  if (v.inconclusive) return '<span class="chip wait">Inconclusive</span>';
  if (v.atRiskCents > 0) return '<span class="chip fail">' + money(v.atRiskCents) + " at risk</span>";
  if (v.checks.every((c) => c.passed)) return '<span class="chip pass">All checks pass</span>';
  return '<span class="chip fail">' + v.checks.filter((c) => !c.passed).length + " check(s) failed</span>";
}

function clock(l) {
  const started = l.steps && l.steps[0] ? Date.parse(l.steps[0].at) - 2000 : null;
  if (!started) return "T+ 00:00.0";
  const end = l.status === "running" || l.status === "checking" ? Date.now() : Date.parse((l.steps[l.steps.length - 1] || {}).at || Date.now());
  const ms = Math.max(0, end - started);
  const m = Math.floor(ms / 60000), s = ((ms % 60000) / 1000).toFixed(1).padStart(4, "0");
  return "T+ " + String(m).padStart(2, "0") + ":" + s;
}

function renderSummary() {
  const run = state.run;
  if (!run) {
    $("summary").innerHTML = '<div class="empty-state"><h2>Test your checkout before your customers do</h2><p>Checkout Resilience Lab sends AI test shoppers through a real PayPal checkout, injects the failures real traffic brings, then checks every charge and refund in PayPal’s own records. Press Run stress test to start.</p></div>';
    return;
  }
  const done = run.lanes.filter((l) => l.result);
  const judged = done.filter((l) => !laneVerdict(l).inconclusive);
  const risk = judged.reduce((s, l) => s + laneVerdict(l).atRiskCents, 0);
  const rating = judged.length ? Math.min(...judged.map((l) => laneVerdict(l).rating)) : 0;
  const running = run.lanes.filter((l) => l.status === "running" || l.status === "checking").length;
  const finished = Boolean(run.finishedAt);
  $("summary").innerHTML =
    '<div class="rating">' + marks(rating) + "<p>" + (judged.length ? "Resilience score " + rating + " of 5, set by the weakest test" : "No results yet") + "</p></div>" +
    '<div class="risk ' + (judged.length ? (risk > 0 ? "bad" : "good") : "") + '"><div class="amount">' + (judged.length ? money(risk) : "–") + "</div><p>" + (judged.length ? "money at risk across " + done.length + " of " + run.lanes.length + " tests" : "money at risk shows here as tests finish") + "</p></div>" +
    '<p class="state">' + (finished ? "Finished " + new Date(run.finishedAt).toLocaleTimeString() : running + " running, " + run.lanes.filter((l) => l.status === "queued").length + " waiting") + "<br>Store: " + (run.store === "original" ? "as the owner wrote it" : "hand-fixed reference") + "</p>";
}

function renderLanes() {
  const run = state.run;
  if (!run) { $("lanes").innerHTML = ""; return; }
  $("lanes").innerHTML = run.lanes.map((l) => {
    const sc = state.scenarios.find((s) => s.id === l.scenario) || {};
    const last = l.steps[l.steps.length - 1];
    const live = l.status === "running" || l.status === "checking" || (l.fix && !["done", "failed"].includes(l.fix.status));
    return '<button class="lane" data-lane="' + l.scenario + '" aria-pressed="' + (state.selected === l.scenario) + '">' +
      '<div class="frame">' + (state.frames[l.scenario] || l.result ? '<img alt="" onerror="this.remove()" src="' + (state.frames[l.scenario] || "/api/runs/" + run.id + "/lanes/" + l.scenario + "/frame") + '">' : "") +
      '<span class="clock" data-clock="' + l.scenario + '">' + clock(l) + '</span><span class="target ' + (live ? "spin" : "") + '" aria-hidden="true"></span></div>' +
      '<div class="lane-body"><h3>' + esc(SHORT[l.scenario] || l.scenario) + '</h3><p class="persona">' + esc(sc.persona) + '</p>' +
      '<p class="now">' + esc(last ? stepText(last) : sc.summary) + "</p>" + chip(l) + "</div></button>";
  }).join("");
}

function checksHtml(v) {
  if (v.inconclusive) return '<p class="inconclusive">' + esc(v.inconclusive) + "</p>";
  return v.checks.map((c) => '<div class="check ' + (c.passed ? "ok" : "bad") + '"><span class="icon">' + (c.passed ? "✓" : "✗") + "</span><p>" + esc(c.name) + "<small>" + esc(c.detail) + "</small></p></div>").join("") +
    v.atRisk.map((r) => '<p class="atrisk">' + esc(r.reason) + ": " + money(r.cents) + "</p>").join("");
}

function callsHtml(calls) {
  if (!calls.length) return "<p class=\\"progress\\">No PayPal calls yet.</p>";
  const t0 = Date.parse(calls[0].at);
  return calls.map((e) => {
    const s = e.summary || {};
    const ids = [s.orderId && "order " + s.orderId, s.captureId && "capture " + s.captureId, s.refundId && "refund " + s.refundId, s.amount && "$" + s.amount, s.issue && s.issue, e.requestId && "PayPal-Request-Id " + e.requestId].filter(Boolean).join(", ");
    const token = e.path.includes("/oauth2/token");
    return '<div class="call"><span class="t">+' + ((Date.parse(e.at) - t0) / 1000).toFixed(1) + 's</span><span class="' + (token ? "muted" : "") + '">' + esc(callText(e)) + '</span><span class="status ' + (e.status >= 400 ? "err" : "") + '">' + e.status + "</span>" +
      (ids ? '<span class="ids">' + esc(ids) + "</span>" : "") + (e.fault ? '<span class="injected">Injected: ' + esc(e.fault.split(": ").slice(1).join(": ")) + "</span>" : "") + "</div>";
  }).join("");
}

function diffHtml(edits) {
  return edits.map((e) => '<span class="file">' + esc(e.file) + "</span>" +
    e.find.split("\\n").map((l) => '<span class="del">- ' + esc(l) + "</span>").join("") +
    e.replace.split("\\n").map((l) => '<span class="add">+ ' + esc(l) + "</span>").join("")).join("");
}

function whyHtml(l) {
  const v = l.result && l.result.verdict;
  if (!v || v.inconclusive || v.checks.every((c) => c.passed)) return "";
  const fix = l.fix;
  let html = '<div class="why"><h3>Why it broke</h3>';
  if (!fix) {
    html += state.run.store === "original"
      ? '<p class="explain">Resilience Lab’s investigator can read this test’s evidence and the store’s code, explain the failure and write a fix. The fix is applied to a copy of the store and the same test runs again.</p><button class="primary" data-fix="' + l.scenario + '">Investigate and fix</button>'
      : '<p class="explain">This is the hand-fixed reference store, so there is nothing to patch.</p>';
    return html + "</div>";
  }
  const words = { investigating: "Reading the evidence and the store’s code…", patching: "Applying the fix to a copy of the store…", compiling: "Checking the fix compiles…", rerunning: "Running the same test against the patched store…", failed: "The fix didn’t work out." };
  if (fix.status !== "done") html += '<p class="progress">' + esc(words[fix.status] || "") + (fix.message ? "<br>" + esc(fix.message) : "") + "</p>";
  const d = fix.diagnosis;
  if (d) {
    html += '<p class="explain">' + esc(d.explanation) + "</p><dl><dt>Where</dt><dd>" + esc(d.rootCause.file + ":" + d.rootCause.line) + "</dd><dt>The fix</dt><dd>" + esc(d.fix.summary) + "</dd><dt>PayPal guidance</dt><dd>" + esc(d.paypalGuidance) + "</dd><dt>Written by</dt><dd>" + esc(d.model) + "</dd></dl>" +
      '<pre class="diff">' + diffHtml(d.fix.edits) + "</pre>";
  }
  if (fix.after) {
    const a = fix.after.verdict;
    html += '<div class="beforeafter"><div>' + marks(v.rating) + "<p>Before: " + money(v.atRiskCents) + ' at risk</p></div><div class="n">to</div><div>' + marks(a.rating) + "<p>After: " + money(a.atRiskCents) + " at risk</p></div></div>" +
      '<h3>Re-run against the patched store</h3>' + checksHtml(a) +
      '<div class="block"><h3>Re-run recording</h3><video controls preload="none" src="/api/runs/' + state.run.id + "/lanes/" + l.scenario + '/video?which=after"></video></div>';
  }
  return html + "</div>";
}

function renderDetail() {
  const run = state.run;
  const l = run && run.lanes.find((x) => x.scenario === state.selected);
  if (!l) { $("detail").innerHTML = ""; return; }
  const sc = state.scenarios.find((s) => s.id === l.scenario) || {};
  const v = l.result && l.result.verdict;
  $("detail").innerHTML = "<h2>" + esc(sc.title) + '</h2><p class="lede">' + esc(sc.summary) + "</p>" +
    '<div class="cols"><div>' +
      '<div class="block"><h3>Money checks</h3>' + (v ? checksHtml(v) : '<p class="progress">' + (l.error ? esc(l.error) : "Checks run when the shopper finishes.") + "</p>") + "</div>" +
      whyHtml(l) +
    '</div><div>' +
      '<div class="block"><h3>PayPal calls</h3>' + callsHtml(l.paypal) + "</div>" +
      (l.result ? '<div class="block"><h3>Recording</h3><video controls preload="none" src="/api/runs/' + run.id + "/lanes/" + l.scenario + '/video"></video></div>' : "") +
      '<div class="block"><h3>What the shopper did</h3>' + (l.steps.length ? l.steps.map((s) => '<div class="step"><p>' + esc(stepText(s)) + "</p>" + (resultText(s) ? "<small>" + esc(resultText(s)) + "</small>" : "") + "</div>").join("") : '<p class="progress">Not started yet.</p>') + "</div>" +
    "</div></div>";
}

function resultText(s) {
  if (s.tool === "finish") return "";
  if (s.tool === "view_shop") {
    try { return "Saw " + JSON.parse(s.result).map((p) => p.name + " " + p.price).join(", "); } catch { return ""; }
  }
  return s.result.slice(0, 220);
}

function renderHistory() {
  const items = state.history.filter((r) => !state.run || r.id !== state.run.id).slice(0, 8);
  if (!items.length) { $("history").innerHTML = ""; return; }
  $("history").innerHTML = "<h2>Earlier stress tests</h2><ul>" + items.map((r) => {
    const judged = r.lanes.filter((l) => l.verdict && !l.verdict.inconclusive);
    const risk = judged.reduce((s, l) => s + l.verdict.atRiskCents, 0);
    return '<li><button data-open="' + r.id + '"><span><span class="when">' + new Date(r.startedAt).toLocaleString() + '</span><br><span class="meta">' + (r.store === "original" ? "Store as written" : "Hand-fixed reference") + ", " + r.lanes.length + " tests</span></span><span>" + money(risk) + " at risk</span></button></li>";
  }).join("") + "</ul>";
}

function render() { renderSummary(); renderLanes(); renderDetail(); renderHistory(); $("run").disabled = Boolean(state.run && !state.run.finishedAt); }

function openRun(run) {
  state.run = run;
  state.frames = {};
  if (!state.selected || !run.lanes.some((l) => l.scenario === state.selected)) state.selected = run.lanes[0] && run.lanes[0].scenario;
  if (state.source) state.source.close();
  state.source = new EventSource("/api/runs/" + run.id + "/stream");
  state.source.addEventListener("snapshot", (e) => { state.run = JSON.parse(e.data); render(); });
  state.source.addEventListener("update", (e) => {
    const u = JSON.parse(e.data);
    const lane = state.run.lanes.find((l) => l.scenario === u.lane);
    if (u.laneUpdate) Object.assign(lane, u.laneUpdate);
    else if (u.event) {
      if (u.event.type === "step") lane.steps.push(u.event.step);
      if (u.event.type === "paypal") lane.paypal.push(u.event.entry);
      if (u.event.type === "checking") lane.status = "checking";
    } else if (u.run === "finished") { fetch("/api/runs/" + state.run.id).then((r) => r.json()).then((r) => { state.run = r; loadHistory(); render(); }); }
    render();
  });
  render();
}

async function pollFrames() {
  const run = state.run;
  if (run) {
    for (const l of run.lanes) {
      const live = l.status === "running" || l.status === "checking" || (l.fix && ["rerunning"].includes(l.fix.status));
      if (!live) continue;
      const res = await fetch("/api/runs/" + run.id + "/lanes/" + l.scenario + "/frame").catch(() => null);
      if (res && res.status === 200) {
        const url = URL.createObjectURL(await res.blob());
        if (state.frames[l.scenario]) URL.revokeObjectURL(state.frames[l.scenario]);
        state.frames[l.scenario] = url;
        const img = document.querySelector('[data-lane="' + l.scenario + '"] img');
        if (img) img.src = url; else renderLanes();
      }
    }
  }
  setTimeout(pollFrames, 1000);
}

function tickClocks() {
  if (state.run) for (const l of state.run.lanes) {
    const el = document.querySelector('[data-clock="' + l.scenario + '"]');
    if (el && (l.status === "running" || l.status === "checking")) el.textContent = clock(l);
  }
  setTimeout(tickClocks, 200);
}

async function loadHistory() { state.history = await (await fetch("/api/runs")).json(); renderHistory(); }

document.addEventListener("click", async (e) => {
  const lane = e.target.closest("[data-lane]");
  if (lane) { state.selected = lane.dataset.lane; renderLanes(); renderDetail(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const fix = e.target.closest("[data-fix]");
  if (fix) { fix.disabled = true; await fetch("/api/runs/" + state.run.id + "/lanes/" + fix.dataset.fix + "/fix", { method: "POST" }); return; }
  const open = e.target.closest("[data-open]");
  if (open) { const r = await (await fetch("/api/runs/" + open.dataset.open)).json(); openRun(r); window.scrollTo({ top: 0, behavior: "smooth" }); }
});

$("run").addEventListener("click", async () => {
  $("run").disabled = true;
  const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: $("store").value }) });
  const data = await res.json();
  if (!res.ok) { alert(data.error); $("run").disabled = false; return; }
  openRun(data);
  loadHistory();
});

(async () => {
  state.scenarios = await (await fetch("/api/scenarios")).json();
  await loadHistory();
  const wanted = new URLSearchParams(location.search).get("run");
  const first = state.history.find((r) => r.id === wanted) || state.history[0];
  if (first) openRun(await (await fetch("/api/runs/" + first.id)).json()); else render();
  pollFrames(); tickClocks(); followNewRuns();
})();

// A run started elsewhere (a coding agent over MCP, another tab) opens here as soon as it begins.
async function followNewRuns() {
  await loadHistory().catch(() => {});
  const latest = state.history[0];
  if (latest && !latest.finishedAt && (!state.run || state.run.id !== latest.id)) openRun(await (await fetch("/api/runs/" + latest.id)).json());
  setTimeout(followNewRuns, 4000);
}
`;
