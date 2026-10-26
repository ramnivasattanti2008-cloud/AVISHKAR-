import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Eligibility, ProgramResult } from "@/lib/types";
import { fakeApi, json, provenance } from "@/test/fixtures";
import { EligibilityPanel } from "./EligibilityPanel";

afterEach(() => vi.unstubAllGlobals());

const rule = {
  program: "PM_SURYA_GHAR",
  ruleKey: "residential_cfa",
  region: "IN",
  appliesTo: "RESIDENTIAL",
  statedAs: "Rs. 30,000 per kW up to 2 kW; Rs. 18,000 per kW for additional capacity up to 3 kW; Rs. 78,000 total subsidy for systems larger than 3 kW (capped at).",
  source: "Benefits section of the National Portal for Rooftop Solar, read on 2026-10-07.",
  sourceUrl: "https://pmsuryaghar.gov.in",
  verifiedAt: "2026-10-07T00:00:00.000Z",
  effectiveFrom: null,
  effectiveTo: null,
  conditions: [],
  notes: [],
};

const program = (over: Partial<ProgramResult> = {}): ProgramResult => ({
  program: "PM_SURYA_GHAR",
  name: "PM Surya Ghar: Muft Bijli Yojana (central financial assistance)",
  outcome: "RULE_APPLIES",
  subsidy: { value: 78000, unit: "INR", provenance: provenance({ status: "ESTIMATED", provider: "avishkar-policy-engine", dataType: "pm_surya_ghar_subsidy", notes: ["Estimated: the published residential schedule applied to 3 kWp; it is not a confirmed entitlement"] }) },
  breakdown: [
    { fromKw: 0, toKw: 2, kw: 2, inrPerKw: 30000, amountInr: 60000 },
    { fromKw: 2, toKw: 3, kw: 1, inrPerKw: 18000, amountInr: 18000 },
  ],
  rules: [rule],
  caveats: ["The portal lists a 2nd amendment of the guidelines whose text was not read."],
  ...over,
});

const noNetMetering = program({
  program: "NET_METERING",
  name: "Net metering and export",
  outcome: "NO_SOURCED_RULE",
  subsidy: { value: null, provenance: provenance({ status: "UNAVAILABLE", notes: ["No sourced net-metering rule is loaded. AVISHKAR does not guess."] }) },
  breakdown: [],
  rules: [],
  caveats: [],
});

const result = (over: Partial<Eligibility> = {}): Eligibility => ({
  asOf: "2026-10-07",
  consumerType: "RESIDENTIAL",
  systemKwp: 3,
  eligibilityConfirmed: false,
  programs: [program()],
  netMetering: noNetMetering,
  notice: "AVISHKAR applies published rules to the numbers you give. Whether you qualify is decided by your distribution company and the national portal.",
  ...over,
});

const route = (r: Eligibility) => fakeApi([["POST", "/api/eligibility", () => json(r)]]);

describe("EligibilityPanel", () => {
  it("fills the size from the property's roof estimate, rounded, and lets the person change it", () => {
    render(<EligibilityPanel suggestedKwp={3.46} />);
    const input = screen.getByLabelText("System size (kWp)");
    expect(input).toHaveValue("3.5");
    expect(input).toHaveAccessibleDescription(/Filled in from the roof-area estimate/); // the hint describes the field; it is not part of its name
  });

  it("starts empty with no estimate, and will not run without a positive size", async () => {
    const api = route(result());
    vi.stubGlobal("fetch", api.fetch);
    render(<EligibilityPanel />);
    const go = screen.getByRole("button", { name: "Apply the rules" });
    expect(screen.getByLabelText("System size (kWp)")).toHaveValue("");
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText("System size (kWp)"), "0");
    expect(go).toBeDisabled();
    expect(api.calls).toHaveLength(0);
  });

  it("posts the consumer type and size, and the state only when chosen", async () => {
    const api = route(result());
    vi.stubGlobal("fetch", api.fetch);
    render(<EligibilityPanel />);
    await userEvent.type(screen.getByLabelText("System size (kWp)"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Apply the rules" }));
    expect(api.calls[0]!.body).toEqual({ consumerType: "RESIDENTIAL", systemKwp: 3 });
    await userEvent.selectOptions(screen.getByLabelText("State (optional)"), "MH");
    await userEvent.selectOptions(screen.getByLabelText("Who the system is for"), "COMMERCIAL");
    await userEvent.click(screen.getByRole("button", { name: "Apply the rules" }));
    expect(api.calls[1]!.body).toEqual({ consumerType: "COMMERCIAL", systemKwp: 3, state: "MH" });
  });

  it("shows the subsidy as an ESTIMATE with its working, caveats and source, never as an entitlement", async () => {
    vi.stubGlobal("fetch", route(result()).fetch);
    render(<EligibilityPanel />);
    await userEvent.type(screen.getByLabelText("System size (kWp)"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Apply the rules" }));
    expect(await screen.findByText("Subsidy (not a confirmed entitlement)")).toBeInTheDocument();
    expect(screen.getByText("78000")).toBeInTheDocument();
    expect(screen.getAllByText("ESTIMATED").length).toBeGreaterThan(0);
    expect(screen.getByText("A published rule was applied to the size you gave.")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("0 to 2 kW")).toBeInTheDocument();
    expect(within(table).getByText("₹60,000")).toBeInTheDocument();
    expect(within(table).getAllByText("₹18,000")).toHaveLength(2); // the second band: ₹18,000 per kW for 1 kW
    expect(screen.getByText(/2nd amendment of the guidelines whose text was not read/)).toBeInTheDocument();
    expect(screen.getByText(/Whether you qualify is decided by your distribution company/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://pmsuryaghar.gov.in" });
    expect(link).toHaveAttribute("href", "https://pmsuryaghar.gov.in");
    expect(screen.getByText(/Last checked at the source on 7 Oct 2026/)).toBeInTheDocument();
  });

  it("states plainly that no net-metering rule is loaded instead of answering", async () => {
    vi.stubGlobal("fetch", route(result()).fetch);
    render(<EligibilityPanel />);
    await userEvent.type(screen.getByLabelText("System size (kWp)"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Apply the rules" }));
    expect(await screen.findByText("Net-metering answer")).toBeInTheDocument();
    expect(screen.getByText("No sourced rule is loaded, so AVISHKAR states nothing.")).toBeInTheDocument();
    // The reason is shown in the open and repeated in the collapsed source details.
    expect(screen.getAllByText(/No sourced net-metering rule is loaded. AVISHKAR does not guess./).some((e) => !e.closest("details"))).toBe(true);
  });

  it("shows a dash, not a number, for a consumer the rule does not cover", async () => {
    const commercial = result({
      consumerType: "COMMERCIAL",
      programs: [program({ outcome: "NOT_COVERED", subsidy: { value: null, provenance: provenance({ status: "UNAVAILABLE", notes: ["The rule loaded covers residential households and housing societies."] }) }, breakdown: [], caveats: [] })],
    });
    vi.stubGlobal("fetch", route(commercial).fetch);
    render(<EligibilityPanel />);
    await userEvent.type(screen.getByLabelText("System size (kWp)"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Apply the rules" }));
    expect(await screen.findByText("The rule on file is for other consumers, so nothing is calculated.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the server's error for impossible input", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", "/api/eligibility", () => json({ error: { code: "VALIDATION_FAILED", message: "The request is not valid: /systemKwp too big" } }, 400)]]).fetch);
    render(<EligibilityPanel />);
    await userEvent.type(screen.getByLabelText("System size (kWp)"), "99999");
    await userEvent.click(screen.getByRole("button", { name: "Apply the rules" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("too big");
  });
});
