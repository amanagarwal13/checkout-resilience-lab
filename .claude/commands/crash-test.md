---
description: Crash-test the PayPal checkout with DummyRun, fix what fails, and verify the fix
argument-hint: "[scenario ids, or blank for all]"
---

Crash-test this store's PayPal checkout with the `dummyrun` MCP server and fix what it finds.

1. Call `start_crash_test` (scenarios: $ARGUMENTS, or all if blank). Share the `watch_url` so I can watch the shoppers.
2. Call `get_crash_test` with `wait_seconds: 50` until the status is `finished`. Report each test's safety rating and money at risk in a short table.
3. For each test with failed checks, call `diagnose_failure`. Explain the failure in a sentence or two, in terms of money, and show where in the code it is.
4. Apply the proposed edits to the named files. Read each file first; if an edit's `find` text no longer matches, make the equivalent change by hand. Keep each change small and in the file's own style.
5. Run `start_crash_test` again with only the scenarios that failed, and wait for the results.
6. Finish with a before-and-after table (rating and money at risk). Say plainly if anything is still failing or inconclusive. Don't commit.
