# Third-party notice

This repository is built on top of **EMHASS** (Energy Management for Home Assistant),
by David Hernandez Torres, MIT licence. Upstream: https://github.com/davidusb-geek/emhass
Vendored from commit 237d0fe4089f76ff5f8bbcae24876e64008e60ad (2026-09-29). The original licence is kept in LICENSE.

Everything under `src/emhass/`, `data/` and `tests/` (except `tests/avishkar_ems/`) is upstream code, unmodified. Only `pyproject.toml` was edited, to package `avishkar_ems` and add a Streamlit extra.
Everything under `src/avishkar_ems/` is new work for the AVISHKAR FET Hackathon (problem statement #2).

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
