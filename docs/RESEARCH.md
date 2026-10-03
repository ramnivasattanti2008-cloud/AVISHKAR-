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
