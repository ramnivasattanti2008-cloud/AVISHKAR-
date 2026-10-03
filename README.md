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

## Results (real weather, measured load, held-out year 2023)

Inputs: PVGIS/ERA5 hourly irradiance and temperature at each site's own tilt and azimuth (2021 to 2023, real),
and a measured 15-minute commercial load profile (Tjaden, Zenodo 4683455, CC-BY). Trained on 2021-22, evaluated on
52 sampled days of 2023, annualised. Generation is modelled with pvlib from the real irradiance (no inverter logs
were available). Tariffs, outage history and P2P prices are assumptions. Read these as a method check, not a claim
about real sites.

| Site | EMS payback | Baseline: self-consume + export (battery idle) | Baseline: fixed-rule battery | EMS with perfect foresight |
|---|---|---|---|---|
| 5 kWp home, Bengaluru | 9.40 yr | 9.53 yr | **9.27 yr** | 9.24 yr |
| 15 kWp shop, Pune | **8.58 yr** | 8.86 yr | 8.68 yr | 8.43 yr |
| 30 kWp clinic, Jaipur | 9.13 yr | 9.26 yr | **9.11 yr** | 9.00 yr |

- Against the statement's baseline (battery idle) the EMS earns 1.4%, 3.2% and 1.5% more per year. Against a fixed-rule
  battery it wins only at the shop. With real weather and these flat-ish tariffs, arbitrage has little room.
- The clear gain is resilience: critical load unserved in outages is 0.00 / 0.53 / 0.00 kWh for the EMS versus
  1.97 / 6.72 / 8.66 kWh with the battery left idle.
- Forecast bands: the 80% generation band covered 83% / 78% / 69% of outcomes (Jaipur is under-covered), and the load band
  is too wide (89% to 93%) ([results/forecast_quality.csv](results/forecast_quality.csv)).
- P2P volume is small (about 1 to 16 kWh committed over the sampled days) because the real load absorbs most surplus.
- The earlier fully simulated results can be reproduced with `prepare(site, source="sim")`.

Full tables: [results/payback.csv](results/payback.csv). Offer message: [results/example_offers.json](results/example_offers.json).

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
| Real data | none | `realdata.py`: PVGIS/ERA5 weather via pvlib plus a measured load profile |
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
pytest tests/avishkar_ems              # about 30 seconds (first run downloads PVGIS weather)
```

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

## Limitations

- Real: weather (ERA5 via PVGIS) and a measured load profile. Not real: generation (modelled from real irradiance),
  the load's origin (a German factory, not an Indian site), outages, tariffs, P2P prices, and the day-ahead forecast
  inputs (persistence of yesterday's clearness, because no archived forecast was reachable).
- Tariffs, P2P prices, charges and the 0.5 outage-risk uplift are illustrative assumptions, not DISCOM or market figures.
- The offer message follows the public beckn/DEG P2P devkit and passes the structural checks in `ies.py` (it accepts
  the official example). It was not run against a live network, and there is no confirm/settle exchange.
- Planning is day-ahead on P50 forecasts, with no intraday re-planning, fleet aggregation or flexible-load detection.
- The plan can undershoot the reserve floor by under 1% of capacity (solver tolerance). The executor does not.
- Payback uses 52 sampled days of 2023, annualised, so seasonal sampling error applies.
- The vendored EMHASS optimiser tests pass in this environment (212 passed); the rest of the upstream suite was not run.

## Credits

EMHASS by David Hernandez Torres (MIT) is the planning engine, and pvlib-python (BSD-3) provides the PV model.
These projects were reviewed as references (their READMEs, not their code), and no code was taken from them:
alefunxo/P2P-communities-PV-Battery (Apache-2.0, Pena-Bello et al., Nature Energy 2022), MohdNematullah/Utility-Scale-BESS-Arbitrage-
(MIT), beckn/DEG, and several repositories without a licence. The reserve logic, forecaster, offer sizing, two-pass
planner, settlement and payback code here are original. Details in [NOTICE.md](NOTICE.md).
