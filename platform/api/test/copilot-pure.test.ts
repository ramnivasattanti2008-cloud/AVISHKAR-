import { describe, expect, it } from "vitest";
import { groundedNumbers, numbersIn, ungroundedNumbers } from "../src/copilot/guard.js";
import { INTENTS, SUGGESTIONS, hourIn, render, route, sizeIn } from "../src/copilot/intents.js";
import { AnthropicAdapter, buildPrompt } from "../src/copilot/llm.js";
import { checkWording } from "../src/copilot/service.js";
import type { ToolName, ToolResult } from "../src/copilot/tools.js";

const result = (tool: ToolName, output: unknown, over: Partial<ToolResult> = {}): ToolResult => ({ id: `${tool}-id`, tool, input: {}, output, status: "OK", unavailableReason: null, dataStatus: "ESTIMATED", calledAt: "2026-10-08T10:00:00.000Z", ...over });

describe("route: a question goes to the tools that hold its answer, or nowhere", () => {
  const cases: [string, string, string][] = [
    ["Why did the plan charge the battery at 11 pm?", "WHY_DECISION", "getLatestPlan"],
    ["How much will I save?", "SAVINGS", "getLatestPlan"],
    ["What will my solar make tomorrow?", "SOLAR", "getSolarForecast"],
    ["How much electricity will I use tomorrow?", "LOAD", "getLoadForecast"],
    ["What should I change?", "OPPORTUNITIES", "getEnergyOpportunities"],
    ["How long could my battery keep my critical loads going in a power cut?", "OUTAGE", "getResilience"],
    ["What would the subsidy be for 3 kWp of solar?", "SUBSIDY", "getEligibility"],
    ["What would adding 3 kWp of solar do over a year?", "WHAT_IF", "runSimulation"],
    ["What would this cost without the plan?", "COUNTERFACTUAL", "getCounterfactual"],
    ["Which tariff am I on?", "TARIFF", "getTariff"],
    ["How charged is my battery?", "BATTERY", "getBatteryState"],
    ["How have the forecasts done?", "ACCURACY", "getForecastAccuracy"],
    ["Make a plan to save money", "MAKE_PLAN", "runOptimization"],
    ["What is the weather like?", "WEATHER", "getWeather"],
    ["How healthy is my energy use?", "HEALTH", "getEnergyHealth"],
    ["How efficient is my system?", "HEALTH", "getEnergyHealth"],
    ["Where am I wasting energy?", "WASTE", "getEnergyWaste"],
    ["How much solar is being thrown away?", "WASTE", "getEnergyWaste"],
  ];
  for (const [q, intent, tool] of cases) {
    it(`${q} -> ${intent}`, () => {
      const r = route(q);
      expect(r?.intent).toBe(intent);
      expect(r?.calls.map((c) => c.tool)).toEqual([tool]);
    });
  }

  it("answers every suggestion it offers, and there is an intent behind each kind", () => {
    for (const q of SUGGESTIONS) expect(route(q), q).not.toBeNull();
    const reached = new Set([...SUGGESTIONS, "Make a plan", "What is the weather like?"].map((q) => route(q)?.intent));
    for (const i of INTENTS) expect(reached.has(i), i).toBe(true);
  });

  it("does not guess at what it does not know, or at nothing", () => {
    for (const q of ["tell me a joke", "who won the match", "asdf", "", "   "]) expect(route(q), q).toBeNull();
  });

  it("takes the mode and the horizon of a new plan from the words", () => {
    expect(route("make a plan for independence")?.calls[0]?.input).toEqual({ mode: "INDEPENDENCE", hours: 24 });
    expect(route("Make a new plan for 48 hours")?.calls[0]?.input).toEqual({ mode: "BALANCED", hours: 48 });
    expect(route("create a green plan")?.calls[0]?.input).toEqual({ mode: "GREEN", hours: 24 });
  });

  it("takes the sizes of a what-if from the words, and asks about a subsidy for the size named", () => {
    expect(route("what if I add 5 kWh of battery")?.calls[0]?.input).toEqual({ addBatteryKwh: 5 });
    expect(route("what if I install 4 kWp and a 10 kWh battery")?.calls[0]?.input).toEqual({ addSolarKwp: 4, addBatteryKwh: 10 });
    expect(route("subsidy for a 4 kW system")?.calls[0]?.input).toEqual({ systemKwp: 4 });
    expect(route("is there a subsidy")?.calls[0]?.input).toEqual({ systemKwp: 3 }); // no size given: the common rooftop size is used, and the answer says the size
  });
});

describe("what a question names", () => {
  it("hours: 11 pm, 6 am, 12 am, 12 pm, 23:00, at 7, none", () => {
    expect(hourIn("at 11 pm")).toBe(23);
    expect(hourIn("around 6 AM")).toBe(6);
    expect(hourIn("at 12 am")).toBe(0);
    expect(hourIn("at 12 pm")).toBe(12);
    expect(hourIn("at 23:00")).toBe(23);
    expect(hourIn("at 7")).toBe(7);
    expect(hourIn("why did it do that")).toBeNull();
    expect(hourIn("at 45")).toBeNull();
  });
  it("sizes", () => {
    expect(sizeIn("3 kWp")).toEqual({ solarKwp: 3 });
    expect(sizeIn("a 2.5 kwh battery")).toEqual({ batteryKwh: 2.5 });
    expect(sizeIn("a 3 kW solar system")).toEqual({ solarKwp: 3 });
    expect(sizeIn("nothing")).toBeNull();
  });
});

describe("the guard: a number that no tool returned does not get through", () => {
  const out = [{ savingsInr: 11.7, netCostInr: 41.2, share: 0.79, reason: "buying would cost INR 10.00 per kWh", nested: { items: [{ kwh: 2.5 }] } }];

  it("reads numbers as people write them", () => {
    expect(numbersIn("₹1,23,456.50 and 79% and 2.5 kWh [1] [2]")).toEqual([123456.5, 79, 2.5]);
    expect(numbersIn("no numbers here")).toEqual([]);
  });

  it("allows a tool's numbers, their rounding, percentages of shares, and the numbers inside the sentences it returned", () => {
    expect(ungroundedNumbers("It saves ₹11.70 [1], costing ₹41.2.", out)).toEqual([]);
    expect(ungroundedNumbers("About 12 rupees", out)).toEqual([]); // small whole numbers are how sentences are built
    expect(ungroundedNumbers("The band held 79% of the time", out)).toEqual([]);
    expect(ungroundedNumbers("Buying costs ₹10 per kWh", out)).toEqual([]);
    expect(ungroundedNumbers("2.5 kWh", out)).toEqual([]);
    expect(groundedNumbers(out)).toContain(2.5);
  });

  it("refuses a number that was made up, however plausible", () => {
    expect(ungroundedNumbers("It saves ₹1,250 a year", out)).toEqual([1250]);
    expect(ungroundedNumbers("It saves ₹11.70 and 4,321 kWh", out)).toEqual([4321]);
    expect(ungroundedNumbers("The tariff is ₹8.35 per kWh", out)).toEqual([8.35]);
  });

  it("allows years and whole numbers up to a month, and nothing else of that size", () => {
    expect(ungroundedNumbers("On 7 October 2026 over 20 years", out)).toEqual([]);
    expect(ungroundedNumbers("over 45 days", out)).toEqual([45]);
  });
});

describe("checkWording: a language model's text is used only if it holds to the rules", () => {
  const results = [result("getLatestPlan", { savingsInr: 11.7 })];
  it("accepts grounded text that cites a real result", () => expect(checkWording("The plan saves ₹11.70 [1].", results)).toBeNull());
  it("rejects a number no tool returned", () => expect(checkWording("The plan saves ₹99 [1].", results)).toContain("which no tool returned"));
  it("rejects text that cites nothing", () => expect(checkWording("The plan saves ₹11.70.", results)).toBe("it cited no tool result"));
  it("rejects a citation to a result that does not exist", () => expect(checkWording("The plan saves ₹11.70 [2].", results)).toBe("it cited a tool result that does not exist"));
});

describe("render: the template wording", () => {
  const plan = result("getLatestPlan", {
    planId: "p1",
    madeAt: "2026-10-07T10:10:00.000Z",
    mode: "BALANCED",
    start: "2026-10-07T10:30:00.000Z",
    hours: 24,
    netCostInr: 41.2,
    noControlCostInr: 52.9,
    savingsInr: 11.7,
    decisions: [
      { time: "2026-10-07T17:30:00.000Z", kind: "charge_battery", kwh: 2.58, reason: "Charge now at INR 4.00 per kWh: it avoids buying later at INR 10.00." }, // 23:00 IST
      { time: "2026-10-07T18:30:00.000Z", kind: "charge_battery", kwh: 2.73, reason: "Charge again at INR 4.00." }, // 00:00 IST
      { time: "2026-10-08T13:30:00.000Z", kind: "discharge_battery", kwh: 2, reason: "Use the battery now: buying would cost INR 10.00 per kWh." }, // 19:00 IST
    ],
    totalDecisions: 3,
    appliances: [],
    assumptions: ["The battery's charge now is not known."],
  });

  it("explains the decision at the hour that was asked about, in the reason's own words, with a citation", () => {
    const r = render("WHY_DECISION", "why did the plan charge the battery at 11 pm?", [plan]);
    expect(r.status).toBe("ANSWERED");
    expect(r.paragraphs[0]).toContain("At 11 pm the plan chose to charge the battery (2.58 kWh): Charge now at INR 4.00 per kWh: it avoids buying later at INR 10.00. [1]");
    expect(r.citations).toEqual([{ marker: 1, toolResultId: "getLatestPlan-id", tool: "getLatestPlan" }]);
  });

  it("says plainly when the plan made no decision at that hour, instead of inventing one", () => {
    const r = render("WHY_DECISION", "why at 3 pm", [plan]);
    expect(r.paragraphs[0]).toContain("The plan made no change at 3 pm");
  });

  it("without an hour, gives the largest decisions", () => {
    const r = render("WHY_DECISION", "why did you do that", [plan]);
    expect(r.paragraphs.join(" ")).toContain("made 3 decisions");
    expect(r.paragraphs.join(" ")).toContain("At 12 am it chose to charge the battery (2.73 kWh)");
  });

  it("states the saving and what it is: a simulated outcome", () => {
    const r = render("SAVINGS", "how much will I save", [plan]);
    expect(r.paragraphs[0]).toContain("expected to cost ₹41.20 over 24 hours against ₹52.90 with no control: it saves ₹11.70 [1]");
    expect(r.paragraphs[1]).toContain("simulated outcome of forecasts, not a measurement");
  });

  it("every number in every answer is one a tool returned", () => {
    for (const [intent, q] of [["WHY_DECISION", "why at 11 pm"], ["WHY_DECISION", "why"], ["WHY_DECISION", "why at 3 pm"], ["SAVINGS", "save"]] as const) {
      const r = render(intent, q, [plan]);
      expect(ungroundedNumbers(r.paragraphs.join(" "), [plan.output]), `${intent}: ${q}`).toEqual([]);
    }
  });

  it("when a tool cannot answer, says why with the tool's own reason, and offers the way forward", () => {
    const none = result("getLatestPlan", null, { status: "UNAVAILABLE", unavailableReason: "No plan has been made for this property yet.", dataStatus: "UNAVAILABLE" });
    const r = render("SAVINGS", "how much will I save", [none]);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.paragraphs[0]).toContain("I cannot answer that from what is on file: No plan has been made for this property yet. [1]");
    expect(r.paragraphs[0]).toContain("Ask me to make a plan");
  });

  it("states an unavailable subsidy as unavailable, never as a number", () => {
    const r = render("SUBSIDY", "subsidy", [result("getEligibility", { consumerType: "RESIDENTIAL", systemKwp: 3, pmSuryaGhar: { outcome: "NO_SOURCED_RULE", subsidyInr: null, caveats: [] }, netMetering: { outcome: "NO_SOURCED_RULE", caveat: "No sourced net-metering rule is loaded." } })]);
    expect(r.paragraphs[0]).toContain("I cannot state a subsidy for 3 kWp");
    expect(r.paragraphs.join(" ")).toContain("No sourced net-metering rule is loaded.");
  });

  const health = result("getEnergyHealth", {
    planMadeAt: "2026-10-08T09:00:00.000Z",
    stale: false,
    metrics: [
      { key: "efficiency", label: "Efficiency", value: 98, unit: "%", higherIsBetter: true, reason: null },
      { key: "storageUtilisation", label: "Storage utilisation", value: null, unit: "%", higherIsBetter: true, reason: "There is no battery in this plan." },
      { key: "resilience", label: "Resilience", value: 9.5, unit: "h", higherIsBetter: true, reason: null },
      { key: "gridDependence", label: "Grid dependence", value: 44.3, unit: "%", higherIsBetter: false, reason: null },
    ],
    note: "Each metric is a ratio that means what its formula says, worked out from a simulated day: a plan, not a measurement.",
  });
  const waste = (over: Record<string, unknown> = {}) =>
    result("getEnergyWaste", {
      planMadeAt: "2026-10-08T09:00:00.000Z",
      stale: false,
      findings: [
        { key: "solarCurtailment", label: "Solar thrown away", state: "FOUND", kwh: 0.8, valueInr: 2.4, explanation: "0.8 kWh of solar could be neither used, stored nor sold, worth ₹2.40 at the export price." },
        { key: "surplusSold", label: "Surplus sold to the grid", state: "NONE", kwh: 0, valueInr: 0, explanation: "Nothing was sold." },
        { key: "batteryOpportunity", label: "Battery opportunity lost", state: "UNAVAILABLE", kwh: null, valueInr: null, explanation: "AVISHKAR has no record of what the battery actually did (no device feed)." },
      ],
      avoidablePerDayInr: 40.4,
      avoidableAverageMonthInr: null,
      avoidableAverageMonthReason: "No what-if run has worked out a year for this property, and a month's figure needs one.",
      note: "A plan is a simulation of a day on forecasts: these are what that day shows, not what was measured.",
      ...over,
    });

  it("gives each health metric as a ratio in its own unit, says which way is better, and says plainly when one cannot be worked out", () => {
    const r = render("HEALTH", "how healthy is my energy use", [health]);
    const t = r.paragraphs.join(" ");
    expect(t).toContain("Efficiency: 98% (higher is better).");
    expect(t).toContain("Resilience: 9.5 hours (higher is better).");
    expect(t).toContain("Grid dependence: 44.3% (lower is better).");
    expect(t).toContain("Storage utilisation: not worked out. There is no battery in this plan.");
    expect(t).toContain("not a measurement");
    expect(t).not.toMatch(/overall score of|out of 100/);
    expect(ungroundedNumbers(t, [health.output])).toEqual([]);
  });

  it("reports waste only where it was found, says what it cannot tell, and refuses a month's figure it was not given", () => {
    const r = render("WASTE", "where am I wasting energy", [waste()]);
    const t = r.paragraphs.join(" ");
    expect(t).toContain("Solar thrown away: 0.8 kWh of solar could be neither used, stored nor sold, worth ₹2.40 at the export price.");
    expect(t).not.toContain("Nothing was sold"); // a finding of none is not listed as waste
    expect(t).toContain("Battery opportunity lost: I cannot tell.");
    expect(t).toContain("The same day with no control would cost ₹40.40 more.");
    expect(t).toContain("I do not state a figure for a month: No what-if run has worked out a year");
    expect(ungroundedNumbers(t, [waste().output])).toEqual([]);
  });

  it("states a month's avoidable cost only when it was given, and does not say a plan that costs more saves", () => {
    const withMonth = render("WASTE", "avoidable", [waste({ avoidableAverageMonthInr: 612.5, avoidableAverageMonthReason: null })]);
    expect(withMonth.paragraphs.join(" ")).toContain("In an average month that comes to about ₹612.50");
    const dearer = render("WASTE", "waste", [waste({ avoidablePerDayInr: -5 })]);
    expect(dearer.paragraphs.join(" ")).toContain("This plan costs ₹5 more than the same day with no control");
    const same = render("WASTE", "waste", [waste({ avoidablePerDayInr: 0 })]);
    expect(same.paragraphs.join(" ")).toContain("would cost the same");
  });

  it("without a plan, says so with the tool's reason and does not make up a figure", () => {
    const none = result("getEnergyHealth", null, { status: "UNAVAILABLE", unavailableReason: "No plan has been made yet, and energy health is worked out from the latest plan. Ask me to make a plan.", dataStatus: "UNAVAILABLE" });
    const r = render("HEALTH", "how healthy", [none]);
    expect(r.status).toBe("UNAVAILABLE");
    expect(r.paragraphs[0]).toContain("No plan has been made yet");
  });

  it("does not claim a battery charge it was not given", () => {
    const r = render("BATTERY", "battery", [result("getBatteryState", { batteries: [{ name: "Wall", capacityKwh: 10, usableKwh: 9, chargeEnteredPercent: null, chargeEnteredHoursAgo: null }], note: "AVISHKAR is not connected to the battery." })]);
    expect(r.paragraphs[0]).toContain("no charge entered");
  });
});

describe("the language model adapter", () => {
  const ok = (text: string) => async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200, headers: { "content-type": "application/json" } });

  it("sends the key, the model and only the question and the tool results, and returns the text", async () => {
    let seen: { url: string; headers: Record<string, string>; body: { model: string; system: string; messages: { content: string }[] } } | undefined;
    const llm = new AnthropicAdapter({
      apiKey: "sk-test-0123456789abcdefghij",
      model: "claude-sonnet-5-5",
      fetchImpl: (async (url: URL, init: RequestInit) => {
        seen = { url: url.toString(), headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
        return ok("It saves ₹11.70 [1].")();
      }) as unknown as typeof fetch,
    });
    const p = buildPrompt("how much will I save?", [result("getLatestPlan", { savingsInr: 11.7 })]);
    expect(await llm.complete(p)).toBe("It saves ₹11.70 [1].");
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen!.headers["x-api-key"]).toBe("sk-test-0123456789abcdefghij");
    expect(seen!.body.model).toBe("claude-sonnet-5-5");
    expect(seen!.body.system).toContain("Answer ONLY from them");
    expect(seen!.body.messages[0]!.content).toContain("how much will I save?");
    expect(seen!.body.messages[0]!.content).toContain('"savingsInr": 11.7');
  });

  it("fails loudly on an error status or an empty reply, so the caller can fall back to templates", async () => {
    const down = new AnthropicAdapter({ apiKey: "k".repeat(24), model: "m", fetchImpl: (async () => new Response("no", { status: 529 })) as typeof fetch });
    await expect(down.complete({ system: "s", user: "u" })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const empty = new AnthropicAdapter({ apiKey: "k".repeat(24), model: "m", fetchImpl: ok("") as unknown as typeof fetch });
    await expect(empty.complete({ system: "s", user: "u" })).rejects.toMatchObject({ code: "PROVIDER_BAD_RESPONSE" });
  });

  it("the prompt forbids inventing figures and asks for citations", () => {
    const p = buildPrompt("q", []);
    expect(p.system).toContain("never state a number");
    expect(p.system).toContain("[1]");
  });
});
