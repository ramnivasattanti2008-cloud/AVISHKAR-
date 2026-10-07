import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, json, tariffPlan } from "@/test/fixtures";
import { CustomTariffForm } from "./CustomTariffForm";

afterEach(() => vi.unstubAllGlobals());

const created = tariffPlan({ origin: "USER", name: "My home" });
const ok = () => fakeApi([["POST", "/api/tariffs", () => json(created, 201)]]);

describe("CustomTariffForm", () => {
  it("sends a flat tariff as one block from 0 to 24 and omits everything left blank", async () => {
    const api = ok();
    vi.stubGlobal("fetch", api.fetch);
    const onCreated = vi.fn();
    render(<CustomTariffForm onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText("Name"), "My home");
    await userEvent.type(screen.getByLabelText("₹ per kWh"), "8.1");
    await userEvent.click(screen.getByRole("button", { name: "Save this tariff" }));
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.body).toEqual({ name: "My home", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 24, rate: 8.1 }] });
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it("includes the optional details when they are filled in", async () => {
    const api = ok();
    vi.stubGlobal("fetch", api.fetch);
    render(<CustomTariffForm onCreated={() => {}} />);
    await userEvent.type(screen.getByLabelText("Name"), "Shop");
    await userEvent.selectOptions(screen.getByLabelText("Consumer type"), "COMMERCIAL");
    await userEvent.selectOptions(screen.getByLabelText("State (optional)"), "KA");
    await userEvent.type(screen.getByLabelText(/Distribution company/), "BESCOM");
    await userEvent.type(screen.getByLabelText("₹ per kWh"), "9");
    await userEvent.type(screen.getByLabelText(/Fixed charge, ₹/), "110");
    await userEvent.selectOptions(screen.getByLabelText("Fixed charge is"), "PER_KW_MONTH");
    await userEvent.type(screen.getByLabelText(/Credit for exported energy/), "3.1");
    await userEvent.type(screen.getByLabelText(/Where these numbers come from/), "my bill of March 2026");
    await userEvent.click(screen.getByRole("button", { name: "Save this tariff" }));
    expect(api.calls[0]!.body).toEqual({
      name: "Shop",
      consumerType: "COMMERCIAL",
      state: "KA",
      discom: "BESCOM",
      touBlocks: [{ startHour: 0, endHour: 24, rate: 9 }],
      fixedCharge: { amountInr: 110, basis: "PER_KW_MONTH" },
      exportRate: 3.1,
      source: "my bill of March 2026",
    });
  });

  it("builds several time-of-day blocks", async () => {
    const api = ok();
    vi.stubGlobal("fetch", api.fetch);
    render(<CustomTariffForm onCreated={() => {}} />);
    await userEvent.type(screen.getByLabelText("Name"), "ToD");
    await userEvent.clear(screen.getByLabelText("To hour"));
    await userEvent.type(screen.getByLabelText("To hour"), "9");
    await userEvent.type(screen.getByLabelText("₹ per kWh"), "7.84");
    await userEvent.click(screen.getByRole("button", { name: "Add a time block" }));
    const [from, to, rate] = [screen.getAllByLabelText("From hour")[1]!, screen.getAllByLabelText("To hour")[1]!, screen.getAllByLabelText("₹ per kWh")[1]!];
    await userEvent.type(from, "9");
    await userEvent.type(to, "24");
    await userEvent.type(rate, "6.52");
    await userEvent.click(screen.getByRole("button", { name: "Save this tariff" }));
    expect((api.calls[0]!.body as { touBlocks: unknown[] }).touBlocks).toEqual([
      { startHour: 0, endHour: 9, rate: 7.84 },
      { startHour: 9, endHour: 24, rate: 6.52 },
    ]);
  });

  it("builds telescopic slabs with an open-ended last slab", async () => {
    const api = ok();
    vi.stubGlobal("fetch", api.fetch);
    render(<CustomTariffForm onCreated={() => {}} />);
    await userEvent.type(screen.getByLabelText("Name"), "Slabs");
    await userEvent.click(screen.getByLabelText(/Slabs by monthly usage/));
    await userEvent.type(screen.getByLabelText("₹ per kWh"), "7"); // the single slab starts as the open-ended one
    await userEvent.click(screen.getByRole("button", { name: "Add a slab" })); // it becomes a bounded slab, keeping its rate
    const limits = screen.getAllByLabelText(/Up to \(kWh a month\)|Above the previous slab/);
    expect(limits).toHaveLength(2);
    expect(limits[1]).toBeDisabled(); // the last slab has no limit
    const rates = screen.getAllByLabelText("₹ per kWh");
    await userEvent.type(limits[0]!, "100");
    await userEvent.clear(rates[0]!);
    await userEvent.type(rates[0]!, "3");
    await userEvent.type(rates[1]!, "7");
    await userEvent.click(screen.getByRole("button", { name: "Save this tariff" }));
    const body = api.calls[0]!.body as { slabs: unknown[]; touBlocks?: unknown };
    expect(body.touBlocks).toBeUndefined();
    expect(body.slabs).toEqual([
      { upToKwhPerMonth: 100, rate: 3 },
      { upToKwhPerMonth: null, rate: 7 },
    ]);
  });

  it("shows the server's explanation of what is wrong and does not report success", async () => {
    const api = fakeApi([["POST", "/api/tariffs", () => json({ error: { code: "VALIDATION_FAILED", message: "The tariff is not usable: The blocks leave these times without a rate: 10:00 to 12:00." } }, 400)]]);
    vi.stubGlobal("fetch", api.fetch);
    const onCreated = vi.fn();
    render(<CustomTariffForm onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText("Name"), "Gappy");
    await userEvent.type(screen.getByLabelText("₹ per kWh"), "7");
    await userEvent.click(screen.getByRole("button", { name: "Save this tariff" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("10:00 to 12:00");
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save this tariff" })).toBeEnabled();
  });

  it("will not remove the only block or slab", () => {
    render(<CustomTariffForm onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: "Remove block 1" })).toBeDisabled();
  });
});
