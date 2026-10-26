import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeviceExecutor, ExecutionResult, ExecutorProposal } from "../src/control/executor.js";
import { EngineClient } from "../src/engine/client.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;
const DAY = 86_400_000;
const HOUR = 3_600_000;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };

/** A device that really exists, for testing what happens when one does: it records what it was asked and can be made to fail. */
class FakeDevice implements DeviceExecutor {
  readonly name = "test inverter";
  readonly available = true;
  applied: string[] = [];
  reverted: string[] = [];
  failApply = false;
  failRevert = false;
  async apply(p: ExecutorProposal): Promise<ExecutionResult> {
    if (this.failApply) throw new Error("the inverter did not answer");
    this.applied.push(p.id);
    return { applied: true, message: `Applied ${p.kind} to the test inverter.` };
  }
  async revert(p: ExecutorProposal): Promise<ExecutionResult> {
    if (this.failRevert) throw new Error("the inverter did not answer");
    this.reverted.push(p.id);
    return { applied: false, message: `Undid ${p.kind} on the test inverter.` };
  }
}

function harness(device: DeviceExecutor | null) {
  const ctx = {} as { t: TestApp; s: Session; pid: string };
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, session: Session | null = ctx.s) =>
    ctx.t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  beforeEach(async () => {
    await resetDb();
    ctx.t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 120_000 }), executor: device });
    ctx.t.clock.now = new Date("2026-10-07T10:10:00Z"); // 15:40 IST
    ctx.t.setFetch(router(() => ctx.t.clock.now));
    ctx.s = await register(ctx.t, "control@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    await call("PUT", `/api/properties/${ctx.pid}/tariff`, { tariffPlanId: tariff.id });
    const istToday = new Date(ctx.t.clock.now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - 70 * DAY).toISOString().slice(0, 10);
    await call("POST", `/api/properties/${ctx.pid}/energy/imports`, { csv: meterCsv({ start, days: 70, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }), filename: "m.csv" });
    await call("POST", `/api/properties/${ctx.pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    await call("POST", `/api/properties/${ctx.pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
  });
  const url = (path = "") => `/api/properties/${ctx.pid}/control${path}`;
  const plan = async () => expect((await call("POST", `/api/properties/${ctx.pid}/plan`, { mode: "SAVE_MONEY" })).statusCode).toBe(201);
  const setMode = async (body: Record<string, unknown>) => {
    const res = await call("PUT", url(), body);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const propose = async () => {
    const res = await call("POST", url("/proposals"));
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const act = (id: string, action: string, note?: string) => call("POST", url(`/proposals/${id}/${action}`), note ? { note } : {});
  /** The proposals after an action that is expected to work: a failure says what the server answered. */
  const after = async (id: string, action: string, note?: string) => {
    const res = await act(id, action, note);
    expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
    return (res.json().proposals as { id: string }[]).find((x) => x.id === id) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { ctx, call, url, plan, setMode, propose, act, after };
}

describeBoth("human control, with no device connected (what AVISHKAR has today)", () => {
  const { ctx, call, url, plan, setMode, propose, act, after } = harness(null);

  it("starts in Recommend, says no device is connected, and offers Automate only as unavailable, with the reason", async () => {
    const c = (await call("GET", url())).json();
    expect(c.mode).toBe("RECOMMEND");
    expect(c.executor).toMatchObject({ name: "none", available: false });
    expect(c.executor.message).toContain("No device is connected");
    expect(c.modes.map((m: { mode: string }) => m.mode)).toEqual(["OBSERVE", "RECOMMEND", "APPROVE", "AUTOMATE"]);
    const auto = c.modes.find((m: { mode: string }) => m.mode === "AUTOMATE");
    expect(auto).toMatchObject({ available: false });
    expect(auto.unavailableReason).toContain("No device is connected");
    expect(c.proposals).toEqual([]);
  });

  it("refuses Automate, saying why, however it is asked for", async () => {
    const res = await call("PUT", url(), { mode: "AUTOMATE", confirmAutomate: true, automateHours: 24 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONTROL_UNAVAILABLE");
    expect(res.json().error.message).toContain("No device is connected");
    expect((await call("GET", url())).json().mode).toBe("RECOMMEND");
  });

  it("in Observe proposes nothing, and says so", async () => {
    await plan();
    await setMode({ mode: "OBSERVE" });
    const res = await call("POST", url("/proposals"));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONTROL_MODE");
    expect(res.json().error.message).toContain("Observe");
  });

  it("needs a plan before there is anything to propose", async () => {
    const res = await call("POST", url("/proposals"));
    expect(res.statusCode).toBe(404);
  });

  it("in Recommend shows the moves as advice with the planner's reasons, and approving one is refused, with the reason", async () => {
    await plan();
    const r = await propose();
    expect(r.created).toBeGreaterThan(0);
    const p = r.control.proposals.find((x: { kind: string }) => x.kind === "BATTERY_CHARGE") ?? r.control.proposals[0];
    expect(p.state).toBe("PROPOSED");
    expect(p.reason.length).toBeGreaterThan(10);
    expect(p.safety.ok).toBe(true);
    expect(p.can.approve).toMatchObject({ allowed: false });
    expect(p.can.approve.reason).toContain("advice only");
    expect(p.can.reject.allowed).toBe(true);
    const res = await act(p.id, "approve");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONTROL_MODE");
    const rejected = await after(p.id, "reject", "not tonight");
    expect(rejected).toMatchObject({ state: "REJECTED", decidedBy: "control@example.com", decisionNote: "not tonight" });
  });

  it("does not propose the same move twice", async () => {
    await plan();
    const first = await propose();
    const second = await propose();
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(first.created);
    expect(second.control.proposals).toHaveLength(first.created);
  });

  it("in Approve records the decision and the executor's honest answer: nothing was changed, because no device exists", async () => {
    await plan();
    await setMode({ mode: "APPROVE" });
    const r = await propose();
    const p = r.control.proposals[0];
    expect(p.can.approve.allowed).toBe(true);
    const done = await after(p.id, "approve");
    expect(done.state).toBe("APPROVED");
    expect(done.result).toEqual({ applied: false, message: "No device is connected to AVISHKAR, so nothing was changed. Your approval is recorded." });
    expect(done.decidedBy).toBe("control@example.com");
    expect(done.decidedAt).not.toBeNull();
    // approving twice is refused
    const again = await act(p.id, "approve");
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toContain("already approved");
  });

  it("withdraws an approved move before it starts, and rolls one back once it has started, saying nothing needed undoing", async () => {
    await plan();
    await setMode({ mode: "APPROVE" });
    const r = await propose();
    const future = r.control.proposals.find((x: { startsAt: string }) => Date.parse(x.startsAt) > ctx.t.clock.now.getTime())!;
    await act(future.id, "approve");
    const mid = (await call("GET", url())).json().proposals.find((x: { id: string }) => x.id === future.id);
    expect(mid.can.withdraw.allowed).toBe(true);
    expect(mid.can.rollback).toMatchObject({ allowed: false });
    expect(mid.can.rollback.reason).toContain("withdraw it instead");
    const w = await after(future.id, "withdraw");
    expect(w).toMatchObject({ state: "WITHDRAWN" });
    expect(w.result.message).toContain("nothing had been applied");

    // a second move, approved and then reached by the clock: rolled back, not withdrawn
    const other = r.control.proposals.find((x: { id: string }) => x.id !== future.id)!;
    await act(other.id, "approve");
    ctx.t.clock.now = new Date(Date.parse(other.startsAt) + 1000);
    const started = (await call("GET", url())).json().proposals.find((x: { id: string }) => x.id === other.id);
    expect(started.state).toBe("APPROVED");
    expect(started.can.withdraw.allowed).toBe(false);
    expect(started.can.rollback.allowed).toBe(true);
    const rb = await after(other.id, "rollback");
    expect(rb.state).toBe("ROLLED_BACK");
    expect(rb.result.message).toContain("Nothing had been applied to any device");
  });

  it("blocks a move that breaks a limit you set, shows which check failed and by how much, and will not approve it", async () => {
    await plan();
    await setMode({ mode: "APPROVE", maxChargeKw: 0.5, maxDischargeKw: 0.5 });
    const r = await propose();
    const blocked = r.control.proposals.filter((x: { state: string }) => x.state === "BLOCKED");
    expect(blocked.length).toBeGreaterThan(0);
    const b = blocked[0];
    expect(b.safety.ok).toBe(false);
    expect(b.safety.checks.find((c: { ok: boolean }) => !c.ok).detail).toMatch(/kW against the 0\.5 kW you set\./);
    expect(b.can.approve.allowed).toBe(false);
    expect(b.can.approve.reason).toContain("breaks a safety limit");
    const res = await act(b.id, "approve");
    expect(res.statusCode).toBe(409);
    expect(b.can.reject.allowed).toBe(true); // it can still be dismissed
  });

  it("lets time decide a move nobody decided on: it expires, and is never carried out later", async () => {
    await plan();
    await setMode({ mode: "APPROVE" });
    const r = await propose();
    const last = r.control.proposals.reduce((a: { endsAt: string }, b: { endsAt: string }) => (Date.parse(a.endsAt) > Date.parse(b.endsAt) ? a : b));
    ctx.t.clock.now = new Date(Date.parse(last.endsAt) + HOUR);
    const c = (await call("GET", url())).json();
    expect(c.proposals.every((x: { state: string }) => x.state === "EXPIRED")).toBe(true);
    expect(c.proposals[0].decisionNote).toBe("Its time passed with no decision.");
    expect(c.proposals[0].can.approve.reason).toContain("expired");
    expect((await act(c.proposals[0].id, "approve")).statusCode).toBe(409);
  });

  it("audits the mode, the proposals and every decision, and keeps the limits and the mode as set", async () => {
    await plan();
    await setMode({ mode: "APPROVE", maxChargeKw: 5, minSocPercent: 5 }); // limits the plan already keeps to
    const r = await propose();
    await after(r.control.proposals[0].id, "approve");
    await after(r.control.proposals[1].id, "reject");
    const actions = (await db().auditLog.findMany({ where: { action: { startsWith: "control." } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["control.settings", "control.propose", "control.approve", "control.reject"]);
    const c = (await call("GET", url())).json();
    expect(c).toMatchObject({ mode: "APPROVE", limits: { maxChargeKw: 5, maxDischargeKw: null, minSocPercent: 5 } });
  });

  it("is private to its owner, needs a session and the CSRF header", async () => {
    const other = await register(ctx.t, "other@example.com");
    expect((await call("GET", url(), undefined, other)).statusCode).toBe(404);
    expect((await call("PUT", url(), { mode: "OBSERVE" }, other)).statusCode).toBe(404);
    expect((await call("GET", url(), undefined, null)).statusCode).toBe(401);
    expect((await ctx.t.app.inject({ method: "PUT", url: url(), cookies: ctx.s.cookies, payload: { mode: "OBSERVE" } })).statusCode).toBe(403);
    expect((await call("PUT", url(), { mode: "WILD" })).statusCode).toBe(400);
    expect((await call("PUT", url(), { mode: "APPROVE", minSocPercent: 120 })).statusCode).toBe(400);
    expect((await call("PUT", url(), { mode: "APPROVE", maxChargeKw: 0 })).statusCode).toBe(400);
  });

  it("is held by the database too: a blocked move can never be stored as approved, and nor can an Automate without an end", async () => {
    await plan();
    await setMode({ mode: "APPROVE", maxChargeKw: 0.5 });
    const r = await propose();
    const b = r.control.proposals.find((x: { state: string }) => x.state === "BLOCKED");
    await expect(db().$executeRawUnsafe(`UPDATE control_proposals SET state = 'APPROVED', decided_at = now() WHERE id = '${b.id}'`)).rejects.toThrow(/control_proposals_blocked_never_approved/);
    await expect(db().$executeRawUnsafe(`UPDATE control_settings SET mode = 'AUTOMATE' WHERE property_id = '${ctx.pid}'`)).rejects.toThrow(/control_settings_automate_ends/);
  });
});

describeBoth("human control, with a device connected", () => {
  const device = new FakeDevice();
  const { ctx, call, url, plan, setMode, propose, act, after } = harness(device);
  beforeEach(() => {
    device.applied = [];
    device.reverted = [];
    device.failApply = false;
    device.failRevert = false;
  });

  it("offers Automate, but only with an explicit authorization that has an end", async () => {
    const c = (await call("GET", url())).json();
    expect(c.executor).toMatchObject({ name: "test inverter", available: true });
    expect(c.modes.find((m: { mode: string }) => m.mode === "AUTOMATE")).toMatchObject({ available: true, unavailableReason: null });
    const noConfirm = await call("PUT", url(), { mode: "AUTOMATE", automateHours: 24 });
    expect(noConfirm.statusCode).toBe(400);
    expect(noConfirm.json().error.message).toContain("explicit authorization");
    expect((await call("PUT", url(), { mode: "AUTOMATE", confirmAutomate: true })).statusCode).toBe(400);
    expect((await call("PUT", url(), { mode: "AUTOMATE", confirmAutomate: true, automateHours: 1000 })).statusCode).toBe(400); // longer than 30 days
    const ok = await setMode({ mode: "AUTOMATE", confirmAutomate: true, automateHours: 24 });
    expect(ok.mode).toBe("AUTOMATE");
    expect(ok.automateUntil).toBe(new Date(ctx.t.clock.now.getTime() + 24 * HOUR).toISOString());
  });

  it("in Approve, applies an approved move through the device and rolls it back through the device", async () => {
    await plan();
    await setMode({ mode: "APPROVE" });
    const r = await propose();
    const p = r.control.proposals[0];
    const done = await after(p.id, "approve");
    expect(done.state).toBe("APPLIED");
    expect(done.result).toMatchObject({ applied: true });
    expect(device.applied).toEqual([p.id]);
    expect(done.can.withdraw.allowed).toBe(false);
    expect(done.can.rollback.allowed).toBe(true);
    const rb = await after(p.id, "rollback");
    expect(rb.state).toBe("ROLLED_BACK");
    expect(rb.result.message).toContain("Undid");
    expect(device.reverted).toEqual([p.id]);
  });

  it("records a device that could not be asked as FAILED, with what it said, and keeps an unrolled-back move as applied", async () => {
    await plan();
    await setMode({ mode: "APPROVE" });
    const r = await propose();
    device.failApply = true;
    const failed = (await act(r.control.proposals[0].id, "approve")).json().proposals.find((x: { id: string }) => x.id === r.control.proposals[0].id);
    expect(failed.state).toBe("FAILED");
    expect(failed.result.message).toContain("the inverter did not answer");
    device.failApply = false;
    const second = r.control.proposals[1];
    await act(second.id, "approve");
    device.failRevert = true;
    const res = await act(second.id, "rollback");
    expect(res.statusCode).toBe(503);
    const still = (await call("GET", url())).json().proposals.find((x: { id: string }) => x.id === second.id);
    expect(still.state).toBe("APPLIED"); // not marked undone when the device was never asked to undo it
  });

  it("under a valid Automate authorization makes the safe moves itself, records that it did and under what, and leaves blocked ones alone", async () => {
    await plan();
    await setMode({ mode: "AUTOMATE", confirmAutomate: true, automateHours: 12, maxChargeKw: 2.5 });
    const r = await propose();
    const states = r.control.proposals.map((x: { state: string }) => x.state);
    expect(states).toContain("APPLIED");
    for (const x of r.control.proposals) {
      if (x.state === "APPLIED") {
        expect(x.decidedBy).toBeNull(); // the system, not a person
        expect(x.decisionNote).toContain("Made automatically under your authorization until");
        expect(device.applied).toContain(x.id);
      } else {
        expect(x.state).toBe("BLOCKED");
        expect(device.applied).not.toContain(x.id);
      }
    }
    expect(await db().auditLog.count({ where: { action: "control.automatic" } })).toBe(states.filter((s: string) => s === "APPLIED").length);
  });

  it("stops acting when the authorization ends: the mode reads as Recommend again and new moves wait for a person", async () => {
    await plan();
    await setMode({ mode: "AUTOMATE", confirmAutomate: true, automateHours: 2 });
    ctx.t.clock.now = new Date(ctx.t.clock.now.getTime() + 3 * HOUR);
    const c = (await call("GET", url())).json();
    expect(c.mode).toBe("RECOMMEND");
    expect(c.automateUntil).toBeNull();
    await plan();
    const r = await propose();
    expect(device.applied).toEqual([]);
    expect(r.control.proposals.every((x: { state: string }) => x.state !== "APPLIED")).toBe(true);
  });
});
