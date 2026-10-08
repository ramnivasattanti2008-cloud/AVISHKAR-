/**
 * What the Copilot can answer without a language model (spec sections 44, 90): a fixed set of questions, each routed by plain
 * patterns to the backend tools that hold the answer, and worded from what those tools returned. Every figure in a sentence comes
 * from a tool result and is marked with the number of the result it came from, so the person can open the supporting data. A
 * question that matches nothing is not guessed at: the answer lists what can be asked.
 */
import { local } from "../plan/horizon.js";
import type { ToolName, ToolResult } from "./tools.js";

export const INTENTS = ["MAKE_PLAN", "WHY_DECISION", "WHAT_IF", "SAVINGS", "COUNTERFACTUAL", "OUTAGE", "SUBSIDY", "OPPORTUNITIES", "SOLAR", "LOAD", "TARIFF", "BATTERY", "WEATHER", "ACCURACY"] as const;
export type Intent = (typeof INTENTS)[number];

export interface Route {
  intent: Intent;
  calls: { tool: ToolName; input: unknown }[];
}

export const SUGGESTIONS = [
  "Why did the plan charge the battery at 11 pm?",
  "How much will I save?",
  "What will my solar make tomorrow?",
  "How much electricity will I use tomorrow?",
  "What should I change?",
  "How long could my battery keep my critical loads going in a power cut?",
  "What would the subsidy be for 3 kWp of solar?",
  "What would adding 3 kWp of solar do over a year?",
  "What would this cost without the plan?",
  "Which tariff am I on?",
  "How charged is my battery?",
  "How have the forecasts done?",
];

const has = (q: string, re: RegExp) => re.test(q);
const MODES: [RegExp, string][] = [
  [/save money|cheapest|lowest bill/, "SAVE_MONEY"],
  [/independen/, "INDEPENDENCE"],
  [/resilien|backup/, "RESILIENCE"],
  [/\bgreen\b|low carbon/, "GREEN"],
  [/revenue|earn/, "REVENUE"],
];

/** The hour of the day (0 to 23) a question names: "11 pm", "at 6", "23:00". Null when it names none. */
export function hourIn(q: string): number | null {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(q);
  if (ampm) {
    const h = Number(ampm[1]) % 12;
    return ampm[3]!.toLowerCase().startsWith("p") ? h + 12 : h;
  }
  const clock = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(q);
  if (clock) return Number(clock[1]);
  const at = /\bat (\d{1,2})\b/i.exec(q);
  if (at && Number(at[1]) <= 23) return Number(at[1]);
  return null;
}

/** A size in the question: "3 kWp of solar" or "a 10 kWh battery". */
export function sizeIn(q: string): { solarKwp?: number; batteryKwh?: number } | null {
  const solar = /(\d+(?:\.\d+)?)\s*kwp\b/i.exec(q) ?? /(\d+(?:\.\d+)?)\s*kw\b[^.?]*\b(solar|panel)/i.exec(q);
  const batt = /(\d+(?:\.\d+)?)\s*kwh\b/i.exec(q);
  if (!solar && !batt) return null;
  return { ...(solar ? { solarKwp: Number(solar[1]) } : {}), ...(batt ? { batteryKwh: Number(batt[1]) } : {}) };
}

/** Which question this is, and which tools answer it. Null when it is not one of the questions it can answer. */
export function route(question: string): Route | null {
  const q = question.trim().toLowerCase();
  if (q.length === 0) return null;
  if (has(q, /\b(make|create|run|generate|build|start)\b.*\bplan\b|\bnew plan\b/)) {
    const mode = MODES.find(([re]) => re.test(q))?.[1] ?? "BALANCED";
    return { intent: "MAKE_PLAN", calls: [{ tool: "runOptimization", input: { mode, hours: has(q, /\b48\b|two days|2 days/) ? 48 : 24 } }] };
  }
  const size = sizeIn(q);
  // a subsidy question names a size too, so it is recognised before a what-if
  if (has(q, /\b(subsid|surya ghar|incentive|grant)/)) {
    return { intent: "SUBSIDY", calls: [{ tool: "getEligibility", input: { systemKwp: size?.solarKwp ?? Number(/(\d+(?:\.\d+)?)\s*kw\b/.exec(q)?.[1] ?? 3) } }] };
  }
  if (size && has(q, /\b(add|install|buy|get|put|what if|would|if i)\b/)) {
    return { intent: "WHAT_IF", calls: [{ tool: "runSimulation", input: { ...(size.solarKwp ? { addSolarKwp: size.solarKwp } : {}), ...(size.batteryKwh ? { addBatteryKwh: size.batteryKwh } : {}) } }] };
  }
  if (has(q, /\bwhy\b|\bexplain\b|\bhow come\b/)) return { intent: "WHY_DECISION", calls: [{ tool: "getLatestPlan", input: {} }] };
  if (has(q, /\b(without|no control|do nothing|counterfactual|compared (to|with)|if i had not|if i hadn't)\b/)) return { intent: "COUNTERFACTUAL", calls: [{ tool: "getCounterfactual", input: {} }] };
  if (has(q, /\b(outage|blackout|power cut|load ?shedding|backup|critical)\b/)) return { intent: "OUTAGE", calls: [{ tool: "getResilience", input: {} }] };
  if (has(q, /\baccura|\bhow (good|well)\b|\bforecasts? (done|do)\b|\berror/)) return { intent: "ACCURACY", calls: [{ tool: "getForecastAccuracy", input: {} }] };
  if (has(q, /\b(save|saving|savings|how much (will|would|did|do) i)\b/)) return { intent: "SAVINGS", calls: [{ tool: "getLatestPlan", input: {} }] };
  if (has(q, /\b(what should i|what can i|improve|opportunit|worth (doing|it)|recommend|advice)\b/)) return { intent: "OPPORTUNITIES", calls: [{ tool: "getEnergyOpportunities", input: {} }] };
  if (has(q, /\b(solar|panel|sun|generat)/) && !has(q, /\b(weather|cloud)/)) return { intent: "SOLAR", calls: [{ tool: "getSolarForecast", input: { days: 3 } }] };
  if (has(q, /\b(use|usage|consum|demand|load)\b/) && has(q, /\b(tomorrow|today|next|will|forecast|expect)\b/)) return { intent: "LOAD", calls: [{ tool: "getLoadForecast", input: { hours: 24 } }] };
  if (has(q, /\b(battery|charge|state of charge|soc)\b/)) return { intent: "BATTERY", calls: [{ tool: "getBatteryState", input: {} }] };
  if (has(q, /\b(tariff|rate|price|per unit|bill)\b/)) return { intent: "TARIFF", calls: [{ tool: "getTariff", input: {} }] };
  if (has(q, /\b(weather|cloud|rain|temperature|forecast)\b/)) return { intent: "WEATHER", calls: [{ tool: "getWeather", input: {} }] };
  return null;
}

// ----------------------------------------------------------------------------------------------------------- wording

export interface Citation {
  marker: number;
  toolResultId: string;
  tool: ToolName;
}

export interface Rendered {
  status: "ANSWERED" | "UNAVAILABLE";
  paragraphs: string[];
  citations: Citation[];
}

class Writer {
  readonly citations: Citation[] = [];
  readonly paragraphs: string[] = [];
  cite(r: ToolResult): string {
    let c = this.citations.find((x) => x.toolResultId === r.id);
    if (!c) {
      c = { marker: this.citations.length + 1, toolResultId: r.id, tool: r.tool };
      this.citations.push(c);
    }
    return `[${c.marker}]`;
  }
  p(text: string): void {
    this.paragraphs.push(text);
  }
}

const inr = (v: number): string => `₹${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : (Math.round(v * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
const num = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en-IN", { maximumFractionDigits: d });
const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
const localHour = (iso: string): number => local(Date.parse(iso)).hour;
const KIND: Record<string, string> = {
  charge_battery: "charge the battery",
  discharge_battery: "use the battery",
  export: "sell to the grid",
  curtail: "leave solar unused",
  ev_charge: "charge the car",
  appliance: "run an appliance",
  import_peak: "buy from the grid at a high price",
  shed: "switch off non-critical load",
};

interface Dec {
  time: string;
  kind: string;
  kwh: number;
  reason: string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool outputs are shaped in tools.ts; the wording reads them by name, and the tests check every number it writes against them
type Out = Record<string, any>;

const unavailable = (w: Writer, r: ToolResult, hint?: string): Rendered => {
  w.p(`I cannot answer that from what is on file: ${r.unavailableReason ?? "the data is not available"} ${w.cite(r)}${hint ? ` ${hint}` : ""}`);
  return { status: "UNAVAILABLE", paragraphs: w.paragraphs, citations: w.citations };
};

const sentence = (s: string): string => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** Word an answer from the tool results of its route. Pure: the same results give the same words. */
export function render(intent: Intent, question: string, results: ToolResult[]): Rendered {
  const w = new Writer();
  const r = results[0]!;
  if (r.status === "UNAVAILABLE" || r.output === null) {
    const hints: Partial<Record<Intent, string>> = {
      WHY_DECISION: "Ask me to make a plan and I will explain it.",
      SAVINGS: "Ask me to make a plan and I will say what it saves.",
    };
    return unavailable(w, r, hints[intent]);
  }
  const o = r.output as Out;
  const c = w.cite(r);
  switch (intent) {
    case "MAKE_PLAN": {
      w.p(`I made a ${String(o.mode).toLowerCase().replace("_", " ")} plan for the next ${o.hours} hours ${c}. It is expected to cost ${inr(o.netCostInr)} against ${inr(o.noControlCostInr)} with no control, a saving of ${inr(o.savingsInr)}.`);
      w.p("That is a simulated outcome of forecasts, not a measurement. You can see every decision on the Plan tab, or ask me why it did something.");
      break;
    }
    case "WHY_DECISION": {
      const decisions = o.decisions as Dec[];
      const hour = hourIn(question);
      if (hour !== null) {
        const at = decisions.filter((d) => localHour(d.time) === hour);
        if (at.length > 0) {
          for (const d of at) w.p(`At ${hourLabel(hour)} the plan chose to ${KIND[d.kind] ?? d.kind} (${num(d.kwh, 2)} kWh): ${sentence(d.reason)} ${c}`);
          w.p("Reasons come from the planner's own figures for that hour (the prices, the solar and the load it was given), not from a guess.");
        } else {
          w.p(`The plan made no change at ${hourLabel(hour)}: it matches what that hour would do anyway ${c}. ${decisions[0] ? `Its first decision is at ${hourLabel(localHour(decisions[0].time))}: ${KIND[decisions[0].kind] ?? decisions[0].kind}.` : ""}`.trim());
        }
      } else if (decisions.length === 0) {
        w.p(`The latest plan changes nothing: with this tariff and equipment it matches how the day would run anyway ${c}.`);
      } else {
        const top = [...decisions].sort((a, b) => b.kwh - a.kwh).slice(0, 3);
        w.p(`The latest plan (${String(o.mode).toLowerCase().replace("_", " ")}, ${o.hours} hours) made ${o.totalDecisions} decisions ${c}. The largest:`);
        for (const d of top) w.p(`At ${hourLabel(localHour(d.time))} it chose to ${KIND[d.kind] ?? d.kind} (${num(d.kwh, 2)} kWh): ${sentence(d.reason)}`);
        w.p("Ask about a particular hour, for example 'why did the plan charge the battery at 11 pm?'.");
      }
      break;
    }
    case "SAVINGS": {
      w.p(`The latest plan (${String(o.mode).toLowerCase().replace("_", " ")}, made ${new Date(String(o.madeAt)).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}) is expected to cost ${inr(o.netCostInr)} over ${o.hours} hours against ${inr(o.noControlCostInr)} with no control: it saves ${inr(o.savingsInr)} ${c}.`);
      const a = (o.assumptions as string[])[0];
      w.p(`That is a simulated outcome of forecasts, not a measurement.${a ? ` One assumption it rests on: ${sentence(a)}` : ""}`);
      break;
    }
    case "WHAT_IF": {
      const money = o.investmentInr !== null ? `You would pay ${inr(o.investmentInr)}.` : "No price was given, so there is no payback: enter a quote on the What-if tab to see it.";
      w.p(`${o.name}: over a typical year it ${o.annualSavingsInr >= 0 ? "saves" : "costs"} about ${inr(Math.abs(o.annualSavingsInr))}${o.savingsPercent !== null ? ` (${num(o.savingsPercent)}% of the planned bill)` : ""} ${c}. ${money}`);
      if (o.subsidyInr !== null) w.p(`If you qualify, the published subsidy could pay about ${inr(o.subsidyInr)} on the solar; that is not netted off anything.`);
      w.p("This is an estimate for a typical year, not a forecast, and it is saved under What if so you can compare it.");
      break;
    }
    case "COUNTERFACTUAL": {
      const parts: string[] = [];
      if (o.plan) parts.push(`The latest plan costs ${inr(o.plan.plannedCostInr)} against ${inr(o.plan.noControlCostInr)} for the same ${o.plan.hours} hours with no control, saving ${inr(o.plan.savingsInr)}.`);
      if (o.scenario) {
        const t = o.scenario.today;
        parts.push(`Over a typical year your setup costs ${inr(t.plannedCostInr)} planned, ${inr(t.noControlCostInr)} with no control, and ${inr(t.noEquipmentCostInr)} with no solar and no battery.`);
      }
      w.p(`${parts.join(" ")} ${c}`);
      w.p("These are simulated comparisons, not measurements of what you actually paid.");
      break;
    }
    case "OUTAGE": {
      w.p(`Your batteries hold ${num(o.batteryUsableKwh, 1)} kWh of usable energy and your critical loads draw ${num(o.criticalKw, 2)} kW, so fully charged they could carry those loads for about ${num(o.hoursAtFullCharge, 1)} hours ${c}.`);
      if (o.hoursAtCurrentCharge !== null) w.p(`At the charge you last entered it would be about ${num(o.hoursAtCurrentCharge, 1)} hours.`);
      w.p("That counts the batteries only, not solar during the outage, and no outage has been forecast: no outage data is available.");
      break;
    }
    case "SUBSIDY": {
      const pm = o.pmSuryaGhar;
      if (pm && pm.subsidyInr !== null) w.p(`The published PM Surya Ghar schedule applied to ${num(o.systemKwp, 1)} kWp for a ${String(o.consumerType).toLowerCase()} connection gives about ${inr(pm.subsidyInr)} ${c}. ${pm.caveats[0] ? sentence(pm.caveats[0]) : ""}`.trim());
      else w.p(`I cannot state a subsidy for ${num(o.systemKwp, 1)} kWp: ${pm ? `the rule on file gives no amount (${String(pm.outcome).toLowerCase().replaceAll("_", " ")})` : "no sourced rule applies"} ${c}.`);
      w.p(`Whether you qualify is decided by your distribution company and the national portal. ${o.netMetering.caveat ? sentence(o.netMetering.caveat) : ""}`.trim());
      break;
    }
    case "OPPORTUNITIES": {
      const items = (o.items as Out[]).filter((i) => i.annualSavingsInr !== null);
      const data = (o.items as Out[]).filter((i) => i.annualSavingsInr === null);
      if (items.length > 0) {
        w.p(`Tried on your typical year ${c}:`);
        for (const i of items.slice(0, 4)) w.p(`${i.title}: about ${inr(i.annualSavingsInr)} a year${i.breakEven ? `; worth it if a quote is below ${inr(i.breakEven.perUnitInr)} per ${i.breakEven.unit}` : ""}.`);
      } else w.p(`None of the example changes I tried saved enough to list ${c}.`);
      for (const d of data.slice(0, 2)) w.p(`${d.title}: ${sentence(d.detail)}`);
      w.p("AVISHKAR has no price list, so the figure to compare with a quote is the most it could cost and still repay itself.");
      break;
    }
    case "SOLAR": {
      const e = o.energyKwh;
      w.p(`Your solar is forecast to make about ${num(e.p50, 1)} kWh over the next ${num(o.periodHours / 24, 0)} days${e.p10 !== null ? `, probably between ${num(e.p10, 1)} and ${num(e.p90, 1)} kWh` : ""} ${c}. The best hour is at ${hourLabel(localHour(o.peak.time))}, at about ${num(o.peak.kw, 1)} kW.`);
      if (!o.bandAvailable) w.p("I do not state a range: there is not enough record of how wrong this weather forecast has been here to calibrate one.");
      break;
    }
    case "LOAD": {
      w.p(`You are expected to use about ${num(o.energyKwh, 1)} kWh over the next ${o.periodHours} hours, peaking at about ${num(o.peak.kw, 1)} kW around ${hourLabel(localHour(o.peak.time))} ${c}.${o.meanErrorKw !== null ? ` The method used (${String(o.method).replaceAll("_", " ")}) was off by about ${num(o.meanErrorKw, 2)} kW on average on days it had not seen.` : ""}`);
      if (o.dataEndsDaysAgo !== null && o.dataEndsDaysAgo > 2) w.p("Your meter readings end days ago, so this is what the model expects for the hours after them, not for tomorrow.");
      break;
    }
    case "TARIFF": {
      const rates = o.hourlyRatesInr as number[];
      w.p(`You are on ${o.name}${o.state ? ` (${o.state})` : ""} ${c}. Energy costs between ${inr(Math.min(...rates))} and ${inr(Math.max(...rates))} per kWh depending on the hour; exported energy is credited at ${o.exportRateInr === null ? "nothing" : inr(o.exportRateInr)} (${o.exportBasis === "ASSUMPTION" ? "an assumption: the source states no export rate" : o.exportBasis === "USER_ENTERED" ? "entered by you" : "from the tariff's source"}).`);
      w.p(`${o.validity.message}`);
      break;
    }
    case "BATTERY": {
      const bs = o.batteries as Out[];
      if (bs.length === 0) w.p(`No battery is entered for this property ${c}.`);
      for (const b of bs)
        w.p(`${b.name}: ${num(b.capacityKwh, 1)} kWh (${num(b.usableKwh, 1)} kWh usable)${b.chargeEnteredPercent !== null ? `, charge last entered ${num(b.chargeEnteredPercent, 0)}%, ${num(b.chargeEnteredHoursAgo, 1)} hours ago` : ", no charge entered"} ${c}.`);
      w.p(String(o.note));
      break;
    }
    case "WEATHER": {
      const cur = o.current;
      const bits = [cur.airTemperatureC && `${num(cur.airTemperatureC.value, 1)} °C`, cur.cloudCoverPct && `${num(cur.cloudCoverPct.value, 0)}% cloud`].filter(Boolean);
      w.p(`Right now the weather model has ${bits.join(" and ") || "no current values"} at your property ${c}. In the next ${o.next24h.hours} hours sunlight peaks at about ${o.next24h.peakIrradianceWm2 ? num(o.next24h.peakIrradianceWm2.value, 0) : "?"} W/m².`);
      w.p(String(o.note));
      break;
    }
    case "ACCURACY": {
      const s = o.summary;
      if (s) w.p(`${s.scored} stored forecast(s) have been scored against the readings that followed them: typical error ${num(s.meanMaeKw, 2)} kW, with the 10 to 90% band holding on ${num(s.meanCoverage80 * 100, 0)}% of hours ${c}.`);
      else w.p(`No stored forecast has been scored yet ${c}; ${o.waitingRuns} are waiting for newer readings.`);
      w.p(String(o.solar));
      break;
    }
  }
  return { status: "ANSWERED", paragraphs: w.paragraphs, citations: w.citations };
}
