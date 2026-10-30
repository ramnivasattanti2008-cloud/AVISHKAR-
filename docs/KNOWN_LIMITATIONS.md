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


---

## Added 2026-10-30, after starting both applications in a fresh container

These are boundaries found by running the software, not by reading it. The per-issue detail is in
[KNOWN_ISSUES.md](KNOWN_ISSUES.md) items 24-29 and the 2026-10-30 section of
[../platform/STATUS.md](../platform/STATUS.md).

### Deployment: the images are verified, a deployment is not
*Corrected later on 2026-10-30.* `dockerd` does run in this container, so the images were built and the whole
stack was brought up for the first time: all four services reach `healthy`, the documented migrate-and-seed
sequence works, and the containerised stack passes the journey (41/41), the browser checks (21/21) and smoke
(12/12). Two defects that only a built image could show were found and fixed -- `db:seed` could not reach the
tariff and policy files, and the map was blank in every container.

What remains unverified is a **deployment**, as opposed to the images: it has not been run on a real host, behind
TLS, with a domain and a tile service of the operator's own. The session cookie is `Secure` in production, which
browsers honour only over https or on localhost, so TLS in front of the web app is not optional. A tile service
also has a usage policy: the public OpenStreetMap server is for development and light use, and a deployment
should point `NEXT_PUBLIC_MAP_TILE_URL` at its own or a commercial one.

The builds in this container needed `--network=host` and a temporary layer trusting the sandbox's TLS-intercepting
proxy. That shim is not committed and is not needed where outbound TLS is not intercepted.

### Peer-to-peer allocation is a calculation, not a transfer
`platform/api/src/community/allocate.ts` and `avishkar_ems.home_balance.route_community_exchange` work out which
property's surplus could meet which other's deficit, what the network would lose carrying it, and what each side
would gain. They move no electricity. Whether a surplus may be sent to a neighbour at all depends on the law, the
distribution licensee's rules, the metering arrangement and the wiring where those properties are — none of which
this software knows or asserts. Every response carries that statement, and the pages repeat it.

Two further limits of those models, stated in the code:
- The order of steps (own generation, own battery, the shared node, the grid) is an **accounting convention**, not
  something an optimiser discovered. A pooled node cannot say which kW of one property's surplus reached which
  neighbour, so the pair-by-pair figures divide each sender over the receivers in the proportion they were served.
- The I²R loss in the Python path assumes a single-phase feeder at unity power factor with the whole line as one
  lumped resistance. It ignores the voltage drop along that line (which would itself change the current), reactive
  power and the three-phase case.

### No sanctioned load is held, so no import limit is applied by default
The platform schema has no field for a property's sanctioned load. When an allocation is built from the owner's own
properties, the response says `import limit: not known` in that member's `basis` and applies none. That is not a
statement that there is no limit — it is a statement that AVISHKAR does not know it. Pass one in the request to see
what it would do.

### A fresh install is not the environment the published numbers came from
`pip install -e ".[app,test]"` resolves `pandas>=2.2.0` to pandas 3.0.5. The numbers in the README and under
`results/` come from `requirements-lock.txt` (pandas 2.3.3, numpy 2.2.6, scipy 1.18.1, scikit-learn 1.9.1,
pvlib 0.16.1, highspy 1.15.1). Reproducing them to the stated 1e-11 INR needs that file.

### The documented test runtime assumes a warm cache
`CLAUDE.md` gives the EMS suite as about 100 seconds. From an empty `data/cache/` it took **41 minutes 27 seconds**
here, because every test needing a prepared site trains the quantile models from scratch. The same suite then ran
in 90 seconds. Run `python scripts/precompute_cache.py` first, or expect the long run.

### Still simulated, and labelled as such
No inverter, meter, Modbus device or gateway was present. Every device path — `hardware_modbus.py`,
`inverter_adapters.py`, `anti_islanding.py`, `api/src/control` — is simulated, and an approval in the control
module is a record and nothing more. Nothing in this repository supports a claim of electrical certification,
anti-islanding validation, grid-code compliance or hardware testing, and nothing in it makes one.
