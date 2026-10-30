# AVISHKAR: Known Limitations and Hardware/Data Boundaries

**Document Purpose:** In accordance with AVISHKAR Core Invariant D6/D7 (*"Data honesty is the product: never present simulated, estimated or demo data as live; label every value's status"*), this document records the real-world operational and environmental boundaries of the current implementation.

---

## 1. Physical Actuation vs. Software Advisory Mode
- **Current State:** The optimization engine calculates mathematically rigorous, 15-minute dispatch setpoints for battery charging, discharging, load shifting, and grid export.
- **Limitation:** The platform operates in **Advisory Mode**. It issues commands to simulated devices or generates executable schedules. Physical dispatch to real inverters (e.g. via Modbus RTU/TCP or proprietary cloud APIs like SolarEdge, Enphase, Sungrow) requires certified on-site gateway hardware.
- **Safety Boundary:** Inverter islanding, grid disconnection, and anti-islanding electrical protection must be handled by certified hardware (UL 1741, IEEE 1547, CEA regulations). Software cannot replace electrical switchgear.

---

## 2. Satellite Nowcasting vs. Solar Forecasting
- **Current State:** AVISHKAR fetches Sentinel-2 metadata via the Earth Search STAC API to record cloud cover percentage and acquisition timestamps.
- **Limitation:** Minute-by-minute optical cloud-vector nowcasting is explicitly marked `UNAVAILABLE`.
- **Reason:** Sentinel-2 has a 5-day orbital revisit cycle. Real optical nowcasting requires 15-minute geostationary feeds (such as INSAT-3D/3DR from IMD) which do not currently offer open real-time programmatic REST APIs. Day-ahead solar forecasting uses pvlib driven by Open-Meteo irradiance models with calibrated error bands instead.

---

## 3. Real Municipal Grid Telemetry vs. Open Data
- **Current State:** The City Energy Map (`CityView.tsx`) visualizes geographic solar irradiance cells and user-owned installations across Indian cities (e.g., Bengaluru, Pune, Jaipur).
- **Limitation:** City-wide electricity demand, commercial flexibility, and distribution feeder congestion are explicitly declared as having **no public data source**.
- **Reason:** Indian DISCOMs (e.g., BESCOM, MSEDCL, JVVNL) do not publish real-time substation or feeder-level SCADA demand data via public APIs.

---

## 4. Grid Outage Forecasting
- **Current State:** The Mathura site uses measured historical grid outage logs from CEEW smart meter MH43. Dynamic reserve floors are scaled using a heuristic noisy-OR of storm forecasts and historical risk.
- **Limitation:** The platform does not forecast future unannounced grid cuts at commercial sites (Pune/Jaipur) because DISCOMs do not provide outage notification feeds.
- **Behavior:** The system conservatively sets a static reserve floor and calculates islanded runtime based on connected battery capacity and critical circuit power ratings.

---

## 5. Peer-to-Peer Energy Trading Network Status
- **Current State:** AVISHKAR formulates Beckn DEG v2.0 schema-compliant `catalog/publish` and `confirm` trade messages with conservative surplus sizing (P10 PV − P90 Load).
- **Limitation:** P2P energy trades are executed in **simulation mode**.
- **Reason:** Physical wheeling of electricity across consumer meters requires regulatory approval under state DISCOM open-access/peer-to-peer pilot frameworks (e.g., UP, Karnataka, Delhi pilots). The software confirms message validity against the India Energy Stack schema without transmitting money or physical electrons over public utility wires.

---

## 6. Large Language Model Integration
- **Current State:** The AI Energy Copilot implements 20 domain tools and generates answers using validated deterministic templates with strict citation verification (`guard.ts`).
- **Limitation:** Natural-language dynamic rewording via Anthropic Claude requires a user-supplied `ANTHROPIC_API_KEY`.
- **Behavior:** When the key is absent, the Copilot falls back gracefully to deterministic, grounded factual templates with 100% numerical accuracy.

