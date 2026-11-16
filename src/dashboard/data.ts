import type { LabRun } from "../server/lab.js";
import type { RunResult } from "../lab/runScenario.js";

// Run history flattened into tables for the AG Studio dashboard.
// Amounts are in dollars so Studio's currency format reads naturally.

const STORE_NAMES = { original: "As written", fixed: "Hand-fixed reference", patched: "Patched by Resilience Lab" } as const;
const TITLES: Record<string, string> = {
  "refund-retry": "Refund retry",
  "refund-scam": "Refund scam",
  "double-pay": "Double-click pay",
  "declined-card": "Declined card",
  "price-tamper": "Price tampering",
};

export interface DashboardData {
  asOf: string;
  tests: {
    id: string; runId: string; runDate: string; store: string; scenario: string;
    rating: number; atRisk: number; checksPassed: number; checksTotal: number; failing: number; outcome: string;
  }[];
  checks: { id: string; testId: string; check: string; passed: boolean; failed: number; detail: string }[];
  risks: { id: string; testId: string; reason: string; amount: number }[];
  calls: { id: string; testId: string; call: string; status: number; isError: number; fault: string; requestId: string }[];
}

function callName(method: string, path: string) {
  if (path.includes("/oauth2/token")) return "Access token";
  if (method === "POST" && /\/v2\/checkout\/orders$/.test(path)) return "Create order";
  if (/\/capture$/.test(path)) return "Capture payment";
  if (/\/refund$/.test(path)) return "Refund";
  if (method === "GET") return "Look up order";
  return `${method} ${path}`;
}

export function buildDashboardData(runs: LabRun[]): DashboardData {
  const data: DashboardData = { asOf: new Date().toISOString(), tests: [], checks: [], risks: [], calls: [] };

  const addTest = (run: LabRun, store: keyof typeof STORE_NAMES, result: RunResult) => {
    const v = result.verdict;
    if (v.inconclusive) return;
    const testId = `${run.id}/${result.scenario}/${store}`;
    const passed = v.checks.filter((c) => c.passed).length;
    data.tests.push({
      id: testId,
      runId: run.id,
      runDate: run.startedAt,
      store: STORE_NAMES[store],
      scenario: TITLES[result.scenario] ?? result.scenario,
      rating: v.rating,
      atRisk: v.atRiskCents / 100,
      checksPassed: passed,
      checksTotal: v.checks.length,
      failing: passed === v.checks.length ? 0 : 1,
      outcome: passed === v.checks.length ? "Pass" : "Fail",
    });
    v.checks.forEach((c, i) =>
      data.checks.push({ id: `${testId}/c${i}`, testId, check: c.name, passed: c.passed, failed: c.passed ? 0 : 1, detail: c.detail }),
    );
    v.atRisk.forEach((r, i) => data.risks.push({ id: `${testId}/r${i}`, testId, reason: r.reason, amount: r.cents / 100 }));
    result.proxyLog.forEach((e, i) =>
      data.calls.push({
        id: `${testId}/p${i}`,
        testId,
        call: callName(e.method, e.path),
        status: e.status,
        isError: e.status >= 400 ? 1 : 0,
        fault: e.fault ? e.fault.split(":")[0] : "None",
        requestId: e.requestId ?? "",
      }),
    );
  };

  for (const run of runs) {
    for (const lane of run.lanes) {
      if (lane.result) addTest(run, run.store, lane.result);
      if (lane.fix?.after) addTest(run, "patched", lane.fix.after);
    }
  }
  return data;
}
