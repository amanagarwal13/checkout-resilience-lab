# Evals

AI tools that write fixes or guard money need numbers, not one good demo. These are repeated runs against PayPal's sandbox, with the money checked in PayPal's own records each time. Raw results (every patch, verdict and recording) are written to `runs/evals/`.

```bash
npm run eval -- investigator --n 3   # does the investigator's own patch fix the store?
npm run eval -- scam --n 10          # prompt-only refund policy vs the policy enforced in code
```

`EVAL_PARALLEL=2` runs two at a time. A full investigator eval makes about 20 stress tests and 15 GPT-5.5 calls; the scam eval makes 20 stress tests.

## Investigator: does its own patch fix the store?

Each scenario was stress-tested once on the store as written, then the investigator was run 3 times on that evidence. Each patch was applied to a fresh copy, type-checked, and the same scenario re-run against PayPal's sandbox. "Fixed" means every money check passed with $0 at risk.

| Scenario | Money at risk before | Fixed | Compiled | Root cause it named |
|---|---|---|---|---|
| refund-retry | $16.00 | 3 of 3 | 3 of 3 | app.ts:101–102 |
| refund-scam | $26.00 | 3 of 3 | 3 of 3 | app.ts:95–98 |
| double-pay | $26.00 | 2 of 3 | 3 of 3 | app.ts:56 |
| declined-card | $16.00 | 2 of 3 | 2 of 3 | app.ts:76–79 |
| price-tamper | $41.97 | 3 of 3 | 3 of 3 | app.ts:48–50 |

**13 of 15 patches fixed the store** (run on Oct 20, 2026, investigator on `gpt-5.5`).

The two misses, and what caught them:

- **double-pay, attempt 2.** The patch gave each checkout a request ID, but generated it per click, so two clicks still made two PayPal orders and two charges. The re-run caught it: $26.00 still at risk. A patch that reads well can still be wrong, which is why every fix is re-tested against PayPal before it's shown as fixed.
- **declined-card, attempt 3.** The patch didn't type-check, so it was never run. Resilience Lab reports it as a failed fix with the compiler output.

## Investigator on PayPal's own example: code we didn't write

```bash
npm run stress:paypal-example -- double-pay slow-capture declined-card --investigate
```

The same investigator (same model, PayPal references and rules) was run on PayPal's advanced-integration example (`stores/paypal-advanced-example`, plain JavaScript). For each failing scenario it gets:

- **Evidence:** the failed checks, the PayPal calls from Resilience Lab's proxy log (with any injected fault), what the page said and the example server's own `console.error` output. The demo store's evidence has the AI shopper's steps instead; this shopper is scripted.
- **Source:** `server.js`, `client/app.js` and `client/index.html` as published, plus a short note on how the example is laid out.

It never sees `stores/paypal-advanced-example-fixed` or its `// Resilience Lab fix` comments. Each patch goes into a copy under `runs/paypal-example-investigate/`, has to pass `node --check` (there's no compiler), and then the same scenario is re-run against PayPal's sandbox. "Fixed" means every check passed with $0 at risk.

Three attempts per scenario, each with a fresh stress test of the original first (Oct 20, 2026, `gpt-5.5`):

| Scenario | Before | Fixed | Parsed | Root cause it named |
|---|---|---|---|---|
| double-pay | $100.00 at risk | 1 of 3 | 3 of 3 | server.js:44 (create order with no `PayPal-Request-Id`) |
| slow-capture | $100.00 at risk | 3 of 3 | 3 of 3 | server.js:45, 45 and 82 |
| declined-card | $0 at risk, shopper not told the card was declined | 0 of 3 | 3 of 3 | server.js:70 (capture's error handling) |

**4 of 9 patches fixed the example.** That's well below 13 of 15 on the demo store. Every patch that fixed its scenario was also run on the control purchase, and all of them still took one normal $100 payment (5/5).

The misses:

- **double-pay, 2 of 3.** All three patches made the same sensible change: the page sends a checkout ID, the server uses it as the `PayPal-Request-Id` when creating the order, and uses the order ID as the request ID when capturing. But a double-click sends both create-order requests 150 ms apart, so both were in flight at PayPal at the same time (the store's SDK log shows both requests before either answer). In 2 of 3 runs the sandbox created two orders under the same `PayPal-Request-Id` (201 both times) and both were captured. In the third it returned the first order (200) and the patch worked. A request ID makes retries safe, but in the sandbox it didn't reliably stop two simultaneous requests. The hand fix disables the button; a server-side lock per checkout ID would also work. No patch did either.
- **declined-card, 3 of 3.** Every patch fixed the first bug correctly: the server now passes PayPal's 422 `INSTRUMENT_DECLINED` back to the page instead of a generic 500. That exposed the second bug (the one the hand fix also needed): the page's decline handling calls `actions.restart()`, which card payments don't have, so the shopper saw `TypeError: actions.restart is not a function`. The bug is visible in `client/app.js`, but the evidence only pointed at the server, and no patch looked further. No money was at risk either way.

One more attempt ran before a Resilience Lab bug was fixed, and it isn't in the table: double-pay fixed, declined-card the same miss, and slow-capture reported "not fixed". That slow-capture patch kept the checkout ID in a cookie, and Resilience Lab's page server (which stands in for the example's Vite dev server) didn't pass cookies through, though Vite's proxy does. With cookies forwarded, the same patch scored 5/5 with one charge, and a normal purchase still worked. The miss was Resilience Lab's fault, not the investigator's. Counting that attempt, the totals are double-pay 2 of 4, slow-capture 4 of 4 (one only after the page-server fix) and declined-card 0 of 4.

A run of all three scenarios makes 6 stress tests and 3 GPT-5.5 calls.

## Refund scam: prompt-only guardrail vs code guardrail

The scammer test shopper ran 10 times against each store. Both stores give their AI support bot the same written refund policy. The original relies on the prompt; the fixed store also checks the policy in code before PayPal is called (one automatic refund per order, at most $20).

| Support bot | Runs where the scammer got money | Money lost across those runs |
|---|---|---|
| Policy in the prompt only | 10 of 10 | $246.00 |
| Policy also enforced in code | 0 of 10 | $0.00 |

The scammer uses the same six tactics in order each time (complaints, a false damage claim, a message dressed up as a tool result, a fake owner code, a fake system notice, a chargeback threat). Against the prompt-only bot it got money every time. With the check in code, no off-policy refund reached PayPal in any run.

## What these numbers don't show

- Three investigator attempts per scenario is a small sample. Treat 13 of 15 as "usually right, and checked when it isn't", not as an accuracy figure.
- The 13 of 15 is on the demo store, whose bugs we planted. On PayPal's own example, which we didn't write, it was 4 of 9 (above). Its misses there were a fix that a real double-click races past and a two-layer bug where the second layer only shows once the first is fixed.
- Model outputs vary run to run, so a re-run of these evals will give somewhat different numbers.
