# AVISHKAR EMS: predictive energy management and surplus dispatch for Indian solar sites

AVISHKAR FET Hackathon, Problem Statement #2 (*Predictive Energy Management & Surplus Dispatch*).

An energy management system (EMS) for solar sites with a battery. Each evening it forecasts tomorrow's
generation and load with uncertainty bands, plans where every kWh goes (self-use, battery, emergency
reserve, a P2P/UEI sale, or the grid), publishes surplus offers, settles delivered vs committed energy,
and reports payback against a no-EMS baseline. Built for India: rupee time-of-day tariffs, net-metering
export, monsoon cloud and frequent outages (hence a hard emergency reserve), India Energy Stack (Beckn DEG v2.0) P2P offers.

**Approach: fork a strong base, fill its gaps.** The planning engine is [EMHASS](https://github.com/davidusb-geek/emhass)
(MIT, mature, active). It is vendored unchanged under `src/emhass/`. Everything this project adds
lives in `src/avishkar_ems/` and calls EMHASS; nothing inside EMHASS was edited. See [NOTICE.md](NOTICE.md).

## Results (real weather, measured load, held-out period)

| Input | Source | Real? |
|---|---|---|
| Weather (irradiance at each site's tilt, temperature) | PVGIS / ERA5 via pvlib, 2019 to 2023 | real |
| Mathura home: load **and grid outages** | CEEW smart meter MH43, 3-minute data, CC0 (Harvard Dataverse) | real, measured |
| Shop and clinic load | measured German factory profile (Zenodo 4683455, CC-BY) | real but not Indian |
| Generation | pvlib model driven by the real irradiance | modelled (no inverter logs) |
| Import rates and Time-of-Day bands at all three sites | UPERC (Mathura), MERC with its June 2025 review order (Pune), RERC 2025 tariff (Jaipur); see `data/tariffs/` and `docs/RESEARCH.md` | real, from the orders |
| Export rates, P2P prices, fixed charges | not taken from the orders (fixed charges are not modelled) | assumption |
| Outages at the shop and clinic | generated | assumption |
| Day-ahead forecast inputs | persistence of yesterday's clearness | simple, no archived NWP |

Mathura trains on Jun 2019 to Jun 2020 and tests on Jul 2020 to Feb 2021, so Mar to Jun is missing and its yearly figure
leans one way. Pune and Jaipur train on 2021-22 and test on 2023. The figures below replay sampled held-out days and
annualise them (the sampling and day counts are stated in the note at the end of the generated block).

<!-- results:start -->
Payback in years, lower is better (best of the first three in bold):

| Site | EMS | Battery idle | Fixed-rule battery | Perfect foresight |
|---|---|---|---|---|
| 3 kWp home, Mathura | 19.94 | 21.74 | **19.89** | 19.36 |
| 15 kWp shop, Pune | **8.59** | 8.91 | 8.68 | 8.55 |
| 30 kWp clinic, Jaipur | 7.69 | 7.83 | **7.69** | 7.66 |

With the PM Surya Ghar subsidy (Rs 78,000 for a 3 kW home, if you qualify) the Mathura EMS payback drops from 19.94 to 14.84 years. The shop and clinic are commercial, so no subsidy is applied.

- Against a battery left idle the EMS earns 9.1%, 3.8% and 1.9% more a year. Against a fixed-rule battery it loses by 0.2% at Mathura, wins by 1.1% at Pune and ties at Jaipur (0.0%). So the honest summary is: the optimiser's edge over a sensible simple rule is small on these tariffs. Its clearer value is the reserve, the offers and the settlement.
- Backup: critical load left without power during cuts was 0.08 / 0.00 / 0.00 kWh with the EMS, against 0.08 / 0.00 / 0.00 with an idle battery and 0.08 / 0.00 / 0.00 with the fixed rule. The Mathura figure is the same for all three because the meter is not recording during a cut and the home has a small battery.
- The noon re-plan (`intraday.py`) changed yearly benefit by -0.1% to +0.0% versus the EMS, so it did not help once execution was reactive. It is kept as an option and is off in the headline numbers.
- Forecast bands (80% target): generation covered 86% / 86% / 84%. Load covered 78% at Mathura (measured), and 89% / 90% at the shop and clinic, where the near-repeating factory profile makes the bands too wide ([results/forecast_quality.csv](results/forecast_quality.csv)).
- Sensitivity ([results/sensitivity.csv](results/sensitivity.csv)): a battery sized like ours adds 10.2% at Mathura, 4.2% at Pune and 2.0% at Jaipur compared with having none. With the export (net-metering) rate raised by Rs 2 the battery's gain becomes -4.3% at Mathura, +1.7% at Pune and +0.4% at Jaipur, so at Mathura the battery is a backup purchase, not a savings one.
- P2P volume across the sampled days, delivered of committed: 8.7 of 8.7 kWh at Mathura, 12.4 of 13.5 kWh at Pune and 3.2 of 3.2 kWh at Jaipur (small, because real load absorbs most of the surplus).

_Generated 2026-10-07 09:04 UTC by `examples/run_demo.py` and `examples/run_sensitivity.py`: one in every 7 held-out days, annualised (Mathura 33, Pune 52, Jaipur 52 sampled days). Python 3.12.10, numpy 2.2.6, pandas 2.3.3, pvlib 0.16.1; the full set is in `requirements-lock.txt`. This block is generated: run `python scripts/update_readme.py`._
<!-- results:end -->

How the numbers were improved along the way (history, not results):

- The reserve floor now includes the 10% of the battery that cannot be used. An earlier version left it out, so a "4 hour"
  backup reserve covered about 3 hours. The executor also now backs up only the critical load during a cut and sheds the
  rest, as a critical-load panel does. Both fixes came out of testing against real tariffs.
- Execution matters. The EMS used to follow the plan's 15-minute battery setpoints and lost to the simple rule at
  Mathura, because a single home's load is too noisy to plan that finely. The executor now follows the plan's price
  signal (when to hold energy, when to charge from the grid at night, what was promised to buyers) but reacts to the real
  load and sun.
- Days that are not consecutive no longer inherit each other's battery charge: each sampled day starts from the same
  state, because yesterday's charge says nothing about a day weeks later.

The numbers above are produced by `examples/run_demo.py` and `examples/run_sensitivity.py` and written into this file by
`python scripts/update_readme.py` (CI checks they agree). Full tables: [results/payback.csv](results/payback.csv).
Offer message: [results/example_offers.json](results/example_offers.json).

## What EMHASS already did, and what was missing

| Statement requirement | In EMHASS | Added here |
|---|---|---|
| Model expected generation from site metadata | pvlib-based forecast | `pvmodel.py`, modelled baseline for the actual weather |
| Flag deviations from the baseline | no | `monitor.py` |
| Forecast with P10/P50/P90 | a P10-bias knob only | `bands.py`: quantile models plus conformal calibration, for generation and load |
| Plan battery, self-use, load shifting | LP optimiser (HiGHS/cvxpy) | used as the engine via `planner.py` |
| Emergency reserve as a hard constraint | static min-SOC only | `reserve.py`: floor from critical load, backup hours and outage risk (planned notice, storm forecast, outage history), fed into EMHASS's min-SOC |
| Indian tariffs and net metering | no | `tariffs.py` (illustrative presets, replace with real DISCOM rates) |
| Surplus dispatch as P2P/UEI offers | no | `dispatch.py` sizes offers on P10 generation minus P90 load; `ies.py` emits the India Energy Stack `catalog/publish` message and checks it |
| Real data | none | `realdata.py` (PVGIS/ERA5 weather via pvlib), `ceew.py` (measured Indian household load and outages) |
| Intraday re-planning | no | `intraday.py`: noon re-plan from the morning's observed error (measured: no gain) |
| Executing a plan under forecast error | n/a | `execute.py` `guided` policy: plan's price signal, real load and sun |
| P2P confirm and settle | no | `ies.py`: confirm, on_confirm and settled messages (DRAFT, ACTIVE, COMPLETE), buyer simulated |
| Many sites | no | `fleet.py`: pooled offers and pro-rata money split |
| Shiftable loads | no | `flex.py`: bursts above base load, with an upper-bound saving if moved into the sun hours |
| Plain-language output | no | `summary.py`: English and Hindi daily summary in the dashboard |
| Settlement (delivered vs committed) | no | `settle.py`: revenue, shortfall penalty, unmatched offers |
| Payback per site, EMS vs no-EMS | no | `payback.py`: two baselines and a perfect-foresight reference |
| Planning that does not oversell | n/a | `engine.py`: two-pass plan, P2P price applies only inside committed windows |

Status against the statement's scope: every must-have (live monitoring, generation and load forecast with bands,
utilisation plan, emergency reserve, JSON offers, settlement, payback view) is implemented, and so are the stretch items
(dynamic reserve from outage risk and weather, intraday re-planning, fleet pooling, flexible-load detection, tariff and
battery-size sensitivity). The P2P flow covers publish, match, confirm, deliver and settle in simulation, with no live
network. Not done: the link to the O&M engine.

## Extra features for everyday users

| Feature | What it gives you |
|---|---|
| Analyse your own meter file | `python examples/analyze_my_site.py --load my.csv --lat .. --lon .. --kwp 3 --cost 180000 --tod --base-rate 7 --subsidy pm-surya-ghar` writes a short report with your payback and battery advice. Works with kW, W, kWh or Wh files. |
| Subsidy-aware payback | PM Surya Ghar (up to Rs 78,000 for homes) shown as a separate payback figure. |
| Time-of-Day tariff builder | Builds a tariff from your base rate using the national rule minimums. Enter your real rates when you have them. |
| Battery size advisor | Tries several sizes, reports bill benefit and backup hours, and says plainly when a battery will not repay itself from bills. |
| Appliance scheduler | Tells you the cheapest start time for a geyser, washing machine, pump or EV charger. |
| Plain reasons | Explains each day's plan in English or Hindi. |

How this compares with similar tools is in [docs/RESEARCH.md](docs/RESEARCH.md).

## Quick start

```bash
python -m venv venv && source venv/bin/activate      # Python 3.10 to 3.12
pip install -e ".[app]"
python examples/run_demo.py            # about 2 minutes, writes ./results
python scripts/precompute_cache.py     # optional: pre-warm the dashboard (a few minutes) so every tab opens instantly
streamlit run app/dashboard.py         # plan, offers, payback and monitoring (Windows: run-dashboard.cmd)
pytest tests/avishkar_ems              # about two minutes
python examples/analyze_my_site.py --help   # use your own meter CSV
python examples/run_sensitivity.py     # battery size and export rate, about 6 minutes
```

For contributors and AI agents: [CLAUDE.md](CLAUDE.md) (commands, architecture, gotchas), [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)
(prioritised drawbacks) and [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) (demo video script). `requirements-lock.txt` pins the
environment the current `results/` were generated in.

## Using the organisers' dataset

Write an adapter that returns one DataFrame per site with the columns in `src/avishkar_ems/schema.py`
(15-minute, timezone-aware index) and a `SiteSpec`, then call `validate_site_frame`. `realdata.real_site_frame` is the
worked example: swap its measured-load, outage and price columns for the organisers' or the DISCOM's data.

## How it works

1. **Monitor**: modelled generation vs actual, flagged after an hour below 85% in good sun.
2. **Forecast**: next-day generation (clearness ratio on daytime rows, scaled by clear-sky output) and load,
   each as P10/P50/P90 with the outer quantiles conformally calibrated on the latest 45 days.
3. **Reserve**: SOC floor = critical kW x backup hours x (1 + 0.5 x outage risk) / efficiency / capacity.
   The planner may never go below it, and the executor enforces it strictly.
4. **Plan**: EMHASS LP on P50 forecasts with time-of-day prices, battery wear cost and the floor. Pass 1 plans with
   grid-export prices, offers are sized on the conservative surplus, pass 2 re-plans knowing those windows.
5. **Dispatch and settle**: offers as JSON, then delivered vs committed energy with a shortfall penalty.
6. **Payback**: benefit = bill without the system minus bill with it, plus trade and export revenue, minus battery
   wear, plus the value of any change in stored energy. Payback = system cost / annual benefit.

Replay uses the same battery physics for the EMS and for every baseline. The plan is tracked against reality:
the battery is not discharged into the grid outside committed P2P windows, and not charged from the grid in daylight.

## Privacy

Meter data stays on the machine running the EMS. The only thing published to a market is an offer (time window,
quantity, floor price), never the load profile. Real deployments should add consent and retention rules for meter data.

## Limitations

- Not real: generation (modelled from real irradiance), tariffs, P2P prices, outage history at the shop and clinic, and
  day-ahead forecast inputs (persistence, because no archived forecast was reachable). The shop and clinic load is a
  German factory. The Mathura home is the most real site: measured load, measured outages, real weather.
- The Mathura outage log has no notices, so planned-outage warning is never set there. Load is not metered during a cut
  and is filled with the meter's typical load for that time of day.
- The battery price in the advisor (Rs 25,000 per kWh) is an assumption. Import rates come from the official orders, but every export rate is an assumption, and the sites use one rate class each (check yours). Replace them by editing `data/tariffs/<site>.json`.
- The Mathura holdout covers Jul to Feb only. System costs (Rs 305,000 for the home) are assumptions.
- Offers, confirm and settled messages follow the public beckn/DEG P2P devkit and pass the checks in `ies.py` (the
  publish checker also accepts the official example when `DEG_PUBLISH_EXAMPLE` points to it). The buyer is simulated and
  nothing was sent to a live network.
- `fleet.py` and `flex.py` are tested on constructed cases and (for `flex.py`) run on real meter data, but the sites in
  the demo are in different cities and years, so there is no real multi-site pooling example.
- The flexible-load saving is an upper bound. It assumes surplus sun is there when the load is moved.
- The plan can undershoot the reserve floor by under 1% of capacity (solver tolerance). The executor does not.
- The package keeps the name "emhass" because the vendored optimiser reads its own version from package metadata.
- The vendored EMHASS optimiser tests pass in this environment (212 passed); the rest of the upstream suite was not run.

## Credits

EMHASS by David Hernandez Torres (MIT) is the planning engine, and pvlib-python (BSD-3) provides the PV model.
These projects were reviewed as references (their READMEs, not their code), and no code was taken from them:
alefunxo/P2P-communities-PV-Battery (Apache-2.0, Pena-Bello et al., Nature Energy 2022), MohdNematullah/Utility-Scale-BESS-Arbitrage-
(MIT), beckn/DEG, and several repositories without a licence. The reserve logic, forecaster, offer sizing, two-pass
planner, settlement and payback code here are original. Details in [NOTICE.md](NOTICE.md).
