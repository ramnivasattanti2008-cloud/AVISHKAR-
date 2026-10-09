# Model card

One card per model. The rule from the specification (§80) is kept: **nothing is called AI because it uses a formula.** Of
everything below, exactly one component is a trained machine-learning model (the load model); the rest are physics, linear
programming, statistics on past errors, fixed rules, or an optional language model that only rewords. Written from the code on
2026-10-08; metrics are the ones the system itself computes on the data it is given, and a figure quoted here is from a named
check, not a promise about your property.

| Component | Kind | Trained on |
|---|---|---|
| Solar output | Physical model (pvlib) | Nothing: it is physics driven by a weather forecast |
| Solar uncertainty band | Empirical quantiles of past errors | The weather provider's own day-ahead errors at the place, 45 days |
| Load forecast, baselines | Rules on history | The owner's own meter readings |
| Load forecast, `gbm_quantile` | Gradient-boosted quantile regression with conformal calibration | The owner's own meter readings (six weeks or more) |
| Planner | Linear / mixed-integer programme (HiGHS) | Nothing |
| Typical days, yearly what-if | Deterministic simulation | Nothing |
| VPP and community simulation | Seeded random draws around the owner's pattern | Nothing |
| Copilot routing | Fixed patterns | Nothing |
| Copilot wording | Templates; optionally a language model that only rewords | The language model is the provider's; it is not trained or fine-tuned here |
| Recommendation confidence | A count of re-plans (solar and load at the 10th and 90th percentile of their bands) that give the same battery advice | Nothing: it uses the forecasts' own bands |
| Resilience (backup hours, reserve) and autonomy | Hour-by-hour arithmetic on the battery and the forecast sun; a share of the plan's energy | Nothing |
| Appliance-level disaggregation (NILM) | Not implemented | The interface exists and always declines |

---

## 1. Solar output model (`engine/avishkar_engine/solar.py`)

- **Purpose:** the expected AC power of a rooftop system for each of the next hours (up to 7 days).
- **Input:** the system (kWp, tilt, azimuth, loss, temperature coefficient, inverter limit), the place, and Open-Meteo's hourly
  irradiance and temperature forecast.
- **Output:** hourly kW (the central forecast), the clear-sky power as a reference, and a 10th to 90th percentile band when
  there is error history.
- **Method:** Simplified Solis clear sky, Erbs split of global into direct and diffuse, isotropic transposition to the plane of
  the array, cell temperature from irradiance, a fixed loss and a temperature coefficient, clipped at the inverter. The power
  formula is the one the Python EMS uses and a test pins the two together. This is a model of physics, not of data.
- **Training data:** none for the central forecast.
- **Assumptions:** the owner's tilt and azimuth are right; no soiling, shading, snow or degradation; a forecast above the clear
  sky is allowed up to 1.25 times (cloud-edge enhancement) and clipped there, so clear sky is a reference, not a ceiling.
- **Metrics:** MAE, RMSE, MAPE, WAPE and bias against the weather model's analysis for the past 45 days, next to the same
  scores for repeating yesterday's output. Live check, one 5 kWp roof in Bengaluru: 46 days, the model's error was about 10%
  below that of repeating yesterday.
- **Limitations:** the score measures the weather forecast, not metered generation (the data model has no generation meter,
  and the page says so); hourly only, no 5-minute nowcast, no satellite or sky-camera input; no second weather provider to
  benchmark against.
- **Failure cases:** a forecast bias in the weather provider passes straight through; a wrongly entered azimuth or tilt makes
  every hour wrong in a consistent way; shaded roofs are overestimated.

### Solar uncertainty band

- **Method:** the clearness index (irradiance over clear-sky irradiance) errors of the provider's day-ahead forecast, taken
  from its previous-runs archive, split into overcast, partly cloudy and clear conditions; the band is the 10th and 90th
  percentile of the errors in the condition forecast for that hour. A pooled fallback is used when a condition is rare.
- **Target coverage:** 80%. **Measured:** the share of held-out hours that fell inside the band is reported with every
  forecast, on hours the band was not fitted to. Live check: 78% of 106 unseen hours.
- **Limitations:** marginal per hour, not joint across the day (a band for each hour, not for the day's total); with fewer than
  30 held-out hours the page says "not checked"; with less than the minimum history there is no band and the reason is shown.

## 2. Load model (`engine/avishkar_engine/load.py`)

- **Purpose:** expected electricity use for each of the next 1 to 168 hours, an 80% band, and the chance an hour is a peak
  (above the property's own top 5% of hours).
- **Input:** the owner's imported meter readings only, as hourly average power. Every feature is at least a week old, so the
  same forecast is valid at any horizon to seven days.
- **Methods compared on a chronological holdout the model never saw:** the value at the same hour a week earlier; the mean of
  the same hour of the week over up to eight weeks; the mean of the same hour of the day over days 7 to 13 earlier; and
  `gbm_quantile`: scikit-learn `HistGradientBoostingRegressor` quantile models (10th, 50th, 90th) on calendar and lagged
  features, with conformal calibration of the tails. **The model is used only if it beats the best baseline by at least 2%.**
- **Training data:** the property's own readings; two weeks are needed for the baselines and six weeks for the model. Gaps stay
  gaps and are never filled. Seasonality is used only with about a year of history.
- **Output:** the chosen method, every method's MAE, RMSE, WAPE, bias and band coverage on the holdout, the forecast, the band,
  peak probability.
- **Assumptions:** the household's pattern a week ago predicts the pattern now.
- **Metrics (live check):** 70 days of hourly readings: "same hour of the week" won at 0.08 kW mean error, with 84% of unseen
  hours inside the band. For a household built to use exactly 20% above its pattern, the learning-loop score matched the
  arithmetic to two decimals.
- **Limitations:** does not react to the last few days; no weather, occupancy or holiday features; if the meter data ends more
  than two days ago the forecast is labelled `ESTIMATED` and described as the hours after the data, never as tomorrow.
- **Failure cases:** a change of household (a guest, a new appliance, an absence) is invisible until it shows up in the history;
  a short history with one unusual week makes the baselines unrepresentative.
- **Learning loop:** each stored forecast is scored against the readings that follow it (error, bias, band coverage, skill
  against the same hour a week earlier). It reports; it does **not** retrain or switch methods automatically.

## 3. Planner (`engine/avishkar_engine/optimise.py`)

A linear / mixed-integer programme, not a learned model. See OPTIMIZATION.md. Its output is accepted only after an independent
re-computation of the physics from the returned schedule.

## 4. Typical days and the yearly what-if

Deterministic: a clear-sky day per month scaled to NASA POWER's monthly irradiation, the owner's Energy DNA for the load,
planned by the optimiser with a cyclic battery, weighted by the next 365 days' calendar. Metrics: a test checks that the energy
agrees with the forecast engine's on the same day. Limitations: a typical day is a mean day, so cloudy-day variability is not in
the result; months without readings use the average month.

## 5. Community and VPP simulation (`api/src/vpp`)

- **Purpose:** show how a group of homes might behave with and without coordination, and how many of the owner's own
  properties could share surplus on a typical day.
- **Method:** seeded draws (the same seed gives the same fleet) of load scale, solar size and presence of a battery, vehicle and
  shiftable load around one of the owner's properties; the same planner for batteries; shiftable load moved to cheap hours
  inside a power cap that is no lower than what the uncoordinated fleet already draws.
- **Assumptions:** the shares and sizes are the owner's, with defaults that are assumptions and not survey figures. They are
  returned with every result.
- **Tests:** answers worked by hand (15% of load shiftable: the peak falls 15%; 100 homes: INR 1,020 a day) and the property
  that coordination can never raise the bill.
- **Limitations:** independent draws around one pattern are not real households; no feeder limits; one day type per run.
  Labelled `SIMULATED` everywhere.

## 6. Copilot (`api/src/copilot`)

- **Routing and wording:** fixed patterns for sixteen kinds of question over eighteen tools, and written templates, with `[n]`
  citations to the tool results. This is not a language model.
- **The guard:** every number in an answer must match a number a backend tool returned, to the precision written (integers up to
  31 and years are exempt, as are the unit changes ×100 and ×1000). An answer that breaks this is refused. This is tested.
- **Optional language model:** when `ANTHROPIC_API_KEY` is set, a model may reword the template answer. Its text is discarded
  if it states a number no tool returned or cites nothing. **This path has not been exercised against the real service** (no
  key has been supplied), only against a test double.
- **Limitations:** no conversation memory, no follow-up questions, English only; it cannot change settings.

## 7. The Python EMS forecasts (`src/avishkar_ems/bands.py`)

The first deliverable keeps its own P10/P50/P90 gradient-boosted quantile models with conformal calibration of the tails for
the three demo sites (held-out periods: Mathura Jul 2020 to Feb 2021; Pune and Jaipur 2023). Results and their limits are in the
repository README and `docs/KNOWN_ISSUES.md`; the three demo sites use partly non-Indian load data.

## 8. Not implemented

- **NILM (appliance-level disaggregation):** the interface (`api/src/assets/nilm.ts`) exists and the only engine shipped always
  declines, saying what data would be needed. No appliance-level figure is shown that no data supports.
- **Outage prediction, cloud nowcasting, carbon-intensity forecasting:** no data source.
- **Reinforcement learning, deep learning, federated learning:** none, and none is claimed.
