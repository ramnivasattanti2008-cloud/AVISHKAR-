/**
 * Software DISCOM Consumer Portal & AMR Smart Meter Ingestion.
 *
 * Enables zero-hardware consumption onboarding directly from Indian utility accounts:
 * - BESCOM (Bengaluru / Karnataka)
 * - MSEDCL / Mahavitaran (Maharashtra)
 * - BSES Rajdhani / Yamuna (Delhi)
 * - TANGEDCO (Tamil Nadu)
 */

export interface DiscomPortalBill {
  consumerId: string;
  billMonth: string; // "YYYY-MM"
  unitsKwh: number;
  solarExportKwh?: number;
  billedAmountInr: number;
  sanctionedLoadKw: number;
  tariffCategory: string;
}

export interface DiscomAmrInterval {
  timestamp: string; // ISO 8601
  importKwh: number;
  exportKwh?: number;
}

export interface DiscomSyncResult {
  discom: "BESCOM" | "MSEDCL" | "BSES" | "TANGEDCO" | "OTHER";
  consumerId: string;
  billsCount: number;
  intervalReadingsCount: number;
  totalKwh: number;
  monthlyAverageKwh: number;
  sanctionedLoadKw: number;
  bills: DiscomPortalBill[];
  intervals?: DiscomAmrInterval[];
}

/** Parses simulated or scraped JSON payload from DISCOM consumer account portal */
export function parseDiscomPortalData(rawJson: unknown): DiscomSyncResult {
  if (typeof rawJson !== "object" || rawJson === null) {
    throw new Error("Invalid DISCOM portal payload: expected an object");
  }

  const obj = rawJson as Record<string, unknown>;
  const discom = typeof obj.discom === "string" ? (obj.discom as DiscomSyncResult["discom"]) : "OTHER";
  const consumerId = typeof obj.consumerId === "string" ? obj.consumerId : "UNKNOWN";

  if (!Array.isArray(obj.bills) || obj.bills.length === 0) {
    throw new Error("DISCOM payload contains no billing records");
  }

  const bills: DiscomPortalBill[] = [];
  let totalKwh = 0;
  let maxSanctionedKw = 1.0;

  for (const b of obj.bills) {
    if (typeof b !== "object" || b === null) continue;
    const billObj = b as Record<string, unknown>;
    const units = typeof billObj.unitsKwh === "number" ? billObj.unitsKwh : 0;
    const amount = typeof billObj.billedAmountInr === "number" ? billObj.billedAmountInr : 0;
    const sanction = typeof billObj.sanctionedLoadKw === "number" ? billObj.sanctionedLoadKw : 1.0;
    const month = typeof billObj.billMonth === "string" ? billObj.billMonth : new Date().toISOString().slice(0, 7);
    const cat = typeof billObj.tariffCategory === "string" ? billObj.tariffCategory : "LT-Domestic";

    totalKwh += units;
    if (sanction > maxSanctionedKw) maxSanctionedKw = sanction;

    bills.push({
      consumerId,
      billMonth: month,
      unitsKwh: units,
      solarExportKwh: typeof billObj.solarExportKwh === "number" ? billObj.solarExportKwh : 0,
      billedAmountInr: amount,
      sanctionedLoadKw: sanction,
      tariffCategory: cat,
    });
  }

  const intervals: DiscomAmrInterval[] = [];
  if (Array.isArray(obj.intervals)) {
    for (const item of obj.intervals) {
      if (typeof item === "object" && item !== null) {
        const iObj = item as Record<string, unknown>;
        if (typeof iObj.timestamp === "string" && typeof iObj.importKwh === "number") {
          intervals.push({
            timestamp: iObj.timestamp,
            importKwh: iObj.importKwh,
            exportKwh: typeof iObj.exportKwh === "number" ? iObj.exportKwh : 0,
          });
        }
      }
    }
  }

  return {
    discom,
    consumerId,
    billsCount: bills.length,
    intervalReadingsCount: intervals.length,
    totalKwh,
    monthlyAverageKwh: Math.round((totalKwh / bills.length) * 100) / 100,
    sanctionedLoadKw: maxSanctionedKw,
    bills,
    intervals: intervals.length > 0 ? intervals : undefined,
  };
}
