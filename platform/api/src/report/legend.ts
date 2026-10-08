/** What each data label promises, in the words the web app shows (web/src/lib/format.ts STATUS), kept here for the report. */
export const STATUS_MEANING: Record<string, string> = {
  LIVE: "Fresh: observed within the provider's own update interval.",
  UPDATED: "Real data, but older than the provider's update interval; its age is shown.",
  FORECAST: "A prediction for a future time, not something that happened.",
  ESTIMATED: "Calculated from real inputs and stated assumptions; not measured.",
  SIMULATED: "Produced by a simulation; not a measurement of the real world.",
  DEMO: "Deterministic sample data, not real.",
  REFERENCE: "Looked-up or entered reference data that does not change with time, such as an address, a tariff order or a quote.",
  UNAVAILABLE: "No value: the source is down or the data does not exist. Nothing has been made up.",
};
