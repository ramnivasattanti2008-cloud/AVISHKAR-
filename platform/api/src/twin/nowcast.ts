import { type GeoPoint, humanAge, unavailable, type Measured } from "../provenance/index.js";
import { checkCoordinates } from "../quality.js";
import { AppError } from "../errors.js";
import type { Providers } from "../providers/index.js";

/**
 * Cloud-movement nowcast (spec section 12). A real one needs consecutive satellite images minutes apart (geostationary
 * imagery) to track clouds and time their arrival. The only satellite source integrated is Sentinel-2, which revisits a place
 * about every 5 days, so a minutes-ahead nowcast cannot be made, and AVISHKAR says so instead of producing one.
 */
export async function cloudNowcast(deps: { providers: Providers; now: () => Date }, latitude: number, longitude: number, ctx: { requestId?: string } = {}): Promise<Measured<null>> {
  const c = checkCoordinates(latitude, longitude);
  if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
  const now = deps.now();
  let latest = "No recent satellite scene could be retrieved.";
  try {
    const s = await deps.providers.satellite.latest(latitude, longitude, { limit: 1 }, { requestId: ctx.requestId, now: deps.now });
    const scene = s.value?.[0];
    if (scene) latest = `The latest Sentinel-2 image of this place was taken ${humanAge((now.getTime() - new Date(scene.acquiredAt).getTime()) / 1000)} ago.`;
  } catch {
    /* the explanation below still stands without it */
  }
  const where: GeoPoint = { latitude, longitude };
  return unavailable<null>(
    `Satellite nowcast unavailable: insufficient recent observations. Tracking cloud movement needs consecutive satellite images minutes apart; the open source connected here (Sentinel-2) revisits a place about every 5 days. ${latest} For the next hours, use the hourly weather forecast, which is labelled FORECAST.`,
    { provider: "avishkar-nowcast", source: "AVISHKAR cloud nowcast", dataType: "cloud_nowcast", location: where, now },
  );
}
