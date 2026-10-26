import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROPERTY_ID, appliance, battery, ev, fakeApi, json, solarSystem } from "@/test/fixtures";
import { ApplianceForm, BatteryForm, EvForm, SolarForm } from "./AssetForms";
import { fromPct, num, toPct } from "./fields";

afterEach(() => vi.unstubAllGlobals());

const base = `/api/properties/${PROPERTY_ID}`;
const ok = (path: string, method = "POST") => fakeApi([[method, path, () => json({}, method === "POST" ? 201 : 200)]]);
const noop = () => {};

describe("percent and number helpers", () => {
  it("shows a fraction as the percent a person types, without floating-point noise", () => {
    expect(toPct(0.9487)).toBe("94.87");
    expect(toPct(0.07)).toBe("7");
    expect(toPct(1)).toBe("100");
    expect(toPct(null)).toBe("");
    expect(toPct(0.1 + 0.2)).toBe("30");
  });
  it("turns typed text into a fraction, null when blank, and NaN (so the server refuses it) when not a number", () => {
    expect(fromPct("95")).toBe(0.95);
    expect(fromPct(" 7.5 ")).toBe(0.075);
    expect(fromPct("")).toBeNull();
    expect(fromPct("abc")).toBeNaN();
    expect(num("12.5")).toBe(12.5);
    expect(num("")).toBeNull();
    expect(num("x")).toBeNaN();
  });
});

describe("BatteryForm", () => {
  it("creates with only what was typed: no nulls, nothing assumed on the person's behalf", async () => {
    const api = ok(`${base}/batteries`);
    vi.stubGlobal("fetch", api.fetch);
    const onSaved = vi.fn();
    render(<BatteryForm propertyId={PROPERTY_ID} onSaved={onSaved} onCancel={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "Garage");
    await userEvent.type(screen.getByLabelText(/Capacity, kWh/), "10");
    await userEvent.type(screen.getByLabelText(/Maximum charge power/), "5");
    await userEvent.type(screen.getByLabelText(/Maximum discharge power/), "4.5");
    await userEvent.click(screen.getByRole("button", { name: "Add battery" }));
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: "POST", body: { name: "Garage", status: "EXISTING", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 4.5 } });
    expect(Object.keys(api.calls[0]!.body as object).sort()).toEqual(["capacityKwh", "maxChargeKw", "maxDischargeKw", "name", "status"]);
    expect(onSaved).toHaveBeenCalled();
  });

  it("sends percentages as fractions", async () => {
    const api = ok(`${base}/batteries`);
    vi.stubGlobal("fetch", api.fetch);
    render(<BatteryForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "G");
    await userEvent.type(screen.getByLabelText(/Capacity, kWh/), "10");
    await userEvent.type(screen.getByLabelText(/Maximum charge power/), "5");
    await userEvent.type(screen.getByLabelText(/Maximum discharge power/), "5");
    await userEvent.click(screen.getByText(/More details/));
    await userEvent.type(screen.getByLabelText(/Charging efficiency/), "96");
    await userEvent.type(screen.getByLabelText(/Never used below/), "20");
    await userEvent.type(screen.getByLabelText(/Backup reserve/), "30");
    await userEvent.type(screen.getByLabelText(/Charge now/), "55");
    await userEvent.click(screen.getByRole("button", { name: "Add battery" }));
    expect(api.calls[0]!.body).toMatchObject({ chargeEfficiency: 0.96, minSoc: 0.2, reserveSoc: 0.3, currentSoc: 0.55 });
  });

  it("prefills a battery being changed in percent, and sends null for a field the person cleared", async () => {
    const b = battery({ entered: { ...battery().entered, chargeEfficiency: 0.96, reserveSoc: 0.3 } });
    const api = ok(`${base}/batteries/${b.id}`, "PATCH");
    vi.stubGlobal("fetch", api.fetch);
    render(<BatteryForm propertyId={PROPERTY_ID} initial={b} onSaved={noop} onCancel={noop} />);
    await userEvent.click(screen.getByText(/More details/));
    expect(screen.getByLabelText(/Charging efficiency/)).toHaveValue("96");
    expect(screen.getByLabelText(/Backup reserve/)).toHaveValue("30");
    await userEvent.clear(screen.getByLabelText(/Charging efficiency/));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.calls[0]).toMatchObject({ method: "PATCH" });
    expect(api.calls[0]!.body).toMatchObject({ chargeEfficiency: null, reserveSoc: 0.3, name: "Garage battery", capacityKwh: 10 });
  });

  it("shows the server's explanation and keeps the form open", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", `${base}/batteries`, () => json({ error: { code: "VALIDATION_FAILED", message: "The unused fraction (0.9) must be below the maximum charge (0.8)." } }, 400)]]).fetch);
    const onSaved = vi.fn();
    render(<BatteryForm propertyId={PROPERTY_ID} onSaved={onSaved} onCancel={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "G");
    await userEvent.type(screen.getByLabelText(/Capacity, kWh/), "10");
    await userEvent.type(screen.getByLabelText(/Maximum charge power/), "5");
    await userEvent.type(screen.getByLabelText(/Maximum discharge power/), "5");
    await userEvent.click(screen.getByRole("button", { name: "Add battery" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("must be below the maximum charge");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add battery" })).toBeEnabled();
  });

  it("cancels", async () => {
    const onCancel = vi.fn();
    render(<BatteryForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("SolarForm", () => {
  it("creates a system with its orientation, leaving blank optionals out", async () => {
    const api = ok(`${base}/solar-systems`);
    vi.stubGlobal("fetch", api.fetch);
    render(<SolarForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "Roof");
    await userEvent.type(screen.getByLabelText(/Capacity, kWp/), "3.3");
    await userEvent.type(screen.getByLabelText(/Tilt/), "15");
    await userEvent.type(screen.getByLabelText(/Direction/), "180");
    expect(screen.getByText(/180 faces south, 90 east, 270 west/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add solar system" }));
    expect(api.calls[0]!.body).toEqual({ name: "Roof", status: "EXISTING", capacityKwp: 3.3, tiltDeg: 15, azimuthDeg: 180 });
  });

  it("changes a system and can clear the loss figure back to the default", async () => {
    const s = solarSystem({ entered: { lossFraction: 0.08 } });
    const api = ok(`${base}/solar-systems/${s.id}`, "PATCH");
    vi.stubGlobal("fetch", api.fetch);
    render(<SolarForm propertyId={PROPERTY_ID} initial={s} onSaved={noop} onCancel={noop} />);
    expect(screen.getByLabelText(/System losses/)).toHaveValue("8");
    await userEvent.clear(screen.getByLabelText(/System losses/));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.calls[0]!.body).toMatchObject({ lossFraction: null, capacityKwp: 3.3 });
  });
});

describe("EvForm", () => {
  it("defaults to a weekday departure, lets the days be changed, and sends sorted days", async () => {
    const api = ok(`${base}/evs`);
    vi.stubGlobal("fetch", api.fetch);
    render(<EvForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={noop} />);
    expect(screen.getByLabelText("Mon")).toBeChecked();
    expect(screen.getByLabelText("Sat")).not.toBeChecked();
    await userEvent.type(screen.getByLabelText("Name"), "Car");
    await userEvent.type(screen.getByLabelText(/Battery size/), "40");
    await userEvent.type(screen.getByLabelText(/Charger power/), "7.4");
    await userEvent.click(screen.getByLabelText("Sat"));
    await userEvent.click(screen.getByLabelText("Tue"));
    await userEvent.click(screen.getByRole("button", { name: "Add vehicle" }));
    expect(api.calls[0]!.body).toMatchObject({ name: "Car", batteryKwh: 40, chargerKw: 7.4, targetSoc: 0.8, departureTime: "08:00", departureDays: [0, 2, 3, 4, 5] });
  });

  it("shows the server's refusal when no day is chosen", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", `${base}/evs`, () => json({ error: { code: "VALIDATION_FAILED", message: "Too small: expected array to have >=1 items" } }, 400)]]).fetch);
    render(<EvForm propertyId={PROPERTY_ID} initial={ev({ departureDays: [0] })} onSaved={noop} onCancel={noop} />);
    await userEvent.click(screen.getByLabelText("Mon"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("ApplianceForm", () => {
  it("hides the movable window until the appliance is flexible, then requires it", async () => {
    render(<ApplianceForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={noop} />);
    expect(screen.queryByLabelText(/Earliest start/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("How important is it?"), "FLEXIBLE");
    expect(screen.getByLabelText(/Earliest start/)).toBeRequired();
    expect(screen.getByLabelText(/Must finish by/)).toBeRequired();
    expect(screen.getByLabelText(/Runs for, minutes/)).toBeRequired();
  });

  it("creates a critical appliance with just what matters", async () => {
    const api = ok(`${base}/appliances`);
    vi.stubGlobal("fetch", api.fetch);
    render(<ApplianceForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "Fridge");
    await userEvent.type(screen.getByLabelText(/What it is/), "refrigerator");
    await userEvent.selectOptions(screen.getByLabelText("How important is it?"), "CRITICAL");
    await userEvent.type(screen.getByLabelText(/Rated power/), "150");
    await userEvent.click(screen.getByRole("button", { name: "Add appliance" }));
    expect(api.calls[0]!.body).toEqual({ name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 150, quantity: 1, interruptible: false });
  });

  it("sends the window, duration and interruptibility of a flexible appliance", async () => {
    const api = ok(`${base}/appliances`);
    vi.stubGlobal("fetch", api.fetch);
    render(<ApplianceForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "Washer");
    await userEvent.type(screen.getByLabelText(/What it is/), "washing machine");
    await userEvent.selectOptions(screen.getByLabelText("How important is it?"), "FLEXIBLE");
    await userEvent.type(screen.getByLabelText(/Rated power/), "500");
    await userEvent.type(screen.getByLabelText(/Earliest start/), "10:00");
    await userEvent.type(screen.getByLabelText(/Must finish by/), "16:00");
    await userEvent.type(screen.getByLabelText(/Runs for, minutes/), "90");
    await userEvent.click(screen.getByLabelText(/can be paused and resumed/));
    await userEvent.click(screen.getByRole("button", { name: "Add appliance" }));
    expect(api.calls[0]!.body).toMatchObject({ priority: "FLEXIBLE", earliestStart: "10:00", latestFinish: "16:00", durationMin: 90, interruptible: true });
  });

  it("clears the window when a flexible appliance is changed to another class", async () => {
    const washer = appliance({ priority: "FLEXIBLE", flexibility: { earliestStart: "10:00", latestFinish: "16:00", durationMin: 90, interruptible: false, windowMinutes: 360 } });
    const api = ok(`${base}/appliances/${washer.id}`, "PATCH");
    vi.stubGlobal("fetch", api.fetch);
    render(<ApplianceForm propertyId={PROPERTY_ID} initial={washer} onSaved={noop} onCancel={noop} />);
    expect(screen.getByLabelText(/Earliest start/)).toHaveValue("10:00");
    await userEvent.selectOptions(screen.getByLabelText("How important is it?"), "IMPORTANT");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.calls[0]!.body).toMatchObject({ priority: "IMPORTANT", earliestStart: null, latestFinish: null, durationMin: null });
  });

  it("shows the server's explanation, such as a run longer than its window", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", `${base}/appliances`, () => json({ error: { code: "VALIDATION_FAILED", message: "It needs 400 minutes but the window from 10:00 to 16:00 is only 360 minutes long." } }, 400)]]).fetch);
    render(<ApplianceForm propertyId={PROPERTY_ID} onSaved={noop} onCancel={noop} />);
    await userEvent.type(screen.getByLabelText("Name"), "Washer");
    await userEvent.type(screen.getByLabelText(/What it is/), "washing machine");
    await userEvent.selectOptions(screen.getByLabelText("How important is it?"), "FLEXIBLE");
    await userEvent.type(screen.getByLabelText(/Rated power/), "500");
    await userEvent.type(screen.getByLabelText(/Earliest start/), "10:00");
    await userEvent.type(screen.getByLabelText(/Must finish by/), "16:00");
    await userEvent.type(screen.getByLabelText(/Runs for, minutes/), "400");
    await userEvent.click(screen.getByRole("button", { name: "Add appliance" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("only 360 minutes long");
  });
});
