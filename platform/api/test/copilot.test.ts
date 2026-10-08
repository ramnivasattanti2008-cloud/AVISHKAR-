import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LlmAdapter } from "../src/copilot/llm.js";
import { SUGGESTIONS } from "../src/copilot/intents.js";
import { ungroundedNumbers } from "../src/copilot/guard.js";
import { TOOL_NAMES } from "../src/copilot/tools.js";
import { EngineClient } from "../src/engine/client.js";
import { local } from "../src/plan/horizon.js";
import { seedReferenceData } from "../src/seed/reference.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const PATTERN = (h: number) => 0.5 + (h >= 18 && h < 22 ? 2 : 0);
const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

describeBoth("the Copilot, through the API, the real tools and the real engine", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const ask = async (question: string) => {
    const res = await call("POST", `/api/properties/${pid}/copilot/ask`, { question });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const text = (a: { paragraphs: string[] }) => a.paragraphs.join(" ");
  /** The invariant behind "no fake AI": every number in the answer is one a tool returned. */
  const grounded = (a: { paragraphs: string[]; toolResults: { output: unknown }[] }) => expect(ungroundedNumbers(text(a), a.toolResults.map((r) => r.output)), text(a)).toEqual([]);

  const setup = async () => {
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id });
    await call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start: "2026-07-29", days: 70, intervalMinutes: 60, kw: (_d, h) => PATTERN(h) }), filename: "m.csv" });
    await call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 13, azimuthDeg: 180 });
    await call("POST", `/api/properties/${pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
  };

  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 180_000 }) });
    t.clock.now = new Date("2026-10-07T10:10:00Z");
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "copilot@example.com");
    pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });

  it("lists the tools it can use, which of them store something, and whether a language model is configured", async () => {
    const r = (await t.app.inject({ method: "GET", url: "/api/copilot/tools" })).json();
    expect(r.tools.map((x: { name: string }) => x.name)).toEqual([...TOOL_NAMES]);
    expect(r.tools.filter((x: { writes: boolean }) => x.writes).map((x: { name: string }) => x.name).sort()).toEqual(["runOptimization", "runSimulation"]);
    expect(r.questions).toEqual(SUGGESTIONS);
    expect(r.languageModel).toBe(false);
    for (const name of ["getProperty", "getWeather", "getSatelliteObservations", "getSolarForecast", "getLoadForecast", "getBatteryState", "getTariff", "getEligibility", "getEnergyOpportunities", "runOptimization", "runSimulation", "calculateEconomics", "getResilience", "getCounterfactual"]) {
      expect(r.tools.some((x: { name: string }) => x.name === name), name).toBe(true); // the fourteen of the specification
    }
  });

  it("does not guess: a question it cannot answer gets the list of what it can", async () => {
    const a = await ask("tell me a joke");
    expect(a).toMatchObject({ status: "NOT_UNDERSTOOD", intent: null, toolResults: [], generatedBy: "TEMPLATES" });
    expect(a.suggestions).toEqual(SUGGESTIONS);
  });

  it("says there is no plan to talk about, with the tool's reason and a way forward, before any plan exists", async () => {
    await setup();
    const a = await ask("How much will I save?");
    expect(a.status).toBe("UNAVAILABLE");
    expect(text(a)).toContain("No plan has been made for this property yet");
    expect(text(a)).toContain("Ask me to make a plan");
    expect(a.toolResults[0]).toMatchObject({ tool: "getLatestPlan", status: "UNAVAILABLE", output: null });
  });

  it("makes a plan only when asked to, then answers about it from the stored plan: the saving, and why a decision was made", async () => {
    await setup();
    expect(await db().optimizationRun.count()).toBe(0);
    const made = await ask("Make a plan to save money");
    expect(made).toMatchObject({ status: "ANSWERED", intent: "MAKE_PLAN" });
    expect(await db().optimizationRun.count()).toBe(1);
    grounded(made);

    const plan = (await call("GET", `/api/properties/${pid}/plan`)).json();
    const saving = await ask("how much will I save?");
    expect(saving.status).toBe("ANSWERED");
    expect(text(saving)).toContain(`it saves ₹${plan.result.value.savingsInr.toLocaleString("en-IN", { minimumFractionDigits: plan.result.value.savingsInr % 1 === 0 ? 0 : 2 })}`);
    expect(text(saving)).toContain("simulated outcome of forecasts, not a measurement");
    grounded(saving);
    expect(await db().optimizationRun.count()).toBe(1); // asking about it did not make another

    const d = plan.decisions.find((x: { kind: string }) => x.kind === "charge_battery") ?? plan.decisions[0];
    const hour = local(Date.parse(d.time)).hour;
    const why = await ask(`Why did the plan do that at ${hourLabel(hour)}?`);
    expect(why.status).toBe("ANSWERED");
    expect(text(why)).toContain(`At ${hourLabel(hour)} the plan chose to`);
    expect(text(why)).toContain(d.reason.replace(/\.$/, "")); // the planner's own reason, verbatim
    expect(why.citations).toHaveLength(1);
    expect(why.toolResults.find((r: { id: string }) => r.id === why.citations[0].toolResultId).tool).toBe("getLatestPlan");
    grounded(why);

    const nothing = await ask("why at 4 am?"); // the plan starts at 4 pm: look for an hour with no decision
    expect(nothing.status).toBe("ANSWERED");
    grounded(nothing);
  });

  it("answers the rest of its questions from the tools, every figure traceable to a result and none made up", async () => {
    await setup();
    await call("POST", `/api/properties/${pid}/appliances`, { name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 150, quantity: 2 });
    await call("POST", `/api/properties/${pid}/plan`, { mode: "BALANCED", hours: 24 });
    await call("POST", `/api/properties/${pid}/scenarios`, { addSolarKwp: 2 });
    const asked: Record<string, string> = {};
    for (const q of ["What will my solar make tomorrow?", "How much electricity will I use tomorrow?", "Which tariff am I on?", "How charged is my battery?", "What would this cost without the plan?", "What would the subsidy be for 3 kWp of solar?", "How have the forecasts done?", "What is the weather like?"]) {
      const a = await ask(q);
      expect(a.status, `${q}: ${text(a)}`).toBe("ANSWERED");
      expect(a.citations.length, q).toBeGreaterThan(0);
      for (const c of a.citations) expect(a.toolResults.some((r: { id: string }) => r.id === c.toolResultId), q).toBe(true);
      grounded(a);
      asked[q] = text(a);
    }
    expect(asked["Which tariff am I on?"]).toContain("You are on Test ToD");
    expect(asked["Which tariff am I on?"]).toContain("between ₹4 and ₹10 per kWh");
    expect(asked["Which tariff am I on?"]).toContain("entered by you");
    expect(asked["How charged is my battery?"]).toContain("no charge entered");
    expect(asked["What would the subsidy be for 3 kWp of solar?"]).toContain("₹78,000");
    expect(asked["What would this cost without the plan?"]).toContain("with no solar and no battery");
    expect(asked["What will my solar make tomorrow?"]).toMatch(/kWh over the next \d+ days/); // the fake weather service returns two days
  });

  it("works out how long the batteries could carry the critical loads, by hand-checkable arithmetic", async () => {
    await setup();
    await call("POST", `/api/properties/${pid}/appliances`, { name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 150, quantity: 2 });
    let a = await ask("How long could my battery keep my critical loads going in a power cut?");
    expect(a.status).toBe("ANSWERED");
    const o = a.toolResults[0].output;
    // 10 kWh battery, 10% unusable: 9 kWh usable; discharge efficiency sqrt(0.9); a 0.3 kW critical load (two 150 W fridges)
    expect(o.criticalKw).toBe(0.3);
    expect(o.batteryUsableKwh).toBe(9);
    expect(o.hoursAtFullCharge).toBeCloseTo((9 * Math.sqrt(0.9)) / 0.3, 1);
    expect(o.hoursAtCurrentCharge).toBeNull(); // no charge entered
    expect(text(a)).toContain("no outage has been forecast");
    // with the charge entered (50%): 4 kWh above the floor
    const b = (await call("GET", `/api/properties/${pid}/batteries`)).json().batteries[0];
    await call("PATCH" as "POST", `/api/properties/${pid}/batteries/${b.id}`, { currentSoc: 0.5 });
    a = await ask("how long could my battery keep my critical loads going in a power cut");
    expect(a.toolResults[0].output.hoursAtCurrentCharge).toBeCloseTo((4 * Math.sqrt(0.9)) / 0.3, 1);
    grounded(a);
  });

  it("will not answer an outage question with no critical load or no battery, and says what to add", async () => {
    const a = await ask("what if there is a power cut");
    expect(a.status).toBe("UNAVAILABLE");
    expect(text(a)).toContain("No installed battery is entered");
    await call("POST", `/api/properties/${pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
    expect(text(await ask("what if there is a power cut"))).toContain("No appliance is marked critical");
  });

  it("runs a what-if only when the question asks for one, stores it, and does not invent a price", async () => {
    await setup();
    expect(await db().scenario.count()).toBe(0);
    const a = await ask("What would adding 3 kWp of solar do over a year?");
    expect(a).toMatchObject({ status: "ANSWERED", intent: "WHAT_IF" });
    expect(await db().scenario.count()).toBe(1);
    expect(text(a)).toContain("No price was given, so there is no payback");
    grounded(a);
    await ask("which tariff am I on");
    expect(await db().scenario.count()).toBe(1);
  });

  it("calls any tool directly and returns its raw result: economics with a known answer, and a refusal of bad input", async () => {
    const r = await call("POST", `/api/properties/${pid}/copilot/tools/calculateEconomics`, { investmentInr: 1000, annualSavingsInr: 250, years: 10, discountRatePercent: 0, degradationPercent: 0 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ tool: "calculateEconomics", status: "OK", output: { paybackYears: 4, npvInr: 1500, netGainInr: 1500 } });
    expect((await call("POST", `/api/properties/${pid}/copilot/tools/calculateEconomics`, { investmentInr: -5, annualSavingsInr: 1 })).statusCode).toBe(400);
    expect((await call("POST", `/api/properties/${pid}/copilot/tools/notATool`, {})).statusCode).toBe(400);
    const unavailable = (await call("POST", `/api/properties/${pid}/copilot/tools/getTariff`, {})).json();
    expect(unavailable).toMatchObject({ status: "UNAVAILABLE", output: null, dataStatus: "UNAVAILABLE" });
    expect(unavailable.unavailableReason).toContain("No tariff has been chosen");
  });

  describe("with a language model configured", () => {
    const model = (reply: () => Promise<string>): LlmAdapter => ({ name: "fake", complete: reply });

    it("uses its wording when every number is one a tool returned and it cites a result", async () => {
      await setup();
      await call("POST", `/api/properties/${pid}/plan`, { mode: "BALANCED", hours: 24 });
      const plan = (await call("GET", `/api/properties/${pid}/plan`)).json();
      const sv = plan.result.value.savingsInr;
      t.deps.llm = model(async () => `Your latest plan is expected to save ₹${sv} compared with no control [1]. This is a simulated outcome.`);
      const a = await ask("how much will I save?");
      expect(a.generatedBy).toBe("LANGUAGE_MODEL");
      expect(text(a)).toContain("expected to save");
      expect(a.notes).toEqual([]);
      expect(a.citations).toEqual([{ marker: 1, toolResultId: a.toolResults[0].id, tool: "getLatestPlan" }]);
    });

    it("drops its wording and uses the template when it states a number no tool returned, and says so", async () => {
      await setup();
      await call("POST", `/api/properties/${pid}/plan`, { mode: "BALANCED", hours: 24 });
      t.deps.llm = model(async () => "Your plan saves ₹98,765 a year [1].");
      const a = await ask("how much will I save?");
      expect(a.generatedBy).toBe("TEMPLATES");
      expect(text(a)).not.toContain("98,765");
      expect(a.notes.join(" ")).toContain("which no tool returned");
      grounded(a);
    });

    it("drops wording that cites nothing, or that fails, and still answers", async () => {
      await setup();
      await call("POST", `/api/properties/${pid}/plan`, { mode: "BALANCED", hours: 24 });
      t.deps.llm = model(async () => "It saves quite a lot.");
      expect((await ask("how much will I save?")).notes.join(" ")).toContain("it cited no tool result");
      t.deps.llm = model(async () => {
        throw new Error("down");
      });
      const a = await ask("how much will I save?");
      expect(a.generatedBy).toBe("TEMPLATES");
      expect(a.notes.join(" ")).toContain("could not be reached");
      expect(a.status).toBe("ANSWERED");
    });

    it("never asks the model about a question the tools could not answer", async () => {
      let called = 0;
      t.deps.llm = model(async () => {
        called++;
        return "x [1]";
      });
      expect((await ask("how much will I save?")).status).toBe("UNAVAILABLE"); // no plan
      expect((await ask("tell me a joke")).status).toBe("NOT_UNDERSTOOD");
      expect(called).toBe(0);
    });

    it("reports that a language model is configured", async () => {
      t.deps.llm = model(async () => "x");
      expect((await t.app.inject({ method: "GET", url: "/api/copilot/tools" })).json().languageModel).toBe(true);
    });
  });

  it("is private to its owner, needs a session and the CSRF header, and keeps no copy of the question", async () => {
    const other = await register(t, "other@example.com");
    expect((await call("POST", `/api/properties/${pid}/copilot/ask`, { question: "which tariff am I on" }, other)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/copilot/ask`, payload: { question: "x" } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/copilot/ask`, cookies: s.cookies, payload: { question: "x" } })).statusCode).toBe(403);
    expect((await call("POST", `/api/properties/${pid}/copilot/ask`, { question: "" })).statusCode).toBe(400);
    expect((await call("POST", `/api/properties/${pid}/copilot/ask`, { question: "x".repeat(301) })).statusCode).toBe(400);
    await ask("Which tariff am I on? my secret phrase zebra");
    const logged = await db().auditLog.findMany({ where: { action: "copilot.ask" } });
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0]!.detail)).not.toContain("zebra");
    expect(logged[0]!.detail).toMatchObject({ status: "UNAVAILABLE", tools: ["getTariff"], generatedBy: "TEMPLATES" });
  });
});
