# DummyRun implementation log

One entry per phase of [PLAN.md](PLAN.md): what was built, decisions, results
and problems. Newest at the bottom. Dates are 2026.

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
