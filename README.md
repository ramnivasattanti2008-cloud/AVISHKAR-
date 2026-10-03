# AVISHKAR EMS: predictive energy management and surplus dispatch for Indian solar sites

AVISHKAR FET Hackathon, Problem Statement #2 (*Predictive Energy Management & Surplus Dispatch*).

An energy management system (EMS) for solar sites with a battery. Each evening it forecasts tomorrow's
generation and load with uncertainty bands, plans where every kWh goes (self-use, battery, emergency
reserve, a P2P/UEI sale, or the grid), publishes surplus offers, settles delivered vs committed energy,
and reports payback against a no-EMS baseline. Built for India: rupee time-of-day tariffs, net-metering
export, monsoon cloud and frequent outages (hence a hard emergency reserve), Beckn-style UEI offers.

**Approach: fork a strong base, fill its gaps.** The planning engine is [EMHASS](https://github.com/davidusb-geek/emhass)
(MIT, mature, active). It is vendored unchanged under `src/emhass/`. Everything this project adds
lives in `src/avishkar_ems/` and calls EMHASS; nothing inside EMHASS was edited. See [NOTICE.md](NOTICE.md).

## Results (simulated Indian sites, held-out year)

Trained on year one, evaluated on 52 sampled days of year two, annualised. **The data is simulated** (the
organisers' dataset is supplied separately) and the tariffs are illustrative, so read these as a
demonstration of the method, not a claim about real sites.

| Site | EMS payback | Baseline: self-consume + export (battery idle) | Baseline: fixed-rule battery | EMS with perfect foresight |
|---|---|---|---|---|
| 5 kWp home, Bengaluru | **12.4 yr** | 13.9 yr | 12.7 yr | 11.9 yr |
| 15 kWp shop, Pune | **9.5 yr** | 10.6 yr | 9.6 yr | 9.2 yr |
| 30 kWp clinic, Jaipur | **10.2 yr** | 10.9 yr | 10.2 yr | 9.8 yr |

- The EMS earns about **11%** more per year than the statement's baseline at the home and shop, and **7%** at the clinic.
  Against a stronger fixed-rule battery the margin is small (+2.2%, +1.0%, +0.5%). Time-of-day arbitrage has
  little room under these tariffs; most of the value is self-use and avoiding cheap exports.
- It captures roughly 60% to 72% of the gain a perfect-foresight planner would get.
- Critical load unserved in outages across the sampled days: EMS 0.18 / 0.00 / 0.00 kWh at the three sites,
  versus 1.45 / 1.96 / 5.55 kWh with the battery left idle and 0.40 / 1.13 / 0.00 kWh with the fixed rule.
- P2P: 408 offers over the sampled days, 1,068 kWh committed, 1,051 kWh delivered (1.6% shortfall).
  The extra revenue over plain export is small in these simulations.
- Forecast bands: the 80% generation band covered 76% to 79% of outcomes on the held-out year
  ([results/forecast_quality.csv](results/forecast_quality.csv)). The home load band is too wide (93%).

Full tables: [results/payback.csv](results/payback.csv). Example offer message: [results/example_offers.json](results/example_offers.json).

## What EMHASS already did, and what was missing

| Statement requirement | In EMHASS | Added here |
|---|---|---|
| Model expected generation from site metadata | pvlib-based forecast | `pvmodel.py`, modelled baseline for the actual weather |
| Flag deviations from the baseline | no | `monitor.py` |
| Forecast with P10/P50/P90 | a P10-bias knob only | `bands.py`: quantile models plus conformal calibration, for generation and load |
| Plan battery, self-use, load shifting | LP optimiser (HiGHS/cvxpy) | used as the engine via `planner.py` |
| Emergency reserve as a hard constraint | static min-SOC only | `reserve.py`: floor from critical load, backup hours and outage risk (planned notice, storm forecast, outage history), fed into EMHASS's min-SOC |
| Indian tariffs and net metering | no | `tariffs.py` (illustrative presets, replace with real DISCOM rates) |
| Surplus dispatch as P2P/UEI offers | no | `dispatch.py`: offers sized on P10 generation minus P90 load |
| Settlement (delivered vs committed) | no | `settle.py`: revenue, shortfall penalty, unmatched offers |
| Payback per site, EMS vs no-EMS | no | `payback.py`: two baselines and a perfect-foresight reference |
| Planning that does not oversell | n/a | `engine.py`: two-pass plan, P2P price applies only inside committed windows |

Status against the statement's scope: **must-haves** (live monitoring, generation and load forecast with bands,
utilisation plan, emergency reserve, JSON offers, settlement, payback view) are all implemented.
**Stretch** done: dynamic reserve driven by outage risk and weather. **Partly done:** the P2P flow covers
publish, match (clearing price against the floor), deliver and settle in simulation, with no confirm step and no
network. **Not done:** intraday re-planning, fleet aggregation, flexible-load detection, link to the O&M engine,
tariff and battery-size sensitivity.

## Quick start

```bash
python -m venv venv && source venv/bin/activate      # Python 3.10 to 3.12
pip install -e ".[app]"
python examples/run_demo.py            # about 2 minutes, writes ./results
streamlit run app/dashboard.py         # plan, offers, payback and monitoring
pytest tests/avishkar_ems              # about 25 seconds
```

## Using the organisers' dataset

Write an adapter that returns one DataFrame per site with the columns in `src/avishkar_ems/schema.py`
(15-minute, timezone-aware index) and a `SiteSpec` from the site metadata, then call `validate_site_frame`.
`pv_clear_kw` and `expected_kw` can be produced with `pvmodel.pv_power_kw` from the site's tilt, azimuth and losses.
The adapter itself is not written because the dataset format was not available.

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

## Limitations

- All demo data is simulated. Real results will differ, especially forecast error and outage behaviour.
- Tariffs, P2P prices, charges and the 0.5 outage-risk uplift are illustrative assumptions, not DISCOM or UEI figures.
- The offer JSON is Beckn-style but not validated against the official UEI/Beckn schema.
- Planning is day-ahead on P50 forecasts. The uncertainty bands size the offers and the risk-based reserve, but the
  LP itself is not stochastic, and there is no intraday re-planning.
- The plan can undershoot the reserve floor by under 1% of capacity (solver tolerance). The executor does not.
- Payback uses 52 sampled days of one simulated year, annualised, so seasonal sampling error applies.
- The vendored EMHASS optimiser tests pass in this environment (212 passed); the rest of the upstream suite was not run.

## Credits

EMHASS by David Hernandez Torres (MIT) is the planning engine, and pvlib-python (BSD-3) provides the PV model.
These projects were reviewed as references (their READMEs, not their code), and no code was taken from them:
alefunxo/P2P-communities-PV-Battery (Apache-2.0, Pena-Bello et al., Nature Energy 2022), MohdNematullah/Utility-Scale-BESS-Arbitrage-
(MIT), beckn/DEG, and several repositories without a licence. The reserve logic, forecaster, offer sizing, two-pass
planner, settlement and payback code here are original. Details in [NOTICE.md](NOTICE.md).
