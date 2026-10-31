# Third-party notice

This repository is built on top of **EMHASS** (Energy Management for Home Assistant),
by David Hernandez Torres, MIT licence. Upstream: https://github.com/davidusb-geek/emhass
Vendored from commit 237d0fe4089f76ff5f8bbcae24876e64008e60ad (2026-09-29). The original licence is kept in LICENSE.

Everything under `src/emhass/`, `data/` and `tests/` (except `tests/avishkar_ems/`) is upstream code, unmodified. Only `pyproject.toml` was edited, to package `avishkar_ems` and add a Streamlit extra.
Everything under `src/avishkar_ems/` is new work for the AVISHKAR FET Hackathon (problem statement #2).

## Vendored source, with provenance

**SEM (Solar Energy Management), `traktore-org/sem-community`** -- MIT, Copyright (c) 2025 belinea4071.
Commit `067c8615a36fbad2cc912a005f63525038093b07`. Seven pure functions of surplus arithmetic are
vendored **verbatim** into `src/avishkar_ems/vendor/sem_surplus.py` from
`coordinator/surplus_controller.py` (and `_name` from `coordinator/price_signal.py`); the module's own
docstring records the exact line ranges and the three things that were added around them. The licence
text is kept at `src/avishkar_ems/vendor/LICENSES/sem-community-MIT.txt`. Four of upstream's own test
classes (24 tests) are vendored verbatim too and are run against the copy by
`tests/avishkar_ems/test_vendored_sem_surplus.py`, which is how the copy is known to be faithful.
Full provenance table: `docs/OPEN_SOURCE_INTEGRATION_MAP.md`.

Reviewed as references (READMEs and public descriptions only; no code was copied from any of them):
- pvlib-python (BSD-3-Clause): PV modelling library, used as a dependency through EMHASS and directly in `pvmodel.py`
- alefunxo/P2P-communities-PV-Battery (Apache-2.0): peer-to-peer energy community modelling
- MohdNematullah/Utility-Scale-BESS-Arbitrage- (MIT): battery dispatch backtesting
- beckn/DEG (Digital Energy Grid specs): UEI/Beckn message structure
- Repositories without a licence (for example Gokul123-git/Battery-Storage-Dispatch-and-Price-Arbitrage-Agent,
  namanraii/SolarSponge, Sanjay-dev22/p2p-trading-demo-app) were looked at for ideas only.

## Data and formats added in the real-data pass
- Weather: PVGIS (EU JRC, ERA5 reanalysis) via `pvlib.iotools.get_pvgis_hourly`; cached CSVs in `data/real/`.
- Load: Tjaden, T., "Electrical load profile from a tool manufacturer", Zenodo 4683455, CC-BY 4.0 (`data/real/load_tool.csv`).
- Offer format: beckn/DEG `p2p-trading-ies-wave2` devkit (CC BY-NC-SA 4.0). Only the message structure is followed; no files are copied.
- Household load and outages: Agrawal, Mani, Jain, Ganesan (CEEW), "High frequency smart meter data from two districts in India (Mathura and Bareilly)", Harvard Dataverse, doi:10.7910/DVN/GOCHJH, CC0 1.0. Processed 15-minute CSVs for meters MH43 and MH21 are in `data/real/`.

## Rules and sources used for the everyday-user features
- Time-of-Day tariff minimums: PIB (Ministry of Power) release 1945236.
- Subsidy slabs: PM Surya Ghar: Muft Bijli Yojana (pmsuryaghar.gov.in). Applied as a simple formula in `subsidy.py`; eligibility is the user's to confirm.
- Competitor review (EMHASS, Predbat, vendor apps): public descriptions only, summarised in `docs/RESEARCH.md`. No code copied.

**A correction, 2026-10-31.** `src/avishkar_ems/surplus_engine.py` opens by saying it "synthesizes best
practices from" eight named projects, SEM and evcc among them. That reads as reuse and is not: it was
written from scratch, and this file's own list said as much. The docstring now says which parts are its
own and points at the one module that really is vendored. Where a project's code is genuinely used it is
under `src/avishkar_ems/vendor/` with its commit, its licence and its upstream tests.
