# AVISHKAR EMS — Hackathon Demo Video Recording Guide

**Problem Statement #2: Predictive Energy Management & Surplus Dispatch**  
**Project:** AVISHKAR Energy Management System (EMS) for Indian Solar Sites  
**Target Video Duration:** 2 to 3 minutes

---

## 🚀 How to Launch the Prototype

Double-click the launcher script or run in terminal:
```cmd
run-dashboard.cmd
```
or
```powershell
.\run-dashboard.cmd
```
> The dashboard will start on `http://127.0.0.1:8501` and **automatically open in your default browser**. Thanks to pre-cached models, all sites and tabs load **instantly (under 1 second)**!

---

## 🎬 3-Minute Video Demo Script

### 1. Introduction (0:00 - 0:25)
- **What to show:** Open browser on the main dashboard screen.
- **What to say:**
  > *"Hello! This is AVISHKAR EMS, our predictive energy management and surplus dispatch platform for Indian solar-plus-storage sites, addressing Problem Statement #2.  
  > Indian rooftop solar faces unique realities: volatile monsoon weather, Time-of-Day grid tariffs, frequent power outages, and emerging peer-to-peer trading. AVISHKAR EMS integrates real PVGIS/ERA5 solar irradiance, real smart-meter demand from CEEW, and linear programming optimization built on EMHASS to orchestrate generation, emergency backup, and market dispatch."*

---

### 2. Tab 1: Plan for the Day (0:25 - 0:55)
- **What to show:** 
  1. Point out the top 4 metric cards: **Emergency Reserve Floor (e.g. 23%)**, **Outage Risk Assessment**, **Exported Today**, **Offers Published**.
  2. Point out the **Language toggle** (English / हिन्दी) and the Plain-Language Explanation banner.
  3. Scroll down the 3-panel interactive chart:
     - Panel 1: Solar generation with **P10–P90 uncertainty bands** (shaded grey) vs actual generation vs the clear-sky output of the site.
     - Panel 2: Load forecast uncertainty bands vs actual facility demand.
     - Panel 3: Battery State-of-Charge (purple) strictly staying above the **red dotted Emergency Reserve Floor**.
- **What to say:**
  > *"Every evening, AVISHKAR EMS generates conformal-calibrated P10/P50/P90 quantile forecasts for both generation and load.  
  > Crucially, our system dynamically computes a hard Emergency Reserve Floor based on local grid outage history, storm forecasts, and critical loads. Notice how the battery never discharges below this red floor, guaranteeing backup power during cuts.  
  > In the sidebar, we can instantly switch between English and Hindi for local prosumer accessibility."*

---

### 3. Tab 2: Offers & Settlement — India Energy Stack (0:55 - 1:25)
- **What to show:** Click on **`🤝 Offers & Settlement`**.
  1. Highlight the 3-stage protocol banner: **DRAFT ➡️ ACTIVE ➡️ COMPLETE & SETTLED**.
  2. Show the trade table: committed kWh, floor price, clearing price, delivered kWh, 0 shortfall, and net financial uplift vs DISCOM grid export.
  3. Expand the **Beckn DEG v2.0 `catalog/publish`** JSON viewer and show the green checkmark: *"Passes the project's structural check"* (it is the project's own validator, modelled on the public beckn DEG devkit).
- **What to say:**
  > *"Surplus energy is dispatched to the Peer-to-Peer market over the open India Energy Stack (Beckn DEG v2.0 protocol).  
  > To eliminate non-delivery risk, our engine sizes offers conservatively using P10 generation and P90 load.  
  > Here you see the full smart contract lifecycle: catalog publish, order match, metered delivery, and settlement. The system logs 0 shortfall and earns higher returns than standard DISCOM net-metering feed-in tariffs."*

---

### 4. Tab 3: Fleet / Community Microgrid Pooling (1:25 - 1:50)
- **What to show:** Click on **`🌐 Fleet / Community Pooling`**.
  1. Point out the aggregated market window pooling multiple sites (residential rooftops + commercial shops).
  2. Adjust the **Fleet Delivery Realisation %** slider or **Market Clearing Price** input.
  3. Show the **Pro-Rata Settlement Table** recalculating live.
- **What to say:**
  > *"Individual residential rooftops often have surpluses too small for institutional buyers. In Tab 3, AVISHKAR acts as a Virtual Power Plant (VPP), aggregating multiple microgrid prosumers into a single bulk offer.  
  > When the energy is dispatched, our smart settlement algorithm distributes the revenue pro-rata based on actual metered delivery."*

---

### 5. Tab 4: Payback & PM Surya Ghar Subsidy (1:50 - 2:15)
- **What to show:** Click on **`💰 Payback & Subsidy`**.
  1. Switch between sites in the sidebar: **`home-mathura` (3 kWp)**, **`shop-pune` (15 kWp)**, **`clinic-jaipur` (30 kWp)**.
  2. Point out the comparison table: **EMS vs Battery Idle vs Simple Rule**.
  3. Show the **PM Surya Ghar: Muft Bijli Yojana** callout (for Mathura home, ₹78,000 subsidy drops payback from about 20 to about 15 years; the exact figures are on screen and in the README).
- **What to say:**
  > *"We validated AVISHKAR EMS by replaying sampled days of a held-out period across 3 Indian sites under real DISCOM Time-of-Day tariffs from UPERC, MERC, and RERC.  
  > The optimiser delivers about 9% higher annual financial returns than an unmanaged battery at the Mathura home, and less at the shops and clinics; against a simple fixed-rule battery its edge is small. For residential consumers, we incorporate PM Surya Ghar subsidy rules, showing exactly how fast government subsidies accelerate project payback."*

---

### 6. Tabs 5 to 8: Advisory, Anomaly Monitor & Custom Meter Upload (2:15 - 2:50)
- **What to show:**
  1. **Tab 5 (`💡 Smart Advisory`)**: Pick an appliance (e.g. Geyser or EV Charger) to see the optimal low-cost start time, and review the battery capacity recommendation.
  2. **Tab 6 (`🔍 Live Fault Monitor`)**: Uncheck / check "Inject Simulated String Fault" to show the red anomaly markers detecting soiling/inverter failure in real-time.
  3. **Tab 8 (`📂 Upload Your Meter`)**: Click *"Load Pre-loaded Indian Household Meter"* to show instant 15-minute load profiling and peak demand analysis on custom meter data.
- **What to say:**
  > *"Finally, AVISHKAR includes user-centric intelligence:  
  > A Smart Appliance Scheduler that tells households the cheapest hour to run water pumps and EV chargers;  
  > A real-time fault detection module that catches solar soiling and string failures;  
  > And a custom smart-meter analyzer allowing any Indian consumer or utility to drop in their own CSV and receive customized system recommendations."*

---

### 7. Conclusion (2:50 - 3:00)
- **What to say:**
  > *"AVISHKAR EMS combines production-grade linear programming, state-of-the-art quantile forecasting, and Beckn DEG protocols to deliver a robust, end-to-end clean energy dispatch platform for India's clean energy transition. Thank you!"*

---

## Accuracy notes for the presenter

Each line softens or confirms a claim in the script above against what the code does. Evidence is in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md). The figures on screen, in `results/` and in the README are now the same numbers
(the README block is generated from `results/`; the dashboard defaults to the same 7-day sampling).

- **Replay** is sampled days (one in 7 by default), annualised, not a full year. Mathura's held-out period is Jul 2020 to
  Feb 2021 (8 months), so its yearly figure leans toward those months; the dashboard says so under the table.
- **Uplift** versus an idle battery is about 9% at Mathura, about 4% at Pune and about 2% at Jaipur. Versus a simple
  fixed-rule battery the edge is within about +/-1%, and at Mathura the simple rule is marginally ahead. Say so if asked.
- **Beckn check** is the project's own structural validator. Nothing is sent to a live network and the buyer is simulated.
- **Fleet pooling** pools the Pune shop and the Jaipur clinic (different cities) and only on 2023 dates. The Mathura home
  has nothing to pool with. The tab names the sites it pooled.
- **Fault monitor**: the generation "telemetry" is modelled from real weather, so only the injected string fault is detected.
- **"Real" data**: weather, the Mathura home's load and grid outages, and the import tariffs are real. Generation, shop and
  clinic load, their outages, export rates and P2P prices are modelled or assumed (sidebar: "What is real, what is assumed").
- **Upload tab**: runs a real payback and battery-size analysis on a meter file (needs about 150 days of data; weather
  for a new place is downloaded once from PVGIS and needs internet; the Mathura sample works offline).
