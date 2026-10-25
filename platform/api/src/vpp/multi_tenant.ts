/**
 * Multi-Tenant Neighborhood Microgrid and VPP Balancing Engine.
 *
 * Simulates aggregate solar surplus, demand deficit, and battery energy sharing
 * within a geographical microgrid radius (e.g. 1000 meters) without requiring
 * cross-account identity exposure.
 */

export interface MicrogridClusterSummary {
  clusterRadiusMeters: number;
  totalProperties: number;
  surplusPropertiesCount: number;
  deficitPropertiesCount: number;
  balancedPropertiesCount: number;
  totalSolarGenerationKwh: number;
  totalDemandKwh: number;
  netSurplusExportKwh: number;
  virtualPeerShiftedKwh: number;
  virtualGridReliefPct: number;
  hourlyAggregation: {
    hour: number;
    solarKwh: number;
    demandKwh: number;
    peerSharedKwh: number;
    netGridImportKwh: number;
    netGridExportKwh: number;
  }[];
}

export function simulateMicrogridBalancing(
  propertyLoads: number[][],
  propertyPvs: number[][],
  radiusMeters: number = 1000,
): MicrogridClusterSummary {
  const numProps = propertyLoads.length;
  if (numProps === 0) {
    return {
      clusterRadiusMeters: radiusMeters,
      totalProperties: 0,
      surplusPropertiesCount: 0,
      deficitPropertiesCount: 0,
      balancedPropertiesCount: 0,
      totalSolarGenerationKwh: 0,
      totalDemandKwh: 0,
      netSurplusExportKwh: 0,
      virtualPeerShiftedKwh: 0,
      virtualGridReliefPct: 0,
      hourlyAggregation: [],
    };
  }

  const hourly = [];
  let totalSolar = 0;
  let totalDemand = 0;
  let totalPeerShared = 0;
  let totalNetExport = 0;

  let surplusProps = 0;
  let deficitProps = 0;
  let balancedProps = 0;

  for (let p = 0; p < numProps; p++) {
    const loads = propertyLoads[p] ?? [];
    const pvs = propertyPvs[p] ?? [];
    const sumP = loads.reduce((a, b) => a + b, 0);
    const sumG = pvs.reduce((a, b) => a + b, 0);
    if (sumG > sumP + 1.0) surplusProps++;
    else if (sumP > sumG + 1.0) deficitProps++;
    else balancedProps++;
  }

  for (let h = 0; h < 24; h++) {
    let hourSolar = 0;
    let hourDemand = 0;
    let hourSurplus = 0;
    let hourDeficit = 0;

    for (let p = 0; p < numProps; p++) {
      const pv = (propertyPvs[p] ?? [])[h] ?? 0;
      const load = (propertyLoads[p] ?? [])[h] ?? 0;
      hourSolar += pv;
      hourDemand += load;

      if (pv > load) {
        hourSurplus += pv - load;
      } else {
        hourDeficit += load - pv;
      }
    }

    // Amount that can be virtually shared within neighborhood microgrid
    const peerShared = Math.min(hourSurplus, hourDeficit);
    const netImport = Math.max(0, hourDemand - hourSolar);
    const netExport = Math.max(0, hourSolar - hourDemand);

    totalSolar += hourSolar;
    totalDemand += hourDemand;
    totalPeerShared += peerShared;
    totalNetExport += netExport;

    hourly.push({
      hour: h,
      solarKwh: Math.round(hourSolar * 100) / 100,
      demandKwh: Math.round(hourDemand * 100) / 100,
      peerSharedKwh: Math.round(peerShared * 100) / 100,
      netGridImportKwh: Math.round(netImport * 100) / 100,
      netGridExportKwh: Math.round(netExport * 100) / 100,
    });
  }

  const virtualReliefPct = totalDemand > 0 ? Math.round((totalPeerShared / totalDemand) * 1000) / 10 : 0;

  return {
    clusterRadiusMeters: radiusMeters,
    totalProperties: numProps,
    surplusPropertiesCount: surplusProps,
    deficitPropertiesCount: deficitProps,
    balancedPropertiesCount: balancedProps,
    totalSolarGenerationKwh: Math.round(totalSolar * 100) / 100,
    totalDemandKwh: Math.round(totalDemand * 100) / 100,
    netSurplusExportKwh: Math.round(totalNetExport * 100) / 100,
    virtualPeerShiftedKwh: Math.round(totalPeerShared * 100) / 100,
    virtualGridReliefPct: virtualReliefPct,
    hourlyAggregation: hourly,
  };
}
