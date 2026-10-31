import { describe, expect, it } from "vitest";
import { EnphaseCloudExecutor, SolarEdgeCloudExecutor } from "../src/control/cloud_executor.js";
import { resolveExecutorFromEnv } from "../src/control/executor.js";
import { parseDiscomPortalData } from "../src/energy/discom.js";

describe("Cloud-to-Cloud OEM Executors (Zero Hardware)", () => {
  it("resolves NoDeviceExecutor when no cloud credentials exist", () => {
    const exec = resolveExecutorFromEnv({});
    expect(exec.name).toBe("none");
    expect(exec.available).toBe(false);
  });

  it("resolves EnphaseCloudExecutor when Enphase env credentials are provided", () => {
    const exec = resolveExecutorFromEnv({
      ENPHASE_API_KEY: "test_key",
      ENPHASE_SYSTEM_ID: "sys_12345",
    });
    expect(exec.name).toBe("enphase-cloud");
    expect(exec.available).toBe(true);
  });

  it("resolves SolarEdgeCloudExecutor when SolarEdge env credentials are provided", () => {
    const exec = resolveExecutorFromEnv({
      SOLAREDGE_API_KEY: "edge_key",
      SOLAREDGE_SITE_ID: "site_999",
    });
    expect(exec.name).toBe("solaredge-cloud");
    expect(exec.available).toBe(true);
  });

  it("EnphaseCloudExecutor dispatches profile to cloud endpoint via HTTPS mock", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      capturedUrl = url.toString();
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    };

    const executor = new EnphaseCloudExecutor({
      apiKey: "secret_token_123",
      systemId: "enphase_site_42",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const proposal = {
      id: "prop_1",
      propertyId: "prop_bangalore",
      kind: "BATTERY_CHARGE" as const,
      startsAt: new Date("2026-10-24T10:00:00Z"),
      endsAt: new Date("2026-10-24T14:00:00Z"),
      command: { powerKw: 3.5 },
    };

    const res = await executor.apply(proposal);
    expect(res.applied).toBe(true);
    expect(res.message).toContain("Enphase Cloud for system enphase_site_42");
    expect(capturedUrl).toContain("/systems/enphase_site_42/battery_profile");
    expect(capturedBody).toContain('"profile":"self-consumption"');

    const rev = await executor.revert(proposal);
    expect(rev.applied).toBe(true);
    expect(rev.message).toContain("Reverted Enphase Cloud profile");
  });

  it("SolarEdgeCloudExecutor dispatches storage mode via HTTPS mock", async () => {
    let capturedUrl = "";
    const mockFetch = async (url: string | URL | Request): Promise<Response> => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const executor = new SolarEdgeCloudExecutor({
      apiKey: "solaredge_key_abc",
      systemId: "site_789",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const proposal = {
      id: "prop_2",
      propertyId: "prop_pune",
      kind: "BATTERY_DISCHARGE" as const,
      startsAt: new Date("2026-10-24T18:00:00Z"),
      endsAt: new Date("2026-10-24T21:00:00Z"),
      command: { powerKw: 2.0 },
    };

    const res = await executor.apply(proposal);
    expect(res.applied).toBe(true);
    expect(capturedUrl).toContain("/site/site_789/storageProfile");
  });
});

describe("DISCOM Portal Ingestion (Pure Software AMR & Bills)", () => {
  it("parses BESCOM utility account JSON correctly", () => {
    const rawBescom = {
      discom: "BESCOM",
      consumerId: "BESCOM_12345678",
      bills: [
        { billMonth: "2026-07", unitsKwh: 340, billedAmountInr: 2850, sanctionedLoadKw: 5.0 },
        { billMonth: "2026-08", unitsKwh: 310, billedAmountInr: 2580, sanctionedLoadKw: 5.0 },
        { billMonth: "2026-09", unitsKwh: 380, billedAmountInr: 3200, sanctionedLoadKw: 5.0 },
      ],
      intervals: [
        { timestamp: "2026-09-30T10:00:00+05:30", importKwh: 0.8, exportKwh: 1.2 },
        { timestamp: "2026-09-30T10:15:00+05:30", importKwh: 0.7, exportKwh: 1.4 },
      ],
    };

    const parsed = parseDiscomPortalData(rawBescom);
    expect(parsed.discom).toBe("BESCOM");
    expect(parsed.consumerId).toBe("BESCOM_12345678");
    expect(parsed.billsCount).toBe(3);
    expect(parsed.totalKwh).toBe(1030);
    expect(parsed.monthlyAverageKwh).toBe(343.33);
    expect(parsed.sanctionedLoadKw).toBe(5.0);
    expect(parsed.intervals).toHaveLength(2);
  });

  it("throws descriptive error on invalid or empty DISCOM payload", () => {
    expect(() => parseDiscomPortalData(null)).toThrow("expected an object");
    expect(() => parseDiscomPortalData({ discom: "BESCOM", bills: [] })).toThrow("no billing records");
  });
});
