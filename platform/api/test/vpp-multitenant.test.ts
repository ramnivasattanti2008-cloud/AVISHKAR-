import { describe, expect, it } from "vitest";
import { simulateMicrogridBalancing } from "../src/vpp/multi_tenant.js";

describe("Multi-Tenant Neighborhood Microgrid Balancing (Pure Software)", () => {
  it("handles empty microgrid cluster gracefully", () => {
    const res = simulateMicrogridBalancing([], []);
    expect(res.totalProperties).toBe(0);
    expect(res.virtualPeerShiftedKwh).toBe(0);
  });

  it("calculates exact peer energy shifting between a solar home and a non-solar home", () => {
    // 2 homes across 4 hours:
    // Home 1 (Solar heavy): Load [1, 1, 1, 1], PV [4, 4, 0, 0] -> Surplus [3, 3, 0, 0]
    // Home 2 (Demand heavy): Load [2, 2, 2, 2], PV [0, 0, 0, 0] -> Deficit [2, 2, 2, 2]
    // In hours 0 and 1, Home 1 has surplus 3, Home 2 has deficit 2 -> Peer shared = 2 per hour = 4 kWh total
    const loads = [
      [1, 1, 1, 1, ...new Array(20).fill(0)],
      [2, 2, 2, 2, ...new Array(20).fill(0)],
    ];
    const pvs = [
      [4, 4, 0, 0, ...new Array(20).fill(0)],
      [0, 0, 0, 0, ...new Array(20).fill(0)],
    ];

    const res = simulateMicrogridBalancing(loads, pvs, 500);
    expect(res.totalProperties).toBe(2);
    expect(res.surplusPropertiesCount).toBe(1);
    expect(res.deficitPropertiesCount).toBe(1);
    expect(res.totalSolarGenerationKwh).toBe(8);
    expect(res.totalDemandKwh).toBe(12);
    expect(res.virtualPeerShiftedKwh).toBe(4);
    expect(res.netSurplusExportKwh).toBe(2); // 1 kWh remaining surplus in hours 0 and 1 = 2 kWh exported to grid
    expect(res.hourlyAggregation[0]?.peerSharedKwh).toBe(2);
    expect(res.hourlyAggregation[0]?.netGridExportKwh).toBe(1);
  });
});
