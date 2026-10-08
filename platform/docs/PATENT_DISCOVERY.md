# Patent-discovery notes

A structured list of technical ideas in the platform that someone might want to examine for protection. **This is not a claim
of patentability, novelty or freedom to operate.** No prior-art search has been done, no patent attorney has been consulted, and
several of the ideas are likely to be obvious combinations of known techniques. Written on 2026-10-08 from the code; the
owner should take it to patent counsel before any public disclosure, because publishing the code or a demo can start time
limits on filing in many jurisdictions.

For each idea: what it is, the prior art the author already knows of (not a search), what is different about the mechanism, the
technical elements, the evidence that would be needed, and the questions for counsel.

## 1. A value envelope whose trust label is derived, not chosen

- **What:** every number leaving the system carries its provider, observation time, and a status (`LIVE`, `UPDATED`,
  `FORECAST`, `ESTIMATED`, `SIMULATED`, `DEMO`, `REFERENCE`, `UNAVAILABLE`). `LIVE` is computed from the age of the observation
  against the provider's update cadence and cannot be set by the caller; a timestamp from the future makes the value
  `UNAVAILABLE`; a database CHECK refuses `LIVE` without an observation time. (`api/src/provenance`)
- **Known prior art:** data-lineage and provenance models (for example W3C PROV), data-quality flags in time-series databases and
  in meteorological data (quality-control flags), freshness checks in monitoring systems.
- **Differentiating mechanism:** the label is enforced at three layers (type, schema, database constraint) and drives what
  the interface may print; an unavailable value cannot be rendered as a number.
- **Evidence needed:** a comparison against provenance systems on a specification of "cannot be mislabelled"; tests already show
  the refusals.
- **Open questions:** likely a software-design practice rather than a technical invention; unclear whether it has any claimable
  technical effect.

## 2. Grounding of generated explanations in computed values

- **What:** an energy assistant answers from backend tool results; a guard rejects any answer containing a number that no tool
  returned (to the precision written, with stated unit conversions), and an optional language model's rewording is discarded when
  it states an ungrounded number or cites nothing. (`api/src/copilot/guard.ts`)
- **Known prior art:** retrieval-augmented generation, tool-using language-model agents, citation checking and numeric
  consistency checks of generated text.
- **Differentiating mechanism:** the acceptance test is numeric and exact to the written precision rather than semantic, and
  failure falls back to a template rather than to a retry.
- **Evidence needed:** a measured rate at which an ungrounded number passes the guard on a corpus of real model outputs. This
  has not been measured: the language-model path has not been run against the real service.
- **Open questions:** whether a numeric-grounding check applied to generated text is claimable over existing fact-checking
  approaches.

## 3. Plans accepted only after an independent recomputation

- **What:** an optimiser's schedule is re-derived from first principles by a separate routine (energy balance per step, state of
  charge dynamics, limits, windows, unbroken runs); a plan that fails is withheld and reported as invalid, and the displayed
  saving is the difference of the displayed (rounded) costs so the page always adds up. (`engine/avishkar_engine/optimise.py`
  `validate`, `api/src/plan/service.ts`)
- **Known prior art:** solution verification in operations research, post-solve feasibility checks, safety interlocks in building
  energy management.
- **Differentiating mechanism:** the validator shares no code with the optimiser and its result gates display.
- **Evidence needed:** examples where an optimiser output that looked plausible was caught by the validator (the test suite
  injects faulty schedules; no field case exists).
- **Open questions:** probably not novel in itself.

## 4. A solar forecast band learned from the weather provider's own archived day-ahead errors

- **What:** the percentile band of a physical PV forecast is the empirical error of the provider's day-ahead irradiance forecast
  at that place, split by sky condition (the clearness index), taken from the provider's previous-runs archive, with its
  coverage reported on hours it was not fitted to (78% against an 80% target in one live check of 106 hours).
  (`engine/avishkar_engine/solar.py`, `api/src/providers/forecast-history.ts`)
- **Known prior art:** empirical and quantile-based uncertainty for irradiance forecasts, conformal prediction (Vovk, Gammerman
  and Shafer; Romano, Patterson and Candès on conformalised quantile regression), model output statistics.
- **Differentiating mechanism:** uses a public archive of a provider's earlier forecast runs as the calibration source, so a
  per-place band exists without any on-site generation data.
- **Evidence needed:** coverage across many places and seasons against alternatives (a single live check is not evidence);
  comparison with the same band built from on-site generation.
- **Open questions:** whether using an archive of earlier forecast runs as a calibration set is distinguishable from known
  practice.

## 5. Yearly economics from cyclic typical days

- **What:** a year is estimated by planning one weekday and one weekend day for each month with the battery's start charge a
  decision variable that must equal its end charge, and weighting the days by the real calendar of the next 365 days. Money
  results exist only from prices the owner enters; the export credit basis and the share exported are stated with every result.
  (`api/src/scenarios`, the engine's `cyclic` option)
- **Known prior art:** representative-day and typical-meteorological-year methods in capacity planning and in tools such as
  HOMER, periodic-boundary storage constraints in energy-system models.
- **Differentiating mechanism:** the combination for household-level what-ifs with calendar weighting and refusal to state
  money without owner-entered prices.
- **Evidence needed:** agreement against full-year simulation on real data (not done); the hand-solved cases in the tests are
  small.
- **Open questions:** likely an application of known methods.

## 6. Coordination that cannot increase cost

- **What:** a simulated fleet of homes with shiftable load, vehicles and an aggregate battery is coordinated by moving flexible
  load inside a power cap no lower than what the uncoordinated fleet already draws, which guarantees the coordinated bill is not
  higher; reproducible through a seed. (`api/src/vpp`)
- **Known prior art:** demand response, virtual power plant and aggregator literature, peak-capped load shifting.
- **Differentiating mechanism:** the cap is derived from the uncoordinated profile, giving a monotonic guarantee by
  construction.
- **Evidence needed:** nothing beyond the proof by construction; any claim of real-world benefit would need data from real homes
  and the platform has none.
- **Open questions:** likely obvious.

## What is not here

Nothing in this repository is claimed to be an invention. Items 1 to 6 are listed because a reader may want to check them, not
because they are believed to be patentable. The vendored EMHASS code (`src/emhass`) is upstream, MIT-licensed work by other
people (`NOTICE.md`) and is not part of any idea above.
