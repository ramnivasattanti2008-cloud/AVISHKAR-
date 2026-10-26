import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, control, fakeApi, json, property, proposal } from "@/test/fixtures";
import type { Control } from "@/lib/types";
import { ControlView } from "./ControlView";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "me@example.com", role: "USER", displayName: null } as { id: string; email: string; role: string; displayName: string | null } | null }));
vi.mock("../AuthProvider", () => ({ useAuth: () => ({ user: auth.user, loading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }) }));

const base = `/api/properties/${PROPERTY_ID}`;
const yes = { allowed: true, reason: null };
const no = (reason: string) => ({ allowed: false, reason });

function world(initial: Control = control(), extra: [string, string | RegExp, () => Response][] = []) {
  const api = fakeApi([
    ["GET", base, () => json(property())],
    ["GET", `${base}/twin`, () => json({ error: { code: "NOT_FOUND", message: "none" } }, 404)],
    ["GET", `${base}/control`, () => json(initial)],
    ...extra,
  ]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

beforeEach(() => {
  auth.user = { id: "u1", email: "me@example.com", role: "USER", displayName: null };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ControlView", () => {
  it("says no device is connected, in plain words, before anything else", async () => {
    world();
    render(<ControlView id={PROPERTY_ID} />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("No device is connected.");
    expect(note).toHaveTextContent("changes nothing, because there is nothing for it to act on");
  });

  it("offers the four modes, marks the current one, and shows Automate as unavailable with the reason", async () => {
    world();
    render(<ControlView id={PROPERTY_ID} />);
    const sec = await screen.findByRole("region", { name: "How much AVISHKAR may do" });
    const radios = within(sec).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["OBSERVE", "RECOMMEND", "APPROVE", "AUTOMATE"]);
    expect(within(sec).getByRole("radio", { name: /Approve/ })).toBeChecked();
    const automate = within(sec).getByRole("radio", { name: /Automate/ });
    expect(automate).toBeDisabled();
    expect(within(sec).getByText(/No device is connected to AVISHKAR, so there is nothing for it to act on\./, { selector: "span.text-xs" })).toBeInTheDocument();
  });

  it("saves the mode and the limits that were typed, as numbers, and empty limits as none", async () => {
    const saved = control({ mode: "RECOMMEND", limits: { maxChargeKw: 3, maxDischargeKw: null, minSocPercent: 15 }, updatedAt: "2026-10-08T10:00:00.000Z" });
    const api = world(control(), [["PUT", `${base}/control`, () => json(saved)]]);
    render(<ControlView id={PROPERTY_ID} />);
    await screen.findByRole("region", { name: "How much AVISHKAR may do" });
    await userEvent.click(screen.getByRole("radio", { name: /Recommend/ }));
    await userEvent.type(screen.getByLabelText("Most charge power, kW"), "3");
    await userEvent.type(screen.getByLabelText("Never below this charge, %"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(api.called("PUT", `${base}/control`)[0]!.body).toEqual({ mode: "RECOMMEND", maxChargeKw: 3, maxDischargeKw: null, minSocPercent: 15 });
    expect(screen.getByLabelText("Most charge power, kW")).toHaveValue("3");
  });

  it("does not call the server for a limit that is not one", async () => {
    const api = world();
    render(<ControlView id={PROPERTY_ID} />);
    await screen.findByRole("region", { name: "How much AVISHKAR may do" });
    await userEvent.type(screen.getByLabelText("Most charge power, kW"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The most charge power must be a number above 0");
    await userEvent.clear(screen.getByLabelText("Most charge power, kW"));
    await userEvent.type(screen.getByLabelText("Never below this charge, %"), "150");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The lowest charge must be between 0 and 100 percent");
    expect(api.called("PUT", `${base}/control`)).toHaveLength(0);
  });

  it("asks for an explicit authorization with an end before Automate is saved, when a device exists", async () => {
    const withDevice = control({ executor: { name: "test inverter", available: true, message: "Connected: test inverter." }, modes: control().modes.map((m) => (m.mode === "AUTOMATE" ? { ...m, available: true, unavailableReason: null } : m)) });
    const api = world(withDevice, [["PUT", `${base}/control`, () => json(control({ ...withDevice, mode: "AUTOMATE", automateUntil: "2026-10-09T10:00:00.000Z" }))]]);
    render(<ControlView id={PROPERTY_ID} />);
    await screen.findByRole("region", { name: "How much AVISHKAR may do" });
    expect(screen.getByRole("note")).toHaveTextContent("A device is connected.");
    await userEvent.click(screen.getByRole("radio", { name: /Automate/ }));
    const hours = screen.getByLabelText("Your authorization lasts, hours (at most 720)");
    expect(hours).toHaveValue("24");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /I authorise AVISHKAR to make moves/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.called("PUT", `${base}/control`)[0]!.body).toMatchObject({ mode: "AUTOMATE", automateHours: 24, confirmAutomate: false }); // sent as asked: the server refuses it
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api.called("PUT", `${base}/control`)[1]!.body).toMatchObject({ confirmAutomate: true });
    expect(await screen.findByText(/Automate is authorised until/)).toBeInTheDocument();
  });

  it("lists each move with its time, its size, the planner's reason and its safety checks", async () => {
    world();
    render(<ControlView id={PROPERTY_ID} />);
    const list = await screen.findByRole("list", { name: "Proposed moves" });
    const card = within(list).getAllByRole("listitem")[0]!;
    expect(within(card).getByText("Charge the battery")).toBeInTheDocument();
    expect(within(card).getByText("PROPOSED")).toBeInTheDocument();
    expect(within(card).getByText(/6 kWh at up to 3 kW/)).toBeInTheDocument();
    expect(within(card).getByText(/Why: charged from the grid at INR 4\.00 per kWh/)).toBeInTheDocument();
    expect(within(card).getByText(/Safety checks: all passed/)).toBeInTheDocument();
    expect(within(card).getByText(/Passed: device power limit\. 3 kW against the battery's own 5 kW\./)).toBeInTheDocument();
  });

  it("approves a move and shows what the device answered", async () => {
    const approved = proposal({ state: "APPROVED", decidedAt: "2026-10-07T10:12:00.000Z", decidedBy: "me@example.com", result: { applied: false, message: "No device is connected to AVISHKAR, so nothing was changed. Your approval is recorded." }, can: { approve: no("It is already approved."), reject: no("It is already approved."), withdraw: yes, rollback: no("It has not started: withdraw it instead.") } });
    const api = world(control(), [["POST", new RegExp(`${base}/control/proposals/.+/approve`) as unknown as string, () => json(control({ proposals: [approved] }))]]);
    render(<ControlView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Approve: Charge the battery/ }));
    expect(await screen.findByText(/Your approval is recorded\./)).toBeInTheDocument();
    expect(api.called("POST", `${base}/control/proposals/c1000000-0000-4000-8000-000000000001/approve`)).toHaveLength(1);
    expect(screen.getByText("APPROVED")).toBeInTheDocument();
    expect(screen.getByText(/me@example\.com marked it approved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Withdraw: / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve: / })).not.toBeInTheDocument();
  });

  it("gives no approve button for a move that cannot be approved, and says why instead", async () => {
    const advice = proposal({ can: { approve: no("The mode is Recommend: moves are advice only. Switch to Approve to decide on them."), reject: yes, withdraw: no("x"), rollback: no("y") } });
    world(control({ mode: "RECOMMEND", proposals: [advice] }));
    render(<ControlView id={PROPERTY_ID} />);
    const card = (await screen.findByRole("list", { name: "Proposed moves" })).querySelector("li")!;
    expect(within(card).queryByRole("button", { name: /^Approve: / })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /^Reject: / })).toBeInTheDocument();
    expect(within(card).getByText(/Approve: The mode is Recommend: moves are advice only/)).toBeInTheDocument();
  });

  it("marks a move that breaks a limit, shows which check failed, and offers only to dismiss it", async () => {
    const blocked = proposal({
      state: "BLOCKED",
      safety: { ok: false, checks: [{ check: "your power limit", ok: false, detail: "3 kW against the 2 kW you set." }] },
      can: { approve: no("It breaks a safety limit, so it cannot be approved."), reject: yes, withdraw: no("a"), rollback: no("b") },
    });
    world(control({ proposals: [blocked] }));
    render(<ControlView id={PROPERTY_ID} />);
    const card = (await screen.findByRole("list", { name: "Proposed moves" })).querySelector("li")!;
    expect(within(card).getByText("BLOCKED")).toBeInTheDocument();
    expect(within(card).getByText("a limit is broken")).toBeInTheDocument();
    expect(within(card).getByText(/Broken: your power limit\. 3 kW against the 2 kW you set\./)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^Approve: / })).not.toBeInTheDocument();
    expect(within(card).getByText(/Approve: It breaks a safety limit/)).toBeInTheDocument();
  });

  it("shows an error the server gives, such as a move that cannot be approved now", async () => {
    world(control(), [["POST", new RegExp(`${base}/control/proposals/.+/approve`) as unknown as string, () => json({ error: { code: "CONTROL_MODE", message: "It has expired: its time has passed." } }, 409)]]);
    render(<ControlView id={PROPERTY_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: /^Approve: / }));
    expect(await screen.findByRole("alert")).toHaveTextContent("It has expired: its time has passed.");
  });

  it("proposes the plan's moves, and says how many were new", async () => {
    const api = world(control({ proposals: [] }), [["POST", `${base}/control/proposals`, () => json({ created: 3, skipped: 1, control: control() })]]);
    render(<ControlView id={PROPERTY_ID} />);
    expect(await screen.findByText(/No moves yet\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Propose the plan's moves" }));
    expect(await screen.findByRole("status")).toHaveTextContent("3 moves proposed from the latest plan, 1 already listed.");
    expect(api.called("POST", `${base}/control/proposals`)).toHaveLength(1);
  });

  it("disables proposing in Observe, with the reason beside it", async () => {
    world(control({ mode: "OBSERVE", proposals: [] }));
    render(<ControlView id={PROPERTY_ID} />);
    const button = await screen.findByRole("button", { name: "Propose the plan's moves" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/The mode is Observe: AVISHKAR proposes no moves/)).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription(/The mode is Observe/);
  });

  it("sends you to sign in when you are not", async () => {
    auth.user = null;
    world();
    render(<ControlView id={PROPERTY_ID} />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/property/${PROPERTY_ID}/control`);
  });
});
