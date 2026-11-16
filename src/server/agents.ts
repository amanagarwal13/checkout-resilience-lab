import { styles } from "./ui.js";

// The "Coding agents" page: how to connect Claude (and other agents) to the
// lab's MCP server, what each tool does, and the test-and-fix flow.
export function agentsPage(publicUrl: string) {
  const mcpUrl = `${publicUrl}/mcp`;
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl);
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const code = (text: string, label: string) =>
    `<div class="code"><pre><code>${esc(text)}</code></pre><button class="copy" type="button" data-copy="${esc(text)}" aria-label="Copy ${esc(label)}">Copy</button></div>`;

  const claudeCode = `claude mcp add --transport http checkout-resilience-lab ${mcpUrl}`;
  const claudeDesktop = JSON.stringify({ mcpServers: { "checkout-resilience-lab": { command: "npx", args: ["-y", "mcp-remote", mcpUrl] } } }, null, 2);
  const cursor = JSON.stringify({ mcpServers: { "checkout-resilience-lab": { url: mcpUrl } } }, null, 2);
  const codex = `[mcp_servers.checkout-resilience-lab]\nurl = "${mcpUrl}"`;
  const exampleResult = JSON.stringify(
    {
      run_id: "2026-10-19T14-18-52-607Z",
      status: "finished",
      watch_url: `${publicUrl}/?run=2026-10-19T14-18-52-607Z`,
      resilience_score: "2/5 (weakest test)",
      total_money_at_risk_usd: "16.00",
      tests: [
        {
          scenario: "refund-retry",
          status: "done",
          resilience_score: "2/5",
          money_at_risk_usd: "16.00",
          failed_checks: ["Each refund happens once: 1 item(s) to refund, PayPal made 2 refund(s)", "…"],
        },
      ],
    },
    null,
    2,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coding agents · Checkout Resilience Lab</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
<style>${styles}${docStyles}</style>
</head>
<body>
<header class="bar">
  <a class="brand" href="/"><span class="target" aria-hidden="true"></span><span class="wordmark">Checkout Resilience Lab</span></a>
  <nav class="nav"><a href="/">Stress tests</a><a href="/dashboard">Dashboard</a><a href="/agents" aria-current="page">Coding agents</a></nav>
</header>

<main class="doc">
  <h1>Stress-test and fix your checkout from your coding agent</h1>
  <p class="lede">The lab is also an MCP server. Connect Claude Code, Cursor or Codex, and your agent can run the same stress tests you run on the Stress tests page, read what went wrong, get the fix as exact code edits, apply them, and run the test again to prove the money now comes out right. You stay in your editor; the AI shoppers run in the lab.</p>

  <div class="endpoint">
    <div>
      <h2 class="small">MCP server address</h2>
      ${code(mcpUrl, "the MCP server address")}
    </div>
    <p>${
      local
        ? "The lab runs on this computer, so your agent's fixes land in your working copy and the re-run tests exactly what was saved. Keep <code>npm start</code> running while you work."
        : "This is a hosted lab. It tests the demo store on this server, so an agent can run tests, read the evidence and see a fix proven on a copy (<code>verify_fix_in_copy</code>), but it can't change your files. For the full loop, run the lab on your own computer with <code>npm start</code>."
    }</p>
  </div>

  <nav class="toc" aria-label="On this page">
    <a href="#connect">Connect Claude</a>
    <a href="#other-agents">Cursor and Codex</a>
    <a href="#tools">What your agent can do</a>
    <a href="#flow">The test-and-fix flow</a>
    <a href="#prompts">Things to ask</a>
    <a href="#good-to-know">Good to know</a>
  </nav>

  <section id="connect">
    <h2>Connect Claude</h2>

    <h3>Claude Code</h3>
    <p>Claude Code can run the tests and edit your files, so it can do the whole loop. In a terminal, run:</p>
    ${code(claudeCode, "the Claude Code command")}
    <p>Then start Claude Code and type <code>/mcp</code>. You should see <strong>checkout-resilience-lab</strong> connected, with six tools. To share the setup with everyone working in the repository, add <code>--scope project</code> to the command; Claude Code saves it in <code>.mcp.json</code>.</p>
    <p>Open Claude Code in this repository's folder and you also get the <code>/stress-test</code> command, which runs the whole loop below in one go. <code>/stress-test refund-retry double-pay</code> runs just those scenarios.</p>

    <h3>Claude Desktop</h3>
    <p>Claude Desktop can run tests, read evidence and explain fixes, but it can't edit your files, so use Claude Code for the fix itself. Open <strong>Settings → Developer → Edit Config</strong>, add the lab to <code>claude_desktop_config.json</code>, then restart Claude Desktop:</p>
    ${code(claudeDesktop, "the Claude Desktop config")}
    <p class="note">This uses <code>mcp-remote</code> from npm to connect Claude Desktop to the lab's web address. It needs Node installed.</p>
    ${
      local
        ? ""
        : `<h3>Claude on the web</h3>
    <p>On claude.ai, open <strong>Settings → Connectors → Add custom connector</strong> and paste the address above. Custom connectors need a public HTTPS address like this hosted lab; they can't reach a lab on your own computer.</p>`
    }
  </section>

  <section id="other-agents">
    <h2>Cursor and Codex</h2>
    <h3>Cursor</h3>
    <p>Add this to <code>.cursor/mcp.json</code> in your project (or <code>~/.cursor/mcp.json</code> for every project):</p>
    ${code(cursor, "the Cursor config")}
    <h3>Codex</h3>
    <p>Add this to <code>~/.codex/config.toml</code>:</p>
    ${code(codex, "the Codex config")}
    <p>Any other agent that supports MCP over HTTP works the same way: give it the address above.</p>
  </section>

  <section id="tools">
    <h2>What your agent can do</h2>
    <p>Six tools. Only <code>start_stress_test</code> and <code>verify_fix_in_copy</code> run AI shoppers; the rest read results or explain them.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Tool</th><th scope="col">What it does</th><th scope="col">What your agent gets back</th></tr></thead>
        <tbody>
          <tr><td><code>list_scenarios</code></td><td>Lists the failures the lab can throw at the checkout.</td><td>Each scenario's id, title and the kind of AI shopper it uses: <code>refund-retry</code>, <code>refund-scam</code>, <code>double-pay</code>, <code>declined-card</code>, <code>price-tamper</code>.</td></tr>
          <tr><td><code>start_stress_test</code></td><td>Sends AI shoppers through the store's real PayPal sandbox checkout while the lab injects failures. Returns at once.</td><td>A <code>run_id</code> and a <code>watch_url</code> to watch the shoppers live.</td></tr>
          <tr><td><code>get_stress_test</code></td><td>Waits up to 50 seconds for the run to finish, then reports.</td><td>For each test: resilience score out of 5, money at risk in dollars and the money checks that failed.</td></tr>
          <tr><td><code>get_test_evidence</code></td><td>The full record of one test.</td><td>Every PayPal call with any injected fault, the money at risk by reason, and each step the AI shopper took with what the shop said.</td></tr>
          <tr><td><code>diagnose_failure</code></td><td>The lab's AI investigator reads the evidence and the store's code. Changes nothing.</td><td>A plain-English explanation, the file and line at fault, PayPal's guidance, and the fix as exact find-and-replace edits.</td></tr>
          <tr><td><code>verify_fix_in_copy</code></td><td>Applies the investigator's fix to a copy of the store and re-runs the same test, leaving your files alone.</td><td>Score and money at risk before and after the fix.</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="flow">
    <h2>The test-and-fix flow</h2>
    <p>This is what happens when you ask your agent to stress-test the checkout and fix what fails. Your agent decides the calls; you approve the code changes.</p>
    <ol class="flow">
      <li>
        <h3>Start the lab</h3>
        <p>Run <code>npm start</code> in this repository and open <a href="/">the Stress tests page</a> in a browser. Leave it open: it switches to each run your agent starts, so you can watch the shoppers while the agent works.</p>
      </li>
      <li>
        <h3>Ask your agent</h3>
        <p>For example: <em>"Stress-test my PayPal checkout, fix what fails, and run it again."</em> In Claude Code, <code>/stress-test</code> does the same.</p>
      </li>
      <li>
        <h3>The agent starts a stress test</h3>
        <p>It calls <code>start_stress_test</code>, with no scenarios for all five or a list of ids for some. It gets back a <code>run_id</code> and a link to watch. One scenario takes about a minute; all five run three at a time and take a few minutes.</p>
      </li>
      <li>
        <h3>The agent waits for the results</h3>
        <p>It calls <code>get_stress_test</code> with <code>wait_seconds: 50</code> until the status is <code>finished</code>. For each test it gets the score, the money at risk and the failed checks, all read from PayPal's own records. An example:</p>
        ${code(exampleResult, "the example result")}
      </li>
      <li>
        <h3>The agent asks why each test failed</h3>
        <p>For each failing test it calls <code>diagnose_failure</code>. The investigator reads what the shopper did, every PayPal call, the injected fault and the store's code, and returns the cause in plain English, the line at fault (such as <code>stores/ember-and-wick/original/app.ts:101</code>) and the fix as edits. Nothing is changed yet. If it needs more detail, the agent can call <code>get_test_evidence</code>.</p>
      </li>
      <li>
        <h3>You review the fix, and the agent applies it</h3>
        <p>The agent shows you the edits and, once you approve, applies them to your files. Each edit's text to find appears exactly once, so it lands in the right place.</p>
      </li>
      <li>
        <h3>The agent runs the failing tests again</h3>
        <p>It calls <code>start_stress_test</code> again with only the scenarios that failed, then waits with <code>get_stress_test</code>. Each test starts the store fresh from disk, so the re-run tests exactly the code the agent just saved, against PayPal's sandbox again.</p>
      </li>
      <li>
        <h3>You get a before-and-after</h3>
        <p>The agent reports each test's score and money at risk before and after. For the refund retry, that's 2/5 with $16.00 at risk before and 5/5 with $0.00 after. If anything still fails, the agent repeats steps 5 to 7 or says plainly what's left.</p>
      </li>
    </ol>
    <p class="note">Want to see a fix work without touching your files? Ask the agent to use <code>verify_fix_in_copy</code> instead of steps 6 and 7: the fix goes into a copy and the same test runs against it.</p>
  </section>

  <section id="prompts">
    <h2>Things to ask</h2>
    <ul class="prompts">
      <li>"Stress-test my PayPal checkout, fix what fails, and run it again."</li>
      <li>"Which scenarios can you run? Just run the double-click and declined-card ones."</li>
      <li>"Why did the refund retry test fail? Show me the PayPal calls."</li>
      <li>"Diagnose the price-tamper failure, but don't change anything yet."</li>
      <li>"Try the investigator's fix for refund-scam on a copy and tell me if it works."</li>
      <li>"Run the hand-fixed reference store so I can compare."</li>
    </ul>
  </section>

  <section id="good-to-know">
    <h2>Good to know</h2>
    <ul>
      <li><strong>What gets tested.</strong> The agent tests the demo store in <code>stores/ember-and-wick/original</code>, which ships with real bugs. After a fix, put the bugs back with <code>git checkout -- stores/ember-and-wick/original</code>. Testing your own store this way is on the roadmap; see the <a href="https://github.com/amanagarwal13/checkout-resilience-lab#testing-your-own-store">README</a>.</li>
      <li><strong>One stress test at a time.</strong> If one is already running, <code>start_stress_test</code> says so; the agent should wait for it.</li>
      <li><strong>Sandbox only.</strong> Every payment and refund happens in PayPal's sandbox with test cards. No real money moves.</li>
      <li><strong>It uses your OpenAI key.</strong> Each test is an AI shopper conversation on <code>gpt-5-mini</code>, and each diagnosis is one <code>gpt-5.5</code> call.</li>
      <li><strong>Limits.</strong> MCP calls are limited to 200 an hour per visitor and 2,000 a day for the whole lab (<code>DAILY_MCP_CALLS</code>), the same guard as the rest of the lab.</li>
      <li><strong>Review AI-written fixes.</strong> The re-run proves the money comes out right in the scenario tested, not that the change is the best one. Read the diff before you commit it.</li>
    </ul>
  </section>
</main>

<script>
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button.copy");
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied"; }
  catch { b.textContent = "Select and copy"; }
  setTimeout(() => { b.textContent = "Copy"; }, 1800);
});
</script>
</body>
</html>`;
}

const docStyles = `
.bar .nav { margin-left: auto; }
a.brand { color: inherit; text-decoration: none; }
.doc { max-width: 920px; padding-top: 40px; }
.doc h1 { font-size: 46px; max-width: 18ch; margin-bottom: 14px; }
.doc .lede { font-size: 17px; max-width: 68ch; color: var(--steel); margin: 0 0 28px; }
.doc section { margin-top: 48px; scroll-margin-top: 16px; }
.doc section > h2 { font-size: 32px; margin-bottom: 12px; }
.doc h3 { font-size: 21px; margin: 24px 0 6px; }
.doc h2.small { font-size: 18px; margin-bottom: 8px; }
.doc p, .doc li { max-width: 72ch; }
.doc a { color: var(--ink); text-decoration-color: var(--yellow); text-decoration-thickness: 2px; text-underline-offset: 3px; }
.doc code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: .9em; background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; }
.note { color: var(--steel); }

.endpoint { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: end; padding: 20px 22px; background: var(--panel); border: 1px solid var(--line); border-left: 6px solid var(--yellow); border-radius: var(--radius-m); }
.endpoint p { margin: 0; color: var(--steel); }

.code { position: relative; margin: 10px 0 14px; }
.code pre { margin: 0; padding: 14px 84px 14px 16px; background: var(--black); color: #F4F6F6; border-radius: var(--radius-s); overflow-x: auto; font: 13.5px/1.55 ui-monospace, "Cascadia Mono", Consolas, monospace; }
.code pre code { background: none; border: 0; padding: 0; font-size: inherit; color: inherit; }
.copy { position: absolute; top: 8px; right: 8px; padding: 4px 10px; border: 1px solid #5A6872; border-radius: 3px; background: #2A3136; color: #fff; font-size: 13px; font-weight: 600; }
.copy:hover { background: #3A4248; }

.toc { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--line); }
.toc a { color: var(--steel); font-weight: 600; text-decoration: none; }
.toc a:hover { color: var(--ink); }

.table-wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-m); }
table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
th, td { text-align: left; vertical-align: top; padding: 12px 14px; border-top: 1px solid var(--line); }
thead th { border-top: 0; font-stretch: 75%; font-size: 16px; }
td:first-child { white-space: nowrap; }

.flow { list-style: none; counter-reset: step; padding: 0; margin: 20px 0 0; }
.flow > li { counter-increment: step; position: relative; padding: 0 0 22px 56px; }
.flow > li::before { content: counter(step); position: absolute; left: 0; top: -2px; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
  background: var(--black); color: var(--yellow); font-weight: 800; font-stretch: 75%; font-size: 18px; }
.flow > li::after { content: ""; position: absolute; left: 17px; top: 38px; bottom: 4px; width: 2px; background: var(--line); }
.flow > li:last-child::after { display: none; }
.flow h3 { margin: 4px 0 6px; }
.flow p { margin: 0 0 6px; }

.prompts { padding-left: 20px; }
.prompts li { margin: 6px 0; }

@media (max-width: 720px) {
  .doc { padding-top: 24px; }
  .doc h1 { font-size: 34px; }
  .endpoint { grid-template-columns: 1fr; }
  .flow > li { padding-left: 48px; }
  /* The tools table becomes one block per tool. */
  table, tbody, tr, td { display: block; }
  thead { display: none; }
  tr { padding: 12px 14px; border-top: 1px solid var(--line); }
  tbody tr:first-child { border-top: 0; }
  td { border: 0; padding: 3px 0; }
  td:nth-child(2)::before, td:nth-child(3)::before { display: block; font-weight: 700; font-stretch: 75%; font-size: 14px; }
  td:nth-child(2)::before { content: "What it does"; }
  td:nth-child(3)::before { content: "What your agent gets back"; margin-top: 6px; }
}
`;
