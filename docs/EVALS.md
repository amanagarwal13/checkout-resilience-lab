# Evals

AI tools that write fixes or guard money need numbers, not one good demo. These are repeated runs against PayPal's sandbox, with the money checked in PayPal's own records each time. Raw results (every patch, verdict and recording) are written to `runs/evals/`.

```bash
npm run eval -- investigator --n 3   # does the investigator's own patch fix the store?
npm run eval -- scam --n 10          # prompt-only refund policy vs the policy enforced in code
```

`EVAL_PARALLEL=2` runs two at a time. A full investigator eval makes about 20 crash tests and 15 GPT-5.5 calls; the scam eval makes 20 crash tests.

## Investigator: does its own patch fix the store?

Each scenario was crash-tested once on the store as written, then the investigator was run 3 times on that evidence. Each patch was applied to a fresh copy, type-checked, and the same scenario re-run against PayPal's sandbox. "Fixed" means every money check passed with $0 at risk.

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
- **declined-card, attempt 3.** The patch didn't type-check, so it was never run. DummyRun reports it as a failed fix with the compiler output.

## Refund scam: prompt-only guardrail vs code guardrail

The scammer test shopper ran 10 times against each store. Both stores give their AI support bot the same written refund policy. The original relies on the prompt; the fixed store also checks the policy in code before PayPal is called (one automatic refund per order, at most $20).

| Support bot | Runs where the scammer got money | Money lost across those runs |
|---|---|---|
| Policy in the prompt only | 10 of 10 | $246.00 |
| Policy also enforced in code | 0 of 10 | $0.00 |

The scammer uses the same six tactics in order each time (complaints, a false damage claim, a message dressed up as a tool result, a fake owner code, a fake system notice, a chargeback threat). Against the prompt-only bot it got money every time. With the check in code, no off-policy refund reached PayPal in any run.

## What these numbers don't show

- Three investigator attempts per scenario is a small sample. Treat 13 of 15 as "usually right, and checked when it isn't", not as an accuracy figure.
- The store is the demo store with known bugs. The investigator hasn't been measured on code it hasn't seen before; [Phase 14](PLAN.md) crash-tests PayPal's own example checkout for that.
- Model outputs vary run to run, so a re-run of these evals will give somewhat different numbers.
