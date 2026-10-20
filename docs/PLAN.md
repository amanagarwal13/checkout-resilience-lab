# DummyRun build plan

AI crash-test dummies for PayPal checkouts. AI test shoppers run through a
store's real checkout, DummyRun injects realistic PayPal failures, checks the
money in PayPal's own records, explains what broke, writes the fix and proves
it with a re-run.

Hackathon: PayPal AI Hackathon on Devpost.

| Milestone | Date |
|---|---|
| Today | Sun Oct 19, 2026 |
| Complete draft submitted (Devpost early eligibility check) | Wed Nov 5 |
| Final submission | Tue Nov 11 (deadline Thu Nov 12, 12:00 PT = Fri Nov 13, 01:30 IST) |
| Judging (demo must stay live) | Dec 1 to Dec 15 |

Prize targets: a Grand Prize, plus Best Use of AG Grid (AG Studio) as the one
sponsor prize. Fallback honorable mentions: Best Use of PayPal + AI, Best Demo
Delivery.

Progress is recorded phase by phase in [IMPLEMENTATION_LOG.md](IMPLEMENTATION_LOG.md).

## Architecture

```
            ┌──────────────────────── DummyRun ────────────────────────┐
 AI test    │  Scenario runner ──► AI test shoppers (Playwright + LLM)  │
 shoppers ──┼──────────────────────────────┐                           │
            │                              ▼                           │
            │                    Store under test (e.g. Ember and Wick)│
            │                              │ PayPal Server SDK         │
            │                              ▼                           │
            │  PayPal proxy (fault injection, call log) ──► PayPal sandbox
            │  Webhook relay (late / duplicate events)  ◄── PayPal sandbox
            │                                                          │
            │  Money checks ◄── reads PayPal directly (never via store) │
            │  AI investigator ──► root cause, fix, re-run             │
            │  Web UI + AG Studio dashboard                            │
            └──────────────────────────────────────────────────────────┘
```

Stack: TypeScript on Node 24, Hono, PayPal Server SDK and JS SDK (card fields
and button), Playwright, OpenAI (`gpt-5-mini` by default), React + AG Studio
for the dashboard, Docker on Render (Playwright base image), Render Postgres
for run history.

Principles that judges care about, applied throughout:
- Money truth comes from PayPal, never from the store's own claims.
- Rules that protect money live in code, not only in prompts.
- Every claim in the README is checkable in the code and in a recorded run.
- Unhappy paths are first-class: timeouts, declines, retries, injection.
- Secrets stay server-side and out of Git; prices always come from the server.

## Phases

Each phase ends with: type check passing, the affected scenarios re-run, the
implementation log updated, and one commit.

### Phase 0. Project setup — done
Repo, branch, dependencies, `.env` and `.gitignore`, US sandbox app with card
processing verified.

### Phase 1. Refund-retry crash test — done
Demo store, PayPal proxy, first AI test shopper, money checks. Original build
refunds twice after an agent retry; fixed build refunds once.

### Phase 2. Support bot and refund scam — done
Store AI support bot with a refund tool; scammer test shopper; policy enforced
in code in the fixed build.

### Phase 3. Complete the scenario library (Oct 20 to 22)
Goal: five scenarios that each fail on the original build and pass on the fixed one.
- **Double-click pay**: impatient shopper submits payment twice. Check: one cart, one charge; no orphan PayPal orders marked paid.
- **Declined card**: proxy adds PayPal's `PayPal-Mock-Response` header (`INSTRUMENT_DECLINED`) to the capture. Check: order is not marked paid, shopper sees a clear retry message, retry with another card works.
- **Price tampering**: shopper edits the cart request in the browser. Check: PayPal amount equals server catalog total.
- **Paid only after PayPal confirms**: capture answer held back; check the store doesn't ship or mark paid on a guess.
- Shared persona and fault definitions moved out of `crash.ts` into `src/lab/scenarios/`.
- Done when: `npm run crash` runs all scenarios on both builds with the expected pass/fail pattern twice in a row.

### Phase 4. AI investigator, fix and re-run (Oct 22 to 25)
- Investigator agent reads a failed run's report (checks, proxy log, shopper steps) and the store source, and returns: plain-English explanation, the exact file and line, and a code fix.
- Grounded in PayPal guidance: the PayPal AI Toolkit best-practices references are loaded as context; the fix uses the official Server SDK (APIMatic Context Plugin used while building).
- "Apply fix and re-run": the patch is applied to a copy of the store under `runs/<id>/patched/`, the store is restarted from that copy, and the same scenario re-runs. Before/after safety rating.
- Guardrails: patch must type-check before re-run; the investigator never edits the original source.
- Done when: for refund-retry and refund-scam, the investigator's own patch turns the failing run green.

### Phase 5. DummyRun web interface (Oct 24 to 30)
- Run screen as in the mockup: shopper tiles with live screenshots and recorded replays, live PayPal call stream (server-sent events), money checks, money at risk, safety rating, "why it broke" panel with "Apply fix and re-run".
- Run history list and run detail page.
- Store connection screen (the two settings: API base and webhook URL).
- Done when: a full run can be started, watched and fixed from the browser with no terminal.

### Phase 6. AG Studio dashboard (Oct 29 to Nov 2)
- Embedded AG Studio dashboard over run history and PayPal data: money at risk over time, failures by PayPal error code, scenario heatmap, before/after ratings.
- At least two custom widgets (safety rating, money-at-risk counter) and a custom Studio agent with tools (explain a failure, re-run a scenario, with confirmation).
- Avoid raw data-dump grids; charts and widgets first.
- Needs: AG Studio trial key requested around Nov 1 so it lasts through Dec 15.

Phases 3 to 6 were completed on Oct 19; Phase 7's files are ready. See the log.

### Added Oct 20: credibility and "wow" phases (before deployment)

### Phase 11. Tests for DummyRun itself (Oct 20)
- Unit tests with Node's test runner for the money checks, the proxy's fault injection, the spending limits, the SDK host redirect and how investigator edits are validated and applied.
- `npm test`, also run in CI.
- Done when: the tests pass locally and cover every money check and both fault types.

### Phase 12. Investigator on all scenarios, with measurements (Oct 21 to 22)
- Run the investigator on double-pay, declined-card and price-tamper as well.
- `npm run eval`: repeated runs that measure (a) how often the investigator's patch turns a failing scenario green, and (b) how often the refund scam beats a prompt-only support bot versus the code guardrail.
- Results recorded in `docs/EVALS.md` and the README.

### Phase 13. Coding-agent integration over MCP (Oct 23 to 27)
- `npx dummyrun mcp`: an MCP server that crash-tests the store in the developer's own folder, so a fix their coding agent applies is exactly what gets re-tested.
- Tools: list scenarios, run a crash test (returns a link to watch live), get a test's evidence, get the investigator's fix as edits.
- A hosted MCP endpoint on the deployed demo for judges, and setup lines for Claude Code, Cursor and Codex, plus a Claude Code command next to PayPal's AI Toolkit.
- Done when: in a coding agent, "crash-test my checkout", "fix it", "run it again" goes from red to green on the real sandbox.

### Phase 14. Crash-test a store we didn't write (Oct 28 to 30)
- A one-line helper that points any PayPal Server SDK client at DummyRun.
- Run DummyRun against PayPal's own example app (`paypaldev/example-node-express`) through a small adapter, and record the findings honestly.

### Phase 7. Deploy to Render (Oct 31 to Nov 3)
- Dockerfile on the Playwright image, `render.yaml` Blueprint, paid web service (no sleeping), Render Postgres for run history.
- Public HTTPS URL enables the webhook relay: late and duplicate `PAYMENT.CAPTURE.COMPLETED` scenario with signature verification.
- Protect the hosted demo: rate limits on AI routes, one run at a time, recorded replays as fallback if the sandbox is slow.
- Done when: a judge can open the URL and run a crash test without keys.

### Phase 8. Real-world proof (Nov 2 to 6)
- Run DummyRun against PayPal's own example apps (`paypaldev/example-node-express`, `example-node-hono`) with the one-line SDK setting; record findings honestly.
- GitHub Action that runs a crash test on every pull request.
- Ask one or two real developers or merchants to try it; quote them.

### Phase 9. Submission package (Nov 3 to 5)
- Public GitHub repo with MIT licence visible in the About section.
- README ordered by the judging criteria: what it is, how to run in minutes, PayPal integration table (API, file, purpose), architecture diagram, AI tools used (OpenAI models, PayPal AI Toolkit, APIMatic Context Plugin, Claude Code), what was built during the hackathon, known limitations.
- Devpost description and testing instructions; complete draft submitted by Nov 5.

### Phase 10. Video and final polish (Nov 6 to 11)
- Under-3-minute video in Aman's own voice: hook ("PayPal asked what happens when you put AI behind the wheel. We built the crash test."), the crash, the fix, the re-run, the dashboard, real-world proof.
- Final submission Nov 11, a day before the deadline.

## Needs from Aman

| When | What |
|---|---|
| Before Phase 7 | Render account with the $50 hackathon credit (done) |
| Phase 6, around Nov 1 | AG Studio trial key, or a hackathon key valid to Dec 15 from AG Grid's Discord |
| Phase 9 | Create the public GitHub repo |
| Phase 8 | One or two real developers or merchants to try it |
| Phase 10 | Record the voiceover; upload to YouTube; submit on Devpost |
| Anytime | Replace the OpenAI key that was pasted in chat; set a spending limit |
| Before building | Check the employment contract's IP clause (rules require sole ownership) |

## Risks

| Risk | Mitigation |
|---|---|
| PayPal sandbox slow or flaky on judging day | Recorded replays of real runs; retries in the runner |
| LLM behaviour varies (scam may not always land) | Multiple runs; README states results vary; fixed build is safe regardless |
| Trial licences expire before Dec 15 | Start AG Studio trial around Nov 1; ask sponsors for hackathon keys |
| Scope creep | Phases 3 to 7 are the minimum; Phase 8 items are cut first if late |
| Similar entries | Position against PayPal's `/paypal:doctor` and agent-readiness checkers in the README |
