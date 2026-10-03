# Research notes: what already exists, and what this project adds

These notes record what I looked at before adding features, and why. Claims about other tools come from their public
READMEs and product pages, not from running them.

## Similar tools

| Tool | What it does well | Why it is not enough for an Indian home or shop |
|---|---|---|
| EMHASS | Solid optimiser, mature, active, MIT licence. It is our planning engine. | Aimed at Home Assistant users. No Indian tariffs, no outage reserve, no P2P offers, no settlement, no payback view. Setup is not friendly for a non-technical owner. |
| Predbat | Well liked battery planner for Home Assistant. | Built around UK tariffs and inverters. Needs Home Assistant. |
| Tesla app and SolarEdge/Enphase apps | Polished monitoring and some storm backup logic. | Tied to the maker's own hardware, and the planning logic is not open to inspect. |
| Research P2P community models (for example Pena-Bello et al.) | Good studies of shared batteries and community trading. | Research code for papers, not something an owner can run on their own meter data. |
| Beckn DEG / India Energy Stack | The offer format for P2P energy in India. | A specification, not a planner. It does not decide how much to offer. |

## Rules that shape the design

- Time-of-Day tariffs. The central rules (PIB release 1945236) ask for solar-hour rates at least 20% lower than the
  normal rate, and peak rates at least 1.2x (commercial and industrial) or 1.1x (other consumers). `tod_from_base()`
  builds a tariff from a bill's base rate using exactly these minimums. The real state tariff will differ, so it stays a
  starting point until you enter the rates from your bill.
- PM Surya Ghar. Rs 30,000 per kW for the first 2 kW and Rs 18,000 for the third kW, capped at Rs 78,000, for
  residential rooftop systems. `subsidy.py` applies this and the payback table shows a before and after figure. It is
  not a guarantee: eligibility and DISCOM approval decide whether you get it.

## Gaps I found, and what was built for each

| Gap | Feature | Where |
|---|---|---|
| Tools tell you what they did but not why | Plain-language reasons for the day's plan, in English and Hindi | `explain.py`, Advice tab |
| Owners do not know when to run a geyser or a pump | Ranks start times by cost using the day's forecast | `loads.py`, Advice tab |
| Nobody says how big the battery should be | Tries several sizes on held-out days and reports bill benefit, backup hours and repayment | `advisor.py`, Advice tab |
| Most people have a meter file, not a modelled site | Reads a meter CSV (kW, W, kWh or Wh, loose column names, short gaps filled) and analyses it | `userdata.py`, `examples/analyze_my_site.py` |
| Subsidy is ignored in payback | Payback shown before and after the subsidy | `subsidy.py`, `payback.py` |
| Tariffs are guessed | Rule-based ToD tariff builder, plus a JSON loader for real DISCOM rates | `tariffs.py`, `data/tariffs/` |

## What this project does not claim

- Tariffs, P2P prices and the assumed battery price (Rs 25,000 per kWh) are assumptions. Replace them with your bill and
  a real quote.
- Generation is modelled from real weather, not read from an inverter.
- Day-ahead forecast inputs are persistence of yesterday's clearness.
- Nothing was sent to a live P2P network. The buyer side is simulated.
- If your meter file has no outage information, the analyser assumes no outages. Backup advice then rests on the hours
  you ask for, not on measured cuts.
- A battery usually does not repay itself from bill savings alone at these tariffs. The advisor says so when that is
  true, and recommends buying for backup.

## Sources

- PIB, Ministry of Power, Time-of-Day tariff release: https://pib.gov.in (release 1945236)
- PM Surya Ghar: Muft Bijli Yojana, subsidy structure: https://pmsuryaghar.gov.in
- EMHASS: https://github.com/davidusb-geek/emhass
- Predbat: https://github.com/springfall2008/batpred
- Beckn DEG: https://github.com/beckn/DEG
- PVGIS: https://re.jrc.ec.europa.eu/pvg_tools/en/
- CEEW smart meter data: doi:10.7910/DVN/GOCHJH

## First real tariff: UPPCL (Mathura home)

Read from the UPERC tariff order for FY2025-26 (Annexure I, rate schedules). Urban domestic (LMV-1) energy charge is
Rs 5.50/kWh up to 150 units a month, Rs 6.00 for 151 to 300, and Rs 6.50 above 300, with a fixed charge of Rs 110/kW a
month. The Mathura home uses about 490 units a month, so the model uses Rs 6.50 as its marginal rate. Two things to know:

- LMV-1 has no Time-of-Day rate. The order's ToD table exists for industrial (LMV-6) and similar categories, and there
  the winter midday rate is the base rate (0%), not cheaper, which differs from the central guidance above.
- The order says net metering allows 100% banking and withdrawal of banked power. The model still uses an export rate of
  Rs 3 because I did not find the year-end settlement rate. If banking gives you retail value for exports, the battery
  adds less than the figures here show (see the sensitivity table).

A third-party bill calculator I checked first listed different, wrong rates, so only the order itself is used.

## Pune and Jaipur tariffs

- **Pune (MSEDCL, LT II non-residential, 0 to 20 kW).** From the MERC multi-year tariff order of March 2025 and its June
  2025 review order (Case 75 of 2025). Energy charge Rs 6.60 plus wheeling Rs 1.24 per kWh. The review order sets
  Time-of-Day on the energy charge: solar hours (9 to 17) 20% cheaper on average (15% in April to September, 25% in
  October to March), and 17 to 24 hours 25% dearer for commercial users. The model uses the 20% average all year. The
  fixed charge (Rs 520 per connection a month) is not modelled. The review order also removed the night rebate that the
  first order had.
- **Jaipur (RERC "Tariff for Supply of Electricity-2025", from 1 October 2025).** I read the text as published by the
  Jodhpur discom; the three Rajasthan discoms follow the same commission order, but check the JVVNL copy. Non-domestic
  above 5 kW: Rs 7.00 for the first 100 units and Rs 8.50 above, so the model uses Rs 8.50. For loads above 10 kW with a
  ToD meter: 12 to 16 hours 10% rebate, 6 to 8 hours 5% extra, 18 to 22 hours 10% extra. Fixed charges not modelled.
- Neither order gave an export rate I could use, so export stays at the earlier assumption.

## Two bugs found while testing against these tariffs

- The reserve floor ignored the unusable bottom 10% of the battery, so a reserve meant for 4 hours covered about 3.
- During a cut the simulator fed the whole load from the battery instead of only the critical load, so a long cut could
  drain the battery below what the critical load needed.

Both are fixed, with a regression test for the second. The fixes changed every site's numbers, and the README shows the
new ones. The effect is that the fixed-rule battery now slightly beats the optimiser at Jaipur.
