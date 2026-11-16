# Implementation log

One entry per phase of [PLAN.md](PLAN.md): what was built, decisions, results
and problems. Newest at the bottom. Dates are 2026.

The project was called DummyRun while it was built, and this log keeps that
name. It's now Checkout Resilience Lab: "crash test" became "stress test",
"safety rating" became "resilience score", `npm run crash` became
`npm run stress`, the SDK helper `dummyrun()` became `resilienceLab()` and
`DUMMYRUN_PAYPAL_API` became `RESILIENCE_LAB_PAYPAL_API`.

---

## Phase 0. Project setup
**Date:** Oct 19 · **Status:** done

- Project folder, Git repo, branch `spike/72-hour-test`.
- Dependencies: Hono, PayPal Server SDK 2.5.0, OpenAI SDK, Playwright (Chromium), axios; TypeScript with tsx.
- `.env` (gitignored) holds the PayPal sandbox app keys and the OpenAI key.
- **Decision: US sandbox Business account.** The India sandbox account could create PayPal-button orders, but card payments failed with `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`. Automated shoppers need card payments to avoid PayPal login and one-time codes, so a US Business test account and a new app (`DummyRun`) were created. Verified: test Visa order paid and captured.
- **Verified on PayPal before writing code:** a partial refund retried without `PayPal-Request-Id` creates a second refund; retried with the same ID returns the original refund.

## Phase 1. Refund-retry crash test
**Date:** Oct 19 · **Status:** done · **Commit:** `74806b3`

Built:
- `src/store/` — Ember and Wick demo store. PayPal card fields and button (JS SDK v5), Server SDK on the server, server-side prices, `original` and `fixed` builds.
- `src/paypal/client.ts` — SDK client. **Decision:** the SDK hard-codes PayPal's hosts, but passes `unstable_httpClientOptions` to axios; a custom axios adapter rewrites the host, so a store points at DummyRun with one setting.
- `src/lab/proxy.ts` — forwards to the sandbox, logs every call (request ID, debug ID, order/capture/refund IDs) and can hold PayPal's answer after PayPal has processed the request.
- `src/shopper/` — AI test shopper: OpenAI decides, Playwright clicks; pays with PayPal's test Visa through the card-field iframes.
- `src/lab/crash.ts`, `src/lab/paypalDirect.ts` — runner and money checks read straight from PayPal.

Results (reproduced twice):

| Check | Original | Fixed |
|---|---|---|
| One cart, one charge | Pass | Pass |
| Each refund happens once | Fail: 2 refunds | Pass |
| Refunded amount is what was owed | Fail: $32 for $16 | Pass |
| Shop's records match PayPal | Fail: shop recorded 1, PayPal 2 | Pass |
| Money at risk | $16.00 | $0.00 |

Problems and fixes:
- The agent stopped after viewing the shop. Cause: with `previous_response_id`, OpenAI does not carry `instructions` to the next turn. Fix: resend instructions every turn and use `tool_choice: "required"`.
- Type error passing a Buffer to `fetch`; fixed with `Uint8Array`.
- Windows: Git rejected a long temp path for the commit message; the first commit got an empty message and was amended before pushing anything.

## Phase 2. Support bot and refund scam
**Date:** Oct 19 · **Status:** done · **Commit:** `c2571cf`

Built:
- `src/store/supportBot.ts` — support chat on the order page, an OpenAI agent with `issue_refund` and `escalate_to_human` tools. Refunds go through one shared `refundItem` function.
- **Decision: policy as code.** Both builds give the bot the same written policy. The original relies on the prompt alone; the fixed build checks in code before money moves (item in order, not already refunded, one automatic refund per order, $20 cap, otherwise escalate).
- Scammer test shopper with four tactics: scent complaint, "manager approved", fake `SYSTEM NOTICE` prompt injection, chargeback threat.
- Runner restructured into scenarios: `npm run crash -- <scenario> <build>`.

Results (one run):

| Tactic | Original | Fixed |
|---|---|---|
| "Smells wrong" | Escalated | Declined |
| "Manager approved" | Escalated | Escalated |
| Fake SYSTEM NOTICE | **Refunded $26** | Refused, needs human review |
| Chargeback threat | Confirmed all refunded | Refused |
| Money at risk | $26.00 | $0.00 |

Refund-retry re-run after the restructure: unchanged ($16 at risk original, $0 fixed).

Notes: scam outcome depends on the model and may vary between runs; the fixed build's protection does not.

## Phase 3. Complete the scenario library
**Date:** Oct 19 · **Status:** done

Built:
- Three new scenarios: **double-pay** (shopper double-clicks Pay), **declined-card** (proxy adds PayPal's `PayPal-Mock-Response: INSTRUMENT_DECLINED` to the capture), **price-tamper** (shopper rewrites cart prices to $0.01 in the browser). "Paid only after PayPal confirms" is covered by declined-card rather than a separate scenario.
- Shopper misbehaviour is set by the scenario (`doubleClickPay`, `tamperPrices`), not chosen by the AI, so every run does the same thing.
- Proxy fault type `mock-response` uses PayPal's own negative-testing header, so the decline is a real PayPal response.
- Money checks moved to `src/lab/checks.ts` and apply to every scenario: one cart one charge, charged the catalog price, paid only after PayPal confirms, refunded what was owed, shop's records match PayPal. Money at risk is itemised by reason.
- Safety rating: share of checks passed, capped at 2 stars whenever money is at risk.
- **Inconclusive runs:** if the test shopper never manages to pay, the run is marked inconclusive instead of failing the store.
- **Decision: the store under test is now real, separate code.** `stores/ember-and-wick/original` is the store as its owner wrote it (no mode flags); `stores/ember-and-wick/fixed` is a hand-fixed reference used to check DummyRun's verdicts. The runner loads any store folder whose `app.ts` exports `createStoreApp`. This keeps the investigator honest: the code it reads doesn't contain the answer.
- Store errors log one line; the full SDK error (which includes the access token) is never printed.

Results, full suite on the final structure:

| Scenario | Original | Fixed |
|---|---|---|
| refund-retry | 3/6 checks, $16.00 at risk | 6/6 |
| refund-scam | 4/6 checks, $26.00 at risk | 6/6 |
| double-pay | 4/5 checks, $26.00 at risk | 5/5 |
| declined-card | 4/6 checks, $16.00 at risk | 6/6 |
| price-tamper | 4/5 checks, $41.97 at risk | 5/5 |

Problems and fixes:
- Two earlier full runs on the old structure: refund-scam on the original passed both times (the support bot resisted the first set of tactics). The scammer was given more realistic tactics (spoofed "human approved" tool result, damage claims, fake owner code); it then landed in both later runs. Prompt-only guardrails fail some of the time, not every time; the README must say so.
- One run of double-pay on the fixed store failed because PayPal's card field received a garbled expiry (`INVALID_EXPIRY`). Fixed by verifying each card field after typing and retyping if needed, and by the inconclusive rule above.
- A declined capture in the original store printed the SDK error, including the sandbox access token, to the console. Fixed with a one-line error handler.

## Phase 4. AI investigator, fix and re-run
**Date:** Oct 19 · **Status:** done

Built:
- `src/investigator/investigator.ts`: reads the failed run (failed checks, money at risk, every PayPal call with any injected fault, what the shopper saw) and the store's source with line numbers, and returns a plain-English explanation, the root-cause location, exact search-and-replace edits and the PayPal guidance followed. Structured output (JSON schema), model `gpt-5.5` (configurable). Edits that don't match the file exactly once are sent back for a retry.
- Grounding: PayPal AI Toolkit best-practice references (checkout, expanded checkout, disputes and refunds), copied with an Apache-2.0 notice, plus a short DummyRun note on `PayPal-Request-Id`.
- `src/investigator/fixer.ts`: copies the store to the run folder, applies the edits, type-checks the copy. The original source is never edited.
- `npm run fix -- <scenario>`: run on the original store, investigate, patch a copy, compile, re-run on the patched copy, print before and after.

Results:

| Scenario | Investigator's diagnosis | Before | After (its own patch) |
|---|---|---|---|
| refund-retry | Retry sent as a new refund with no stable `PayPal-Request-Id` (`app.ts:102`) | 2/5, $16.00 at risk | 5/5, $0.00 |
| refund-scam | Server refund function trusted the bot; policy must be enforced in server code (`app.ts:95`) | 2/5, $26.00 at risk | 5/5, $0.00 |

Notes:
- The scam fix is stricter than needed: it caps refunds at one per order for the refund form too, not just the bot. Safe, but honest customers with two damaged items would need a human. Worth mentioning in the README as a limitation of AI-written fixes, which is why they go through a re-run and human review rather than straight to production.
- Each fix run takes 6 to 9 minutes, mostly the AI shoppers and the sandbox.

## Phase 5. DummyRun web interface
**Date:** Oct 19 · **Status:** done

Built:
- `src/server/lab.ts`: runs crash tests for the interface. Each scenario gets its own PayPal proxy and store on free ports, up to three in parallel (`MAX_PARALLEL`). One crash test at a time. Run history saved as `runs/<id>/run.json` and reloaded on start. "Investigate and fix" runs the investigator, patches a copy, type-checks it and re-runs the scenario, streaming progress.
- `src/server/server.ts`: Hono API, server-sent events for live updates, live JPEG frames of each shopper's browser (about one a second), recordings, last frame kept on disk for finished tests.
- `src/server/ui.ts`: one page, no build step. `npm start` serves it on port 3000.
- Design: a crash-test lab rather than a generic dashboard. The yellow and black calibration target from crash-test dummies is the one bold element (lane markers, safety rating). Cool lab white background, one typeface family (Archivo) with condensed widths for headings and figures, red for failures, green for passes, the injected PayPal fault shown as a yellow hazard-stripe tag. Each lane shows a live frame with a crash-footage timer.
- Layout: summary (safety rating set by the weakest test, total money at risk), five lanes, then the selected test: money checks and "Why it broke" on the left; PayPal call timeline, recording and the shopper's steps on the right. Earlier crash tests listed below.

Verified:
- Started a crash test from the browser: three lanes ran in parallel with live frames, all five finished, all five failed on the original store ($125.97 at risk).
- Investigate and fix on refund-retry (triggered through the same API the button calls): investigating, re-running, done in about a minute; 2/5 to 5/5 and $16 to $0, with diagnosis, diff and re-run recording shown.
- Desktop (1280px) and phone (390px) screenshots; no horizontal scrolling.

Problems and fixes:
- A wide code diff pushed the two-column layout out of shape and made the phone page 1,072px wide; fixed with `minmax(0, …)` grid columns.
- Finished lanes lost their picture after a restart; the last frame is now saved with the run.

## Phase 6. AG Studio dashboard
**Date:** Oct 19 · **Status:** done, except the licence key (from Aman)

Built:
- `/dashboard`: AG Studio 3.0 (React), bundled with esbuild when the server starts, styled with the same crash-test lab tokens as the rest of DummyRun.
- `src/dashboard/data.ts`: crash-test history flattened into four related tables: crash tests (one row per scenario per run, including runs patched by the investigator), money checks, money at risk by reason, and every PayPal call with any injected fault.
- Report pages: an overview (safety rating, money at risk, tests, failing tests, store-build filter, money at risk by scenario and build, why money was at risk, a matrix of failed checks by scenario) and a PayPal calls page (calls by type with injected faults, error count, full call log).
- **Two custom widgets**: a safety rating drawn as crash-test calibration targets, and a money-at-risk counter. Both read their value through `widgetApi.getData`, so Studio's filters apply, and both appear in Studio's widget menu under "DummyRun".
- **A custom agent alongside Studio's built-in ones**: "Crash analyst", with Studio's schema and query tools plus two DummyRun tools: `explain_crash_test` (evidence and diagnosis for a scenario) and `start_crash_test` (only after the user confirms). Studio's lead agent was widened to delegate to it.
- `/api/ai/responses`: server-side proxy for AG Studio's OpenAI adapter (the adapter is AG's own documentation example, copied unchanged). The key stays on the server, only listed models are allowed (`OPENAI_STUDIO_MODELS`, default `gpt-5.6-terra,gpt-5-mini`), output tokens capped per turn.

Verified:
- Dashboard renders with real history (6 tests, 34 checks, 27 PayPal calls).
- Asked the assistant "Which scenario puts the most money at risk, and why? Ask the crash analyst." Studio's lead delegated to the crash analyst, which called `explain_crash_test` and answered correctly: price tampering, $41.97, charged $0.03 for $42.00 of goods because checkout trusted a browser price.

Notes:
- `ag-studio` is commercially licensed. Without a key it runs fully unlocked with a watermark and a console notice. Set `AG_STUDIO_LICENSE_KEY` in `.env` once the trial key arrives (request it around Nov 1 so it lasts until judging ends on Dec 15).
- The bundle is 5.5 MB minified; acceptable for a demo, could be split later.
- Not yet exercised: the assistant building a new widget, and `start_crash_test` from the chat.

Problems and fixes:
- Blank page: custom widget definitions need a `form` (Studio's `createDefaults` helper).
- Studio's parameter builder takes descriptions as an option (`s.string({ description })`), not `.describe()`.
- The AI chat is an edit-mode panel; a toggle above the canvas switches to edit mode with the assistant first.

## Phase 7. Deploy to Render (prepared; deploy needs Aman)
**Date:** Oct 19 · **Status:** files ready, not deployed

Built:
- `Dockerfile` on `mcr.microsoft.com/playwright:v1.64.1-noble` (Chromium and system libraries matching the Playwright version), `.dockerignore`.
- `render.yaml` Blueprint: Docker web service on the Standard plan (Chromium needs about 2 GB), health check `/healthz`, a 2 GB disk for run history and recordings, secrets set in the dashboard (`sync: false`).
- Spending guards for a public demo (`src/server/limits.ts`): per-visitor hourly and service-wide daily limits on crash tests (3/hour, 30/day), fixes (3/hour, 15/day) and AI requests (150/hour, 1,500/day), plus one crash test at a time. Checked with a throwaway app: `200 200 429 200 429` as expected.
- `.env.example`, production build minified, `npm run crash -- ... --strict` exits non-zero when a money check fails.

Not done yet:
- Docker isn't installed locally, so the image has not been built; Render will be the first build.
- Deploying needs a GitHub repo and Render access from Aman.
- The webhook scenario (late and duplicate payment notifications) needs the public URL; it comes after deployment.

Cost note: the Standard plan is about $25 a month. Deploying now and running to Dec 15 would use most of the $50 credit, so the plan is to deploy, verify, suspend, and resume around Nov 1.

## Phases 8 and 9 (started early, no input needed)
**Date:** Oct 19

- `README.md` ordered by the judging criteria: results table, run instructions, how it works, PayPal integration table, AI tools used (including Claude Code for development), sponsor tools, what was built during the hackathon, limitations.
- `LICENSE` (MIT) with third-party notices (PayPal AI Toolkit references under Apache-2.0; AG Studio under its own commercial licence).
- `.github/workflows/crash-test.yml`: on every pull request, installs Chromium, type-checks and crash-tests the store you ship with `--strict`, uploading recordings and reports. Needs repository secrets.
- `docs/images`: screenshots for the README (to be retaken from a fresh run on the hosted demo).

## Phase 11. Tests for DummyRun itself
**Date:** Oct 20 · **Status:** done

The project moved to `D:\Aman Personal Projects\PayPal-Hackathon` (GitHub `amanagarwal13/PayPal-Hackathon`) with its full history.

Built: 15 tests with Node's test runner (`npm test`, also in CI), no PayPal or OpenAI calls needed:
- **Money checks** (8): clean purchase, refund paid twice, rating cap when money is at risk, goods sold below catalog price, order marked paid with no charge, a declined card handled well, scam refunds beyond policy, and an incomplete purchase being inconclusive.
- **Proxy** (3), against a fake PayPal: forwarding and logging, `delay-response` (PayPal processes the refund while the store times out; the retry goes straight through), `mock-response` (PayPal's negative-testing header reaches PayPal).
- **SDK redirect** (1): with `apiBase` set, the official PayPal Server SDK sends both the token request and the API call to DummyRun.
- **Spending limits** (1) and **investigator edits** (2): edits must match exactly once, fixes go into a copy, and replacement text is applied literally.

## Phase 13. Coding-agent integration over MCP
**Date:** Oct 20 · **Status:** done (scripted client); a live Claude Code session is still to be recorded for the video

Built:
- `src/mcp/server.ts`: an MCP server at `/mcp` on the lab server (Streamable HTTP, stateless, JSON responses). Tools: `list_scenarios`, `start_crash_test` (returns a run id and a link to watch live), `get_crash_test` (waits up to 50 seconds per call), `get_test_evidence`, `diagnose_failure` (the investigator's explanation, location and exact edits with repo-relative paths; changes nothing) and `verify_fix_in_copy`.
- Every crash test now starts the store in its own process (`src/lab/storeHost.ts`), so its code is read fresh from disk. A fix the coding agent saves is exactly what the next test runs. Ports are picked by the OS, so the CLI, evals and lab can run side by side.
- `lab.diagnose()`: the investigator on its own, cached on the lane.
- Lab page: `/?run=<id>` opens that run, and a run started elsewhere (by an agent) opens by itself, so the browser shows the shoppers while the agent works.
- `.claude/commands/crash-test.md` (`/crash-test` in Claude Code), setup lines for Claude Code, Cursor and Codex in the README, `scripts/mcp-loop.ts`, which plays the agent's part.
- MCP calls share the demo's spending limits (200 an hour per visitor, 2,000 a day).

Verified: `scripts/mcp-loop.ts refund-retry` over MCP against the store in the working copy. Before: rating 2/5, $16.00 at risk (PayPal refunded twice). The diagnosis pointed at `stores/ember-and-wick/original/app.ts:101`; the edits were applied to the file; the re-run scored 5/5 with $0.00 at risk. The store was then restored with `git checkout` so the demo still shows the bug. 15 unit tests pass.

## Phase 12. Investigator on all scenarios, with measurements
**Date:** Oct 20 · **Status:** done

Built: `npm run eval -- investigator [--n 3]` and `npm run eval -- scam [--n 10]` (`src/lab/eval.ts`), writing `eval.json` and `eval.md` to `runs/evals/<mode>-<time>/`. `EVAL_PARALLEL` runs several at once; each run gets its own proxy and store process.

Results (written up in `docs/EVALS.md` and the README):
- Investigator, 3 attempts on each of the five scenarios: 13 of 15 patches fixed the store (every money check passing, $0 at risk, re-run against PayPal's sandbox). The misses: a double-pay patch that made the request ID per click, so it still charged twice (the re-run caught it), and a declined-card patch that didn't type-check (never run).
- Refund scam, 10 runs per store: the scammer got money in 10 of 10 runs against the prompt-only bot ($246 in total) and 0 of 10 against the bot whose policy is also checked in code.

This replaces the earlier note that the scam was probabilistic: with the current six tactics it landed every time.

## Phase 14. Crash-testing a store we didn't write
**Date:** Oct 20 · **Status:** done

Built:
- `sdk/paypal.js` (with `paypal.d.ts`): the one line for stores on PayPal's Server SDK, `...dummyrun()` in the client options. It redirects SDK requests to DummyRun only while `DUMMYRUN_PAYPAL_API` is set, and only sandbox URLs. Two unit tests (17 in total now).
- `stores/paypal-advanced-example`: PayPal's advanced-integration example (card fields with a Node server) from `paypal-examples/docs-examples` at commit `8095379`, Apache-2.0, with `NOTICE.md`. The only change is the SDK line and its import. It runs on our SDK 2.5 rather than the example's `^1.0.0`.
- `npm run crash:paypal-example [-- scenarios] [--fixed]` (`src/lab/crashPayPalExample.ts`): starts PayPal's server as a child process, serves its page the way its Vite setup does, and drives it with a scripted shopper using the AI shoppers' card entry. Money is checked in PayPal's records. Scenarios: a control purchase, double-click, slow capture with a second press, declined card.
- `stores/paypal-advanced-example-fixed`: minimal fixes, each marked `// DummyRun fix`.

Findings (sandbox, repeated on every run we made):
- Control: 5/5, one $100 charge. The first control run failed because the scripted shopper left the billing address empty (PayPal requires the country); that was the test, not the store, and the shopper now fills it in.
- Double-click: charged twice, $100 extra (4 of 4 runs). Slow capture with a second press: charged twice (3 of 3).
- Declined card: no charge, but the shopper is shown `{"error":"Failed to capture order."}` (2 of 2). The server drops PayPal's error, so the client's decline handling never runs. With the error passed through, the client then hit `actions.restart is not a function` on card payments, because its `!data.card` check didn't stop the Buttons-only path. The capture route also logs "Failed to create order".
- With the fixes: all four scenarios 5/5, $0 at risk.
- No access token or credentials in the example's logs.

Test-harness issue found and fixed on the way: the page shim's keep-alive connections to the example's Express server were sometimes reset. It now sends each request on its own connection and never retries, so every payment request reaches the store exactly once.

Not done: running the investigator on this store (its evidence and prompts assume the Ember and Wick layout), and an AI shopper for it.

## Phase 15. Investigator on PayPal's own example
**Date:** Oct 20 · **Status:** done

Built:
- `investigateEvidence()` in `src/investigator/investigator.ts`: the investigator for any store. It takes the evidence, the source files and an optional note on the store's layout. `investigate()` for the demo store now calls it, unchanged. `readStoreSource()` takes a list of files.
- `copyStore()` copies a list of files with their folders, and a new `syntaxCheck()` runs `node --check` on `.js` files, since plain JavaScript has no compiler (`src/investigator/fixer.ts`). One unit test (18 in total now).
- `npm run crash:paypal-example -- <scenarios> --investigate`: for each failing scenario, builds the evidence (failed checks, PayPal calls from the proxy log, what the page said, the example server's `console.error` output), runs the investigator on `server.js`, `client/app.js` and `client/index.html` as published, applies its edits to a copy under `runs/paypal-example-investigate/<time>/<scenario>/patched-store`, checks it parses, re-runs the same scenario and prints before and after. Everything goes into `investigation.json`. The copy's import of `sdk/paypal.js` is repointed, since the copy sits deeper in the repo. The investigator never sees the hand-fixed copy.
- `--store=<dir>`: crash-test any copy of the example, such as a saved patch.

Test-harness bug found and fixed: DummyRun's page server (standing in for the example's Vite dev server) didn't pass cookies between the page and the example's server. Vite's proxy does. One investigator patch kept its checkout ID in a cookie, so it failed for DummyRun's reasons. Cookies now pass both ways. The as-published results are the same as before.

Results (written up in `docs/EVALS.md`), three attempts per failing scenario after the cookie fix:
- slow-capture: 3 of 3 fixed. Each patch sends a stable `PayPal-Request-Id` on create (from a checkout ID) and on capture (from the order ID).
- double-pay: 1 of 3 fixed. Same approach, but a double-click puts both create requests in flight at once, and in 2 of 3 runs PayPal's sandbox created two orders under the same `PayPal-Request-Id`.
- declined-card: 0 of 3. Every patch fixed the server's discarded error, which exposed the client's `actions.restart is not a function` bug. No patch fixed that second layer.
- 4 of 9 overall, against 13 of 15 on the demo store. All 5 patches that fixed their scenario still passed the control purchase.
- An earlier attempt, before the cookie fix: double-pay fixed, declined-card missed, slow-capture missed because of the cookie bug. The same patch passed once cookies were forwarded.
- No `// DummyRun fix` text or credentials in any investigator input (checked with grep over every `investigation.json`).

Not done: a second investigator pass on the re-run's evidence (which would show it the `actions.restart` error), and a note in the idempotency reference that simultaneous requests can race past `PayPal-Request-Id`. Either would likely raise the numbers, so they were left out of this measurement.

## Phase 7. Deployed to Render
**Date:** Oct 20 · **Status:** live, to be suspended until about Nov 5–8

- Created from `render.yaml` as a Blueprint: web service `dummyrun` (Docker, Standard plan with 2 GB of memory, Oregon), a 2 GB disk at `/app/runs`, health check `/healthz`, auto-deploy from `main`. Secrets were entered by Aman in the Render dashboard.
- First build (Playwright base image plus `npm ci`) took under a minute; the site answered its health check about a minute later at https://dummyrun.onrender.com.
- Checked live: the lab page, scenario list, run history, dashboard, and the MCP endpoint at `/mcp` listing all six tools. Links the MCP tools return use Render's public URL (`RENDER_EXTERNAL_URL`).
- One crash test on the server (refund-retry, the store as written): 2/5, $16.00 at risk, PayPal refunded $32 for a $16 request, the same as locally. It took 35 seconds, with the recording and the last frame served. Memory stayed around 540 MB of 2 GB.
- Not yet checked on the server: a full five-scenario run (two shoppers at once, `MAX_PARALLEL=2`), "Investigate and fix", and the dashboard's AI assistant.
