import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { communityAllocation, fakeApi, json } from "@/test/fixtures";
import { AllocationWorkbench } from "./AllocationWorkbench";

/** Captures every request body the workbench sends, so a test can check what it actually asked the engine for. */
function world(answer: () => Response = () => json(communityAllocation())) {
  const api = fakeApi([["POST", "/api/community/allocate", answer]]);
  vi.stubGlobal("fetch", api.fetch);
  return api;
}

const sent = (api: ReturnType<typeof fakeApi>) => api.called("POST", "/api/community/allocate");
const lastBody = (api: ReturnType<typeof fakeApi>) => sent(api).at(-1)!.body as { members: { name: string; generationKw: number; demandKw: number; battery: unknown }[]; limits: Record<string, unknown> };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AllocationWorkbench", () => {
  it("works the first scenario out on arrival rather than showing an empty form", async () => {
    const api = world();
    render(<AllocationWorkbench />);
    expect(await screen.findByText(/COMMUNITY ALLOCATION SIMULATION/)).toBeInTheDocument();
    expect(sent(api)).toHaveLength(1);
    const body = lastBody(api);
    // The scenario the feature was specified against: 8/3, 2/4, 0/3.
    expect(body.members.map((m) => [m.generationKw, m.demandKw])).toEqual([
      [8, 3],
      [2, 4],
      [0, 3],
    ]);
  });

  it("shows what the engine returned: who received what, and that nothing was bought", async () => {
    world();
    render(<AllocationWorkbench />);
    const table = await screen.findByRole("table", { name: /What each property generated/ });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // header and three buildings
    const b = within(table).getByRole("rowheader", { name: "Building B" }).closest("tr")!;
    expect(within(b).getAllByRole("cell")[4]!).toHaveTextContent("2"); // received
    expect(screen.getByText("the community covered itself")).toBeInTheDocument();
  });

  it("labels the result a simulation and never calls it a measurement", async () => {
    world();
    render(<AllocationWorkbench />);
    expect(await screen.findByText("SIMULATED")).toBeInTheDocument();
    expect(screen.getByText(/not a measurement/)).toBeInTheDocument();
    expect(screen.getByText(/does not move electricity between properties/)).toBeInTheDocument();
  });

  it("explains each step and shows the energy-balance check", async () => {
    world();
    render(<AllocationWorkbench />);
    expect(await screen.findByText(/never allocated twice/)).toBeInTheDocument();
    expect(screen.getByText(/add up to its demand/)).toBeInTheDocument();
  });

  it("recalculates with the figure the person typed", async () => {
    const api = world();
    render(<AllocationWorkbench />);
    await screen.findByText(/COMMUNITY ALLOCATION SIMULATION/);
    const user = userEvent.setup();

    const a = screen.getByRole("group", { name: "Building A" });
    const gen = within(a).getByLabelText(/Generating \(kW\)/);
    await user.clear(gen);
    await user.type(gen, "12");
    // Until it is recalculated the page says so, rather than showing figures for the old inputs as if they were current.
    expect(screen.getByText(/Recalculate to bring them up to date/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recalculate" }));
    expect(sent(api)).toHaveLength(2);
    expect(lastBody(api).members[0]!.generationKw).toBe(12);
  });

  it("sends the chosen rule, battery policy and network limits", async () => {
    const api = world();
    render(<AllocationWorkbench />);
    await screen.findByText(/COMMUNITY ALLOCATION SIMULATION/);
    const user = userEvent.setup();

    const feeder = screen.getByLabelText(/Feeder limit \(kW\)/);
    await user.clear(feeder);
    await user.type(feeder, "3");
    await user.selectOptions(screen.getByLabelText(/When there is not enough to go round/), "CRITICAL_FIRST");
    await user.selectOptions(screen.getByLabelText(/A surplus goes to/), "BATTERY_FIRST");
    await user.click(screen.getByRole("button", { name: "Recalculate" }));

    expect(lastBody(api).limits).toMatchObject({ feederLimitKw: 3, rule: "CRITICAL_FIRST", batteryPolicy: "BATTERY_FIRST" });
  });

  it("switches scenario and asks the engine about the new figures", async () => {
    const api = world();
    render(<AllocationWorkbench />);
    await screen.findByText(/COMMUNITY ALLOCATION SIMULATION/);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /2\. Dull evening/ }));
    const dull = lastBody(api);
    // The sun is nearly gone and the buildings that have storage carry batteries.
    expect(dull.members.map((m) => m.generationKw)).toEqual([1, 0.5, 0]);
    expect(dull.members[0]!.battery).not.toBeNull();
    expect(dull.members[2]!.battery).toBeNull();

    await user.click(screen.getByRole("button", { name: /3\. Sunny midday, but the feeder is small/ }));
    const tight = lastBody(api);
    expect(tight.limits).toMatchObject({ feederLimitKw: 3, networkLossFraction: 0.05 });
  });

  it("can add a building and give one a battery, and sends both", async () => {
    const api = world();
    render(<AllocationWorkbench />);
    await screen.findByText(/COMMUNITY ALLOCATION SIMULATION/);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add a building" }));
    const c = screen.getByRole("group", { name: "Building C" });
    await user.click(within(c).getByRole("button", { name: "Give it a battery" }));
    await user.click(screen.getByRole("button", { name: "Recalculate" }));

    const body = lastBody(api);
    expect(body.members).toHaveLength(4);
    expect(body.members[2]!.battery).not.toBeNull();
  });

  it("reports the feeder as the binding constraint when the engine says it was", async () => {
    const limited = communityAllocation();
    limited.result.value!.feederBinding = true;
    limited.result.value!.totals.gridImportKw = 2;
    world(() => json(limited));
    render(<AllocationWorkbench />);
    expect(await screen.findByText(/shared feeder was the binding constraint/)).toBeInTheDocument();
  });

  it("shows unserved demand as a failure rather than hiding it", async () => {
    const short = communityAllocation();
    short.result.value!.totals.unservedKw = 1.5;
    world(() => json(short));
    render(<AllocationWorkbench />);
    expect(await screen.findByText("no supply within the limits could reach it")).toBeInTheDocument();
  });

  it("says plainly when the engine refuses the figures", async () => {
    world(() => new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "Building A: generation must be zero or more" } }), { status: 400, headers: { "content-type": "application/json" } }));
    render(<AllocationWorkbench />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/generation must be zero or more/);
  });

  it("warns, rather than reassures, when the balance check fails", async () => {
    const broken = communityAllocation();
    broken.result.value!.check = { balanced: false, maxMemberErrorKw: 0.4, communityErrorKw: 0.4, note: "An imbalance above rounding was found; the figures above should not be relied on. This is a defect, please report it." };
    world(() => json(broken));
    render(<AllocationWorkbench />);
    expect(await screen.findByText(/should not be relied on/)).toBeInTheDocument();
  });
});
