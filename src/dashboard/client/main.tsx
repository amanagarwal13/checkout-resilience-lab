// Resilience Lab's money-at-risk dashboard, built on AG Studio.
// Data comes from Resilience Lab's stress-test history (/api/dashboard/data). Two custom
// widgets (resilience score, money at risk) and a custom "resilience analyst" agent sit
// alongside Studio's own widgets and agents.

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AgStudioAiModule,
  createAiHarness,
  directLlmRunner,
  studioTheme,
  type AgDataSourcesDefinition,
  type AgReportState,
  type AgStudioApi,
  type AgWidgetParams,
} from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { openaiAdapter } from "./openai-adapter.js";
import type { DashboardData } from "../data.js";

declare global {
  interface Window { RESILIENCE_LAB: { licenseKey?: string; aiModels: string[] } }
}

// ---------- Data -------------------------------------------------------------

function buildData(data: DashboardData): AgDataSourcesDefinition {
  const dates = data.tests.map((t) => t.runDate.slice(0, 10)).sort();
  const today = data.asOf.slice(0, 10);
  const manyToOne = (id: string, table: string) => ({
    id,
    source: { tableId: table, fieldId: "testId" },
    target: { tableId: "tests", fieldId: "id" },
    type: "many-to-one" as const,
  });
  return {
    description:
      "Resilience Lab stress tests of a PayPal store. Each test is one AI test shopper scenario run against one build of the store. " +
      "Money at risk is money a buggy store would lose or overcharge, measured from PayPal's own records. " +
      "Store builds: 'As written' (the owner's code), 'Hand-fixed reference', 'Patched by Resilience Lab' (after the AI investigator's fix).",
    sources: [
      {
        id: "tests",
        name: "Stress tests",
        description: "One row per scenario per run. Rating is a resilience score from 1 to 5; money at risk is in USD.",
        data: data.tests,
        fields: [
          { id: "id", name: "Test ID", format: "textFormat", hide: true },
          { id: "runId", name: "Run", format: "textFormat" },
          { id: "runDate", name: "Run date", format: "dateTimeFormat" },
          { id: "store", name: "Store build", format: "textFormat" },
          { id: "scenario", name: "Scenario", format: "textFormat" },
          { id: "rating", name: "Resilience score", format: "integerFormat" },
          { id: "atRisk", name: "Money at risk", format: "currencyFormat" },
          { id: "checksPassed", name: "Checks passed", format: "integerFormat" },
          { id: "checksTotal", name: "Checks", format: "integerFormat" },
          { id: "failing", name: "Failing tests", format: "integerFormat" },
          { id: "outcome", name: "Outcome", format: "textFormat" },
        ],
      },
      {
        id: "checks",
        name: "Money checks",
        description: "One row per money check per test. Failed is 1 when the check failed.",
        data: data.checks,
        fields: [
          { id: "id", name: "Check row", format: "textFormat", hide: true },
          { id: "testId", name: "Test ID", format: "textFormat", hide: true },
          { id: "check", name: "Check", format: "textFormat" },
          { id: "passed", name: "Passed", format: "booleanFormat" },
          { id: "failed", name: "Failed", format: "integerFormat" },
          { id: "detail", name: "Check detail", format: "textFormat" },
        ],
      },
      {
        id: "risks",
        name: "Money at risk",
        description: "Money at risk itemised by reason, in USD.",
        data: data.risks,
        fields: [
          { id: "id", name: "Risk row", format: "textFormat", hide: true },
          { id: "testId", name: "Test ID", format: "textFormat", hide: true },
          { id: "reason", name: "Reason", format: "textFormat" },
          { id: "amount", name: "Amount at risk", format: "currencyFormat" },
        ],
      },
      {
        id: "calls",
        name: "PayPal calls",
        description: "Every PayPal API call the store made during a test, with any failure Resilience Lab injected.",
        data: data.calls,
        fields: [
          { id: "id", name: "Call row", format: "textFormat", hide: true },
          { id: "testId", name: "Test ID", format: "textFormat", hide: true },
          { id: "call", name: "PayPal call", format: "textFormat" },
          { id: "status", name: "HTTP status", format: "integerFormat" },
          { id: "isError", name: "Errors", format: "integerFormat" },
          { id: "fault", name: "Injected fault", format: "textFormat" },
          { id: "requestId", name: "PayPal-Request-Id", format: "textFormat" },
        ],
      },
    ],
    relationships: [
      manyToOne("check-test", "checks"),
      manyToOne("risk-test", "risks"),
      manyToOne("call-test", "calls"),
      { id: "tests-calendar", source: { tableId: "tests", fieldId: "runDate" }, target: { calendarId: "calendar" }, truncate: "day" },
    ],
    calendars: [
      {
        id: "calendar",
        label: "Calendar",
        range: { from: { type: "date", value: dates[0] ?? today }, to: { type: "date", value: dates.at(-1) ?? today } },
        fragments: ["year", "month", "week", "day"],
      },
    ],
  } as AgDataSourcesDefinition;
}

// ---------- Custom widgets ---------------------------------------------------

// Reads the first value of the widget's mapped field, with Studio's filters applied.
function useMappedValue(params: AgWidgetParams<any>) {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fields = ((params.dataMapping as any)?.value ?? []) as any[];
    if (!fields.length) {
      params.widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    params.widgetApi.setDisplayState("loading", { prominent: false } as any);
    params.widgetApi
      .getData({ fields } as any)
      .then((response) => {
        if (cancelled) return;
        const row = response.results.rows[0];
        const v = row ? Number(Object.values(row)[0]) : NaN;
        if (!row || Number.isNaN(v)) return params.widgetApi.setDisplayState("noData");
        setValue(v);
        params.widgetApi.setDisplayState("displayed");
      })
      .catch(() => !cancelled && params.widgetApi.setDisplayState("noData"));
    return () => { cancelled = true; };
  }, [params]);
  return value;
}

const target = (filled: boolean, size: number) => (
  <span
    style={{
      width: size, height: size, borderRadius: "50%", display: "inline-block", flex: "none",
      background: filled ? "conic-gradient(#15191C 0 25%, #F2C400 0 50%, #15191C 0 75%, #F2C400 0)" : "transparent",
      boxShadow: `0 0 0 2px ${filled ? "#15191C" : "#CDD5D8"} inset`,
    }}
  />
);

function ResilienceScoreWidget(params: AgWidgetParams<any>) {
  const value = useMappedValue(params);
  const rating = Math.max(0, Math.min(5, Math.round(value ?? 0)));
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, padding: "4px 6px" }}>
      <div style={{ display: "flex", gap: 8 }} aria-label={`Resilience score ${rating} of 5`}>
        {[1, 2, 3, 4, 5].map((i) => <span key={i}>{target(i <= rating, 30)}</span>)}
      </div>
      <div style={{ color: "#5A6872", fontSize: 13 }}>Resilience score {rating} of 5, set by the weakest test shown</div>
    </div>
  );
}

function MoneyAtRiskWidget(params: AgWidgetParams<any>) {
  const value = useMappedValue(params);
  const amount = value ?? 0;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "4px 6px" }}>
      <div style={{ fontStretch: "62%", fontWeight: 800, fontSize: 46, lineHeight: 0.95, color: amount > 0 ? "#C8372D" : "#1F7A4D" }}>
        ${amount.toFixed(2)}
      </div>
      <div style={{ color: "#5A6872", fontSize: 13, marginTop: 6 }}>
        {amount > 0 ? "money at risk in the tests shown" : "no money at risk in the tests shown"}
      </div>
    </div>
  );
}

const icon = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="${fill}" stroke-width="2"/><path d="M12 2a10 10 0 0 1 10 10H12zM12 22A10 10 0 0 1 2 12h10z" fill="${fill}"/></svg>`;

const valueMapping = (aiDescription: string) => ({
  value: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription },
});

// Studio's standard setup and format tabs, with one field to map.
const valueForm = (label: string) => ({ createDefaults }: any) => createDefaults({ dataMappingItems: [{ key: "value", label }] });

const customWidgets = [
  {
    id: "resilience-score",
    label: "Resilience score",
    icon: icon("#15191C"),
    dataMapping: valueMapping("A numeric rating from 1 to 5. Map Stress tests > Resilience score with the min aggregation."),
    comp: ResilienceScoreWidget,
    form: valueForm("Rating"),
    defaultSize: { width: 8, height: 7 },
    minSize: { width: 5, height: 5 },
    ai: { description: "Five markers showing a 1 to 5 resilience score.", usage: "Use for the lowest resilience score across the tests in view." },
  },
  {
    id: "money-at-risk",
    label: "Money at risk",
    icon: icon("#C8372D"),
    dataMapping: valueMapping("A dollar amount. Map Stress tests > Money at risk with the sum aggregation."),
    comp: MoneyAtRiskWidget,
    form: valueForm("Amount"),
    defaultSize: { width: 8, height: 7 },
    minSize: { width: 5, height: 5 },
    ai: { description: "A large money figure, red when above zero.", usage: "Use for total money at risk." },
  },
];

// ---------- Report -----------------------------------------------------------

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number) => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });

const report = {
  selectedPageId: "overview",
  pages: [
    {
      id: "overview",
      widgets: {
        store: {
          type: "button-filter",
          dataMapping: { value: [{ id: "tests.store" }] },
          format: { ...title("Store build"), style: { selection: { type: "single" } } },
        },
        rating: { type: "resilience-score", dataMapping: { value: [{ id: "tests.rating", aggregation: "min" }] }, format: title("Resilience score") },
        risk: { type: "money-at-risk", dataMapping: { value: [sum("tests.atRisk")] }, format: title("Money at risk") },
        tests: {
          type: "value",
          dataMapping: { value: [{ id: "tests.id", aggregation: "countd" }] },
          format: title("Tests"),
        },
        failing: { type: "value", dataMapping: { value: [sum("tests.failing")] }, format: title("Failing") },
        "risk-by-scenario": {
          type: "column-chart-grouped",
          dataMapping: { categoryKey: [{ id: "tests.scenario" }], valueKey: [sum("tests.atRisk")], legendKey: [{ id: "tests.store" }] },
          format: { ...title("Money at risk by scenario and store build"), style: { theme: { common: { legend: { enabled: true } } } } },
        },
        "risk-by-reason": {
          type: "donut-chart",
          dataMapping: { categoryKey: [{ id: "risks.reason" }], valueKey: [sum("risks.amount")] },
          format: {
            ...title("Why money was at risk"),
            style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } }, theme: { common: { legend: { enabled: true, position: "right" } } } },
          },
        },
        "check-matrix": {
          type: "pivot-grid",
          dataMapping: { rows: [{ id: "tests.scenario" }], columns: [{ id: "checks.check" }], values: [sum("checks.failed")] },
          format: title("Failed money checks by scenario"),
        },
      },
      widgetLayout: {
        rating: at(0, 0, 7, 8),
        risk: at(7, 0, 6, 8),
        tests: at(13, 0, 3, 8),
        failing: at(16, 0, 3, 8),
        store: at(19, 0, 5, 8),
        "risk-by-scenario": at(0, 8, 15, 18),
        "risk-by-reason": at(15, 8, 9, 18),
        "check-matrix": at(0, 26, 24, 16),
      },
    },
    {
      id: "paypal",
      widgets: {
        "calls-by-type": {
          type: "column-chart-stacked",
          dataMapping: { categoryKey: [{ id: "calls.call" }], valueKey: [{ id: "calls.id", aggregation: "countd" }], legendKey: [{ id: "calls.fault" }] },
          format: { ...title("PayPal calls by type, with the failures Resilience Lab injected"), style: { theme: { common: { legend: { enabled: true } } } } },
        },
        errors: { type: "value", dataMapping: { value: [sum("calls.isError")] }, format: title("PayPal errors") },
        "call-log": {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "tests.runDate" }, { id: "tests.store" }, { id: "tests.scenario" },
              { id: "calls.call" }, { id: "calls.status" }, { id: "calls.fault" }, { id: "calls.requestId" },
            ],
          },
          sort: [{ field: { id: "tests.runDate" }, direction: "desc" }],
          format: title("PayPal call log"),
        },
      },
      widgetLayout: {
        "calls-by-type": at(0, 0, 18, 18),
        errors: at(18, 0, 6, 18),
        "call-log": at(0, 18, 24, 24),
      },
    },
  ],
} as unknown as AgReportState;

// ---------- Theme --------------------------------------------------------------

const palette = ["#C8372D", "#1F7A4D", "#15191C", "#C9A200", "#5A6872", "#8FA3AD", "#B5651D", "#4F6D8A", "#9C4F96", "#2E8C99"];
const theme = studioTheme.withParams({
  fontFamily: "Archivo, system-ui, sans-serif",
  fontSize: 14,
  textColor: "#1D2327",
  foregroundColor: "#1D2327",
  subtleTextColor: "#5A6872",
  backgroundColor: "#FFFFFF",
  borderColor: "#CDD5D8",
  accentColor: "#15191C",
  studioWrapperBorder: false,
  studioWrapperBackgroundColor: "#EDF0EF",
  studioCanvasBorder: false,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: "#EDF0EF",
  studioCanvasPadding: 20,
  studioWidgetBackgroundColor: "#FFFFFF",
  studioWidgetBorder: { width: 1, color: "#CDD5D8" },
  studioWidgetBorderRadius: 10,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleTextColor: "#1D2327",
  gridHeaderTextColor: "#5A6872",
  chartFontFamily: "Archivo, system-ui, sans-serif",
  chartTextColor: "#1D2327",
  ...Object.fromEntries(palette.flatMap((c, i) => [[`chartPaletteFills${i + 1}Color`, c], [`chartPaletteStrokes${i + 1}Color`, c]])),
} as any);

// ---------- AI: Studio's agents plus a resilience analyst of our own ------------------

function buildAi(models: string[]) {
  const adapter = openaiAdapter({ endpoint: "/api/ai", model: models[0] });
  return ({ api }: { api: AgStudioApi }) => {
    const explainFailure = api.defineAiTool({
      name: "explain_stress_test",
      description: "Get Resilience Lab's evidence for the latest test of one scenario: failed money checks, money at risk, injected PayPal faults, and the AI investigator's diagnosis and fix if one was run.",
      params: (s: any) => s.object({ scenario: s.string({ description: "Scenario name, for example 'Refund retry' or 'Price tampering'." }) }),
      execute: async (args: any, ctx: any) => {
        const res = await fetch(`/api/dashboard/explain?scenario=${encodeURIComponent(args.scenario)}`);
        const body = await res.json();
        return res.ok ? ctx.success(JSON.stringify(body), body) : ctx.error(body.error ?? "Not found");
      },
    } as any);
    const startStressTest = api.defineAiTool({
      name: "start_stress_test",
      description: "Start a new Resilience Lab stress test of all scenarios against one store build. Only call this after the user has explicitly confirmed in the chat.",
      params: (s: any) => s.object({ store: s.enum(["original", "fixed"], { description: "'original' is the store as written; 'fixed' is the hand-fixed reference." }) }),
      execute: async (args: any, ctx: any) => {
        const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: args.store }) });
        const body = await res.json();
        return res.ok ? ctx.success(`Started stress test ${body.id}. Results appear on the Stress tests page in a few minutes.`) : ctx.error(body.error);
      },
    } as any);

    return createAiHarness(api, ({ tools, builtIn }: any) => {
      const run = (definition: any) => directLlmRunner({ ...definition, adapter });
      const resilienceAnalyst = directLlmRunner({
        id: "resilience-analyst",
        name: "Resilience analyst",
        adapter,
        description: "Explains Resilience Lab stress-test failures: what broke, how much money was at risk, which PayPal call was involved and how the store was fixed. Can start a new stress test after the user confirms.",
        schema: (s: any) => s.undefined(),
        instructions: () =>
          "You are Checkout Resilience Lab's analyst.Answer in plain English for a shop owner, with numbers from the data. " +
          "Use explain_stress_test for the evidence behind a scenario. Never start a stress test unless the user has just confirmed they want one.",
        tools: () => [tools.studio.viewSchema(), tools.studio.executeQuery(), explainFailure, startStressTest],
      } as any);
      // Studio's lead delegates to a fixed set of agents; widen it so it can hand work to ours.
      const lead = directLlmRunner({
        ...builtIn.lead,
        adapter,
        tools: (ctx: any, params: any) => [
          ...(builtIn.lead.tools?.(ctx, params) ?? []).filter((t: any) => t.name !== "delegate_to"),
          tools.delegateTo(["data", "page", "planning", "widget", "resilience-analyst"]),
        ],
      });
      return {
        agents: [lead, run(builtIn.data), run(builtIn.page), run(builtIn.planning), run(builtIn.widget), resilienceAnalyst],
        primary: "lead",
        models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
        promptStarters: [
          { label: "What's costing money?", prompt: "Which scenario puts the most money at risk, and why? Ask the resilience analyst." },
          { label: "Explain refund retry", prompt: "Ask the resilience analyst to explain the refund retry failure and the fix." },
          { label: "Add a chart", prompt: "Add a chart of failing tests by scenario." },
        ],
      };
    });
  };
}

// ---------- App ------------------------------------------------------------------

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { fetch("/api/dashboard/data").then((r) => r.json()).then(setData); }, []);
  const sources = useMemo(() => (data ? buildData(data) : null), [data]);
  const ai = useMemo(() => (window.RESILIENCE_LAB.aiModels.length ? buildAi(window.RESILIENCE_LAB.aiModels) : undefined), []);

  const [mode, setMode] = useState<"view" | "edit">("view");

  if (!data || !sources) return <p style={{ padding: 28, color: "#5A6872" }}>Loading stress-test history…</p>;
  if (!data.tests.length) return <p style={{ padding: 28, color: "#5A6872" }}>No stress tests yet. Run one from the Stress tests page.</p>;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 28px 0", flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "#5A6872" }}>
          {data.tests.length} tests from Resilience Lab's stress-test history. Money figures come from PayPal's own records.
        </p>
        <button
          onClick={() => setMode(mode === "view" ? "edit" : "view")}
          style={{ marginLeft: "auto", padding: "8px 14px", borderRadius: 4, border: "1px solid #15191C", background: mode === "edit" ? "#15191C" : "transparent", color: mode === "edit" ? "#fff" : "#15191C", font: "inherit", fontWeight: 600, cursor: "pointer" }}
        >
          {mode === "view" ? (ai ? "Ask AI and edit" : "Edit dashboard") : "Done editing"}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
    <AgStudioProvider licenseKey={window.RESILIENCE_LAB.licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
      <AgStudio
        style={{ height: "100%", width: "100%" }}
        theme={theme}
        data={sources}
        initialState={report}
        mode={mode}
        panels={{ edit: { right: ai ? ["ai", "edit", "data"] : ["edit", "data"] }, view: { right: [] } }}
        ai={ai as any}
        widgets={((config: any) =>
          createWidgets({
            additionalTypes: customWidgets as any,
            menu: [...config.menu, { label: "Resilience Lab", widgetIds: ["resilience-score", "money-at-risk"] }],
          } as any)) as any}
      />
    </AgStudioProvider>
      </div>
    </div>
  );
}

createRoot(document.getElementById("dashboard")!).render(<Dashboard />);
