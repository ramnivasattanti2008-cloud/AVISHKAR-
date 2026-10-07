/**
 * Appliance-level energy estimates from a whole-home meter (NILM, spec section 29).
 *
 * `NilmEngine` is the plug-in point: an implementation returns, per appliance, an estimated energy with its uncertainty and a
 * confidence, or says it cannot. The platform must never claim an exact appliance figure that no data supports, so the only
 * engine shipped today, `UnavailableNilm`, always declines and says what data would be needed. A real engine is a drop-in
 * replacement behind this interface; its results are stored as `NILM_ESTIMATE` events, which the database refuses without a
 * confidence and an uncertainty.
 */
import type { Db } from "../db.js";
import { type Measured, unavailable } from "../provenance/index.js";

export interface ApplianceEstimate {
  applianceId: string;
  /** Estimated energy over the window, in kWh, and how far it may be off: "3.8 kWh plus or minus 0.7", never "exactly 3.8". */
  energyKwh: number;
  plusMinusKwh: number;
  confidence: number;
}

export interface NilmInput {
  propertyId: string;
  /** The finest reading interval of the property's imported meter data, in minutes; null when none has been imported. */
  finestIntervalMinutes: number | null;
  applianceCount: number;
}

export interface NilmEngine {
  readonly name: string;
  estimate(input: NilmInput): Promise<Measured<ApplianceEstimate[]>>;
}

/** The finest interval at which an engine can tell appliances apart from a whole-home meter, in minutes. */
export const NILM_MIN_INTERVAL_MINUTES = 1;

export class UnavailableNilm implements NilmEngine {
  readonly name = "unavailable";

  async estimate(input: NilmInput): Promise<Measured<ApplianceEstimate[]>> {
    const base = { provider: "avishkar-nilm", source: "NILM engine abstraction (no engine installed)", dataType: "appliance_energy_estimate", now: new Date() };
    if (input.applianceCount === 0) return unavailable("No appliances have been entered, so there is nothing to estimate. Add them first.", base);
    if (input.finestIntervalMinutes === null) {
      return unavailable("No meter data has been imported. Appliance-level estimates need readings from the whole-home meter.", base);
    }
    if (input.finestIntervalMinutes > NILM_MIN_INTERVAL_MINUTES) {
      return unavailable(
        `Your meter data is in ${input.finestIntervalMinutes}-minute steps. Telling appliances apart needs readings every minute or faster, or a separate meter on each appliance. AVISHKAR does not estimate appliance energy from coarser data: any figure would be a guess.`,
        base,
      );
    }
    return unavailable("No appliance-level estimation engine is installed yet, so no figure is given. Log runs by hand on each appliance if you want them recorded.", base);
  }
}

/** The finest reading interval of a property's imported data, or null if it has none. */
export async function finestInterval(db: Db, propertyId: string): Promise<number | null> {
  const r = await db.energyImport.aggregate({ where: { propertyId }, _min: { intervalMinutes: true } });
  return r._min.intervalMinutes ?? null;
}
