import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportResult } from "@/lib/types";
import { PROPERTY_ID, energyDna, energyImport, fakeApi, json } from "@/test/fixtures";
import { ImportPanel, MAX_FILE_BYTES } from "./ImportPanel";

afterEach(() => vi.unstubAllGlobals());

const URL_PATH = `/api/properties/${PROPERTY_ID}/energy/imports`;
const csv = "timestamp,Energy (kWh)\n2026-03-02T00:00:00+05:30,0.25\n2026-03-02T00:15:00+05:30,0.25\n2026-03-02T00:30:00+05:30,0.25\n";
const file = (name = "meter.csv", text = csv) => new File([text], name, { type: "text/csv" });
const result = (over: Partial<ImportResult> = {}): ImportResult => ({ import: energyImport(), dna: energyDna(), dnaUnavailableReason: null, ...over });
const pick = async (f: File) => userEvent.upload(screen.getByLabelText("File"), f);
const go = () => userEvent.click(screen.getByRole("button", { name: "Import" }));

describe("ImportPanel", () => {
  it("sends the text of the chosen file, its name, and no unit when the header is to be read", async () => {
    const api = fakeApi([["POST", URL_PATH, () => json(result(), 201)]]);
    vi.stubGlobal("fetch", api.fetch);
    const onImported = vi.fn();
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={onImported} />);
    await pick(file());
    await go();
    expect(await screen.findByText(/1,344 readings stored/)).toBeInTheDocument();
    expect(api.calls[0]!.body).toEqual({ csv, filename: "meter.csv" });
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("sends the unit when the person chooses one", async () => {
    const api = fakeApi([["POST", URL_PATH, () => json(result(), 201)]]);
    vi.stubGlobal("fetch", api.fetch);
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={() => {}} />);
    await pick(file());
    await userEvent.selectOptions(screen.getByLabelText("Unit of the usage column"), "kW");
    await go();
    await screen.findByText(/readings stored/);
    expect(api.calls[0]!.body).toMatchObject({ unit: "kW" });
  });

  it("accounts for every row: stored, refused with reasons, already there; and shows the notes and gaps", async () => {
    const r = result({
      import: energyImport({
        rows: 100,
        accepted: 80,
        rejected: 15,
        duplicates: 5,
        rejectedByReason: { negative_value: 9, bad_timestamp: 6 },
        gaps: { missingIntervals: 40, longestGapMinutes: 180 },
        notes: ["Timestamps with no time zone were read as India Standard Time (UTC+5:30)."],
      }),
    });
    vi.stubGlobal("fetch", fakeApi([["POST", URL_PATH, () => json(r, 201)]]).fetch);
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={() => {}} />);
    await pick(file());
    await go();
    expect(await screen.findByText(/100 rows in the file: 80 stored, 15 refused, 5 already there/)).toBeInTheDocument();
    expect(screen.getByText("9: the usage was negative")).toBeInTheDocument();
    expect(screen.getByText("6: the time could not be read")).toBeInTheDocument();
    expect(screen.getByText(/40 readings are missing.*longest gap is 3 h.*left as gaps/)).toBeInTheDocument();
    expect(screen.getByText(/India Standard Time/)).toBeInTheDocument();
  });

  it("says why no Energy DNA was built when there is too little data", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", URL_PATH, () => json(result({ dna: null, dnaUnavailableReason: "A usage fingerprint needs at least 7 complete days." }), 201)]]).fetch);
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={() => {}} />);
    await pick(file());
    await go();
    expect(await screen.findByText(/No Energy DNA yet: A usage fingerprint needs at least 7 complete days./)).toBeInTheDocument();
  });

  it("asks the person to choose the unit when the file does not state one", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", URL_PATH, () => json({ error: { code: "VALIDATION_FAILED", message: "The usage column “Consumption” does not say its unit. Tell AVISHKAR whether it is kWh, Wh, kW or W: guessing would be wrong by a factor of four for 15-minute readings." } }, 400)]]).fetch);
    const onImported = vi.fn();
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={onImported} />);
    await pick(file("c.csv", "timestamp,Consumption\n1,2\n"));
    await go();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("does not say its unit");
    expect(alert).toHaveTextContent("Choose the unit above and import again.");
    expect(onImported).not.toHaveBeenCalled();
  });

  it("shows any other server refusal without the unit prompt, and a duplicate-file refusal as such", async () => {
    vi.stubGlobal("fetch", fakeApi([["POST", URL_PATH, () => json({ error: { code: "CONFLICT", message: "This exact file was already imported on 2026-10-07." } }, 409)]]).fetch);
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={() => {}} />);
    await pick(file());
    await go();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("already imported");
    expect(alert).not.toHaveTextContent("Choose the unit above");
  });

  it("does nothing without a file", async () => {
    const api = fakeApi([]);
    vi.stubGlobal("fetch", api.fetch);
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={() => {}} />);
    await go();
    expect(api.calls).toHaveLength(0);
  });

  it("refuses an empty file and an oversized one before uploading", async () => {
    const api = fakeApi([]);
    vi.stubGlobal("fetch", api.fetch);
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={() => {}} />);
    await pick(file("empty.csv", ""));
    await go();
    expect(await screen.findByRole("alert")).toHaveTextContent("That file is empty.");
    const big = file("big.csv", "x");
    Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
    await pick(big);
    await go();
    expect(await screen.findByRole("alert")).toHaveTextContent(/limit is 24 MB.*Split it by year/);
    expect(api.calls).toHaveLength(0);
  });

  it("reassures that nothing is repaired", () => {
    render(<ImportPanel propertyId={PROPERTY_ID} onImported={() => {}} />);
    expect(screen.getByText(/Nothing is repaired or filled in: a gap stays a gap/)).toBeInTheDocument();
    expect(screen.getByText(/AVISHKAR will not guess/)).toBeInTheDocument();
  });
});
