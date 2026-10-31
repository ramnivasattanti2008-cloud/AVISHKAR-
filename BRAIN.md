# BRAIN.md — UrjaSetu Algorithmic Memory, Mathematical Formulations & Decision Ledger

> **Purpose**: This document serves as the persistent architectural brain, algorithmic memory, and mathematical foundation of UrjaSetu (AVISHKAR). Any engineer or AI coding agent working on this codebase must consult this document to understand the *why* behind every formula, constraint, and invariant.

---

## 1. Architectural Decisions Ledger (Invariants D1–D14)

The platform was built under 14 foundational architectural decisions recorded in `platform/ARCHITECTURE.md`. These hold across every mode, host, and refactoring pass:

* **D1 (Fastify API + FastAPI Engine Split)**: Fastify (Node.js) provides high-concurrency HTTP/2, streaming I/O, session management, and PostGIS queries; FastAPI (Python) encapsulates mathematical optimization, pvlib physical modeling, and scikit-learn/LightGBM quantile regression. They communicate via an authenticated loopback channel.
* **D2 (PostgreSQL + PostGIS via Prisma Raw SQL)**: Relational structures use Prisma ORM; spatial queries (geodesic building areas, bounding box intersections, coordinate transformations) use parameterized raw SQL (`$queryRaw`) against PostGIS primitives to avoid Prisma spatial abstraction limitations.
* **D3 (In-Process Job Runner with Database Locks)**: Background jobs (tariff validity, forecast scoring, satellite ingestion) run within the API process under advisory database locks (`job_runs` table), preventing split-brain execution across multi-instance clusters without requiring external queue infrastructure.
* **D4 (Cryptographic Provenance Envelope)**: Every number returned by the API carries a status envelope (`LIVE`, `UPDATED`, `FORECAST`, `ESTIMATED`, `SIMULATED`, `DEMO`, `REFERENCE`, `UNAVAILABLE`) and cryptographic observation hashes. The database enforces a `CHECK` constraint that rejects `LIVE` data missing an observation timestamp.
* **D5 (Stale-if-Error & Tiered Fallbacks)**: External provider calls (Nominatim, Overpass, Open-Meteo, NASA POWER) implement local DB caching, rate-limited backoffs, and secondary fallback mirrors (`overpass.kumi.systems`, `overpass.private.coffee`). If all fail, stale cached data is returned with an `UPDATED` label rather than throwing a fatal error.
* **D6 & D7 (Strict Data Honesty — Never Fabricate)**: The platform never invents synthetic numbers to populate empty UI cards. If solar generation meter data, grid outage schedules, or city-wide feeder metrics do not exist, the field is labeled `UNAVAILABLE` with an explicit explanation.
* **D8 (Honest Satellite Limits)**: A satellite revisit period of ~5 days (Sentinel-2) cannot support a minutes-ahead cloud nowcast. The cloud nowcast endpoint explicitly returns `UNAVAILABLE` rather than extrapolating speculative clouds.
* **D9 (NavIC Positioning Abstraction)**: Browser geolocation is strictly labeled "Browser Geolocation (WGS 84)". The API refuses to label any fix as NavIC unless `NAVIC_RECEIVER_ENABLED=true` and hardware NMEA/GNSS receiver telemetry is verified.
* **D10 (Tariffs & Policy as Sourced Data)**: Electricity tariffs and subsidies are strictly isolated in `data/tariffs/` and `data/policy/` as versioned JSON records bearing official regulatory order citations, effective date windows, and checksums. Code never hardcodes rupee rates.
* **D11 (Demo World Isolation)**: Demo properties are stamped with `isDemo: true`. A global request hook (`relabelDemo`) intercepts every response and relabels computed values as `DEMO`, ensuring simulated sandboxes never contaminate real customer records.
* **D12 (Tool-Grounded AI Copilot)**: The Copilot does not allow free-form LLM hallucinations. All responses are worded strictly from the structured output of 20 deterministic tools, with citations linking each figure directly to a tool execution record.
* **D13 (First-Party Web Proxy Architecture)**: The Next.js frontend proxies `/api/*` requests to the Fastify backend on the same origin. This completely eliminates Cross-Origin Resource Sharing (CORS) security risks and allows session cookies to use `SameSite=Lax; HttpOnly; Secure`.
* **D14 (Deterministic Engine Fallback)**: The platform functions completely without external paid API keys. When `ANTHROPIC_API_KEY` is omitted, the Copilot executes deterministic template synthesis; when commercial map keys are omitted, MapLibre falls back to attribution-compliant raster basemaps.

---

## 2. Mathematical & Algorithmic Formulations

### 2.1. Day-Ahead MILP Dispatch Optimization

The numerical engine solves a Mixed-Integer Linear Program (MILP) across $T = 96$ fifteen-minute intervals ($\Delta t = 0.25\text{ h}$) over a 24-hour horizon.

#### Objective Function:
$$\min \sum_{t=0}^{T-1} \left[ w_{cost} \cdot \left( c_t^{imp} P_{grid,t}^{imp} - c_t^{exp} P_{grid,t}^{exp} + c_{wear} P_{batt,t}^{dis} \right) + w_{carbon} \cdot e_t P_{grid,t}^{imp} - w_{indep} \cdot (P_{pv,t}^{used} + P_{batt,t}^{dis}) \right] \Delta t + \sum_{j} \text{Penalty}_j$$

Where:
* $c_t^{imp}$: Time-of-Day import tariff (₹/kWh).
* $c_t^{exp}$: Solar net-metering export credit (₹/kWh).
* $c_{wear}$: Battery degradation wear cost (typically ₹2.0/kWh cycled).
* $e_t$: Grid emission factor ($kg\text{ CO}_2/\text{kWh}$).
* $P_{batt,t}^{ch}, P_{batt,t}^{dis}$: Battery charging and discharging power (kW).
* $P_{grid,t}^{imp}, P_{grid,t}^{exp}$: Grid import and export power (kW).

#### System Constraints:
1. **Power Balance at Every Timestep $t$**:
   $$P_{load,t} + P_{batt,t}^{ch} + P_{grid,t}^{exp} = P_{pv,t} + P_{batt,t}^{dis} + P_{grid,t}^{imp}$$
2. **Battery State-of-Charge (SOC) Dynamics**:
   $$SOC_{t+1} = SOC_t + \left( \eta_{ch} P_{batt,t}^{ch} - \frac{1}{\eta_{dis}} P_{batt,t}^{dis} \right) \frac{\Delta t}{C_{batt}}$$
   Where $C_{batt}$ is nominal battery capacity (kWh), and $\eta_{ch} = \eta_{dis} = \sqrt{\eta_{roundtrip}}$ (one-way efficiency).
3. **Hard Reserve Floor Constraint**:
   $$SOC_t \ge SOC_{floor,t} \quad \forall t \in [0, T-1]$$
   Where $SOC_{floor,t}$ is dynamically determined by the emergency backup requirement:
   $$SOC_{floor,t} = \max\left( SOC_{min}, \frac{P_{critical} \cdot \text{BackupHours}}{C_{batt} \cdot \eta_{dis}} \cdot (1 + \text{RiskUplift}) \right)$$
4. **Physical Inverter & Power Limits**:
   $$0 \le P_{batt,t}^{ch} \le P_{batt}^{max}, \quad 0 \le P_{batt,t}^{dis} \le P_{batt}^{max}$$
   $$P_{grid,t}^{imp} \le P_{ac}^{max}, \quad P_{grid,t}^{exp} \le P_{ac}^{max}$$
   $$P_{batt,t}^{ch} \cdot P_{batt,t}^{dis} = 0 \quad (\text{enforced via binary variables } z_t \in \{0, 1\})$$

---

### 2.2. Physical Solar Generation Model (`pvlib`)

Solar generation is physically synthesized from meteorological forecasts rather than ungrounded curve fitting:

1. **Clear-Sky Irradiance (Simplified Solis Model)**:
   Computes extraterrestrial normal irradiance $I_0$ and atmospheric optical depth to establish upper clear-sky bounds:
   $$GHI_{clear} = I_0 \cdot \cos(\theta_z) \cdot \exp\left( -\frac{\tau_g}{\cos(\theta_z)^b} \right)$$
2. **Diffuse Fraction Decomposition (Erbs Model)**:
   Decomposes Global Horizontal Irradiance ($GHI$) into Direct Normal Irradiance ($DNI$) and Diffuse Horizontal Irradiance ($DHI$) based on the clearness index $k_t = \frac{GHI}{GHI_{extra}}$:
   $$k_d = \frac{DHI}{GHI} = \begin{cases} 
   1.0 - 0.09 k_t & k_t \le 0.22 \\
   0.9511 - 0.1604 k_t + 4.388 k_t^2 - 16.638 k_t^3 + 12.336 k_t^4 & 0.22 < k_t \le 0.80 \\
   0.165 & k_t > 0.80 
   \end{cases}$$
3. **Plane of Array (POA) Transposition (Isotropic Model)**:
   Transposes horizontal components to panel tilt angle $\beta$ and azimuth $\gamma$:
   $$POA = DNI \cdot \cos(\theta) + DHI \cdot \left( \frac{1 + \cos(\beta)}{2} \right) + GHI \cdot \rho \cdot \left( \frac{1 - \cos(\beta)}{2} \right)$$
   Where $\theta$ is angle of incidence, and $\rho$ is ground albedo (default 0.20).
4. **Thermal Derating & System Output**:
   $$T_{cell} = T_{amb} + POA \cdot \left( \frac{NOCT - 20}{800} \right)$$
   $$P_{pv} = P_{dc,stc} \cdot \left( \frac{POA}{1000\text{ W/m}^2} \right) \cdot \left[ 1 + \gamma_{temp} (T_{cell} - 25^\circ\text{C}) \right] \cdot (1 - \text{Loss}_{fixed})$$

---

### 2.3. Conformalized Quantile Load Forecasting

Predicting building demand requires honest uncertainty bounds:
1. **Feature Engineering**:
   - Lagged consumption: $y_{t-1}, y_{t-2}, y_{t-96}$ (same step yesterday), $y_{t-672}$ (same step last week).
   - Calendar harmonics: $\sin(2\pi h / 24), \cos(2\pi h / 24), \text{IsWeekend}(t)$.
2. **Quantile Regression via Pinball Loss**:
   Trains three Gradient Boosted Decision Tree (LightGBM) models for quantiles $\tau \in \{0.10, 0.50, 0.90\}$ using pinball loss:
   $$\mathcal{L}_\tau(y, \hat{y}) = \max\left( \tau (y - \hat{y}), (1 - \tau)(\hat{y} - y) \right)$$
3. **Conformal Holdout Calibration**:
   Raw quantile regressions can suffer from empirical coverage under-estimation. The engine calculates calibration conformity scores $s_i = \max(y_i - \hat{y}_{0.90}, \hat{y}_{0.10} - y_i)$ on a chronological holdout dataset to adjust the prediction band interval, guaranteeing an 80% empirical coverage target on unseen days.

---

### 2.4. Risk-Aware Maximin Optimization (`risk_optim.py`)

To protect critical facilities (hospitals, schools, cold chains) from solar shortfall or demand surges, the engine solves a robust maximin wrapper:

1. **Explicit Scenario Space**:
   $$\mathcal{S} = \{ \text{baseline: } (P50_{pv}, P50_{ld}), \text{shortfall: } (P10_{pv}, P50_{ld}), \text{surge: } (P50_{pv}, P90_{ld}), \text{combined: } (P10_{pv}, P90_{ld}) \}$$
2. **Convex Hedging Formulation**:
   Given risk-aversion weight $\alpha \in [0, 1]$:
   $$\widetilde{PV}_t(\alpha) = (1 - \alpha) P50_{pv,t} + \alpha P10_{pv,t}$$
   $$\widetilde{Load}_t(\alpha) = (1 - \alpha) P50_{ld,t} + \alpha P90_{ld,t}$$
3. **Shortfall & Regret Metrics**:
   For any plan evaluated under scenario $s \in \mathcal{S}$:
   $$\text{Regret} = \text{Cost}(s) - \text{Cost}(\text{baseline})$$
   $$\text{Shortfall Penalty} = \sum_{t} \max\left(0, P_{unserved,t}\right) \cdot \text{PenaltyRate}$$

---

### 2.5. Energy Attribution Ledger (Accounting Convention)

Because electrons do not carry tags, attribution is governed by a strict 5-stage priority accounting convention:

```
Step 1: Solar Generated (S)
        ├─► Served to Demand: min(S, Demand)
        ├─► Stored in Battery: min(S - Demand, Battery Headroom)
        ├─► Exported to Grid: min(S - Demand - Stored, Grid Limit)
        └─► Curtailed: Residual

Step 2: Battery Energy Origin Queue (FIFO)
        Delivered energy is traced backwards to the timestamp and irradiance conditions
        under which it was stored, accounting for round-trip thermodynamic losses.
```

---

### 2.6. Bills-to-Profile Reconstruction (`bills.py`)

For consumers lacking interval smart meters:
1. Takes monthly utility totals $B_m$ (kWh) across months $m \in \{1..12\}$.
2. Daily energy: $E_{daily,m} = \frac{B_m}{\text{DaysInMonth}(m)}$.
3. Scales empirical CEEW diurnal weights $w_h$ ($h \in [0..23]$, $\sum w_h = 1.0$):
   $$P_{h,d,m} = E_{daily,m} \cdot w_h$$
4. **Exact Energy Conservation Identity**:
   $$\sum_{d=1}^{\text{Days}(m)} \sum_{h=0}^{23} P_{h,d,m} \Delta t \equiv B_m \quad \forall m$$

---

## 3. Operational Gotchas & Critical Lessons Learned

* **1. Fastify Zod Serialization**: Adding a field to a DTO (e.g. `meterReadings.rows`) has no effect if the corresponding route's Fastify response schema does not model it. Fastify's compiled serializers silently strip unmodeled fields. Always update route schemas in tandem.
* **2. Bash Script Argument Parsing Flaw**: In shell scripts (e.g. `restore-db.sh`), command-line argument parsing (`getopts` or `while [[ "$#" -gt 0 ]]`) must execute *before* validating file extensions or checking GPG headers. Otherwise, parameters like `--file archive.sql.gpg` will fail format checks before being parsed.
* **3. Empty CSV Sniffer Crash**: Feeding an empty file into `pd.read_csv(..., engine="python")` triggers a fatal `_csv.Error: Could not determine delimiter`. Always inspect `file.stat().st_size` upfront and raise an explicit `ValueError("meter CSV is empty")`.
* **4. Shared Test Database Concurrency**: All API integration tests run against a single PostgreSQL instance (`DATABASE_URL_TEST`). Never run two test commands concurrently, as they will truncate each other's test data.
* **5. Vendored Code Immutability**: The directory `src/emhass/` is vendored upstream code and must never be edited. All custom algorithms must reside in `src/avishkar_ems/` or `platform/`.
* **6. README Results Block Consistency**: The results block in `README.md` is generated programmatically from `results/` by `scripts/update_readme.py`. Hand-editing this block will cause CI failure on `scripts/update_readme.py --check`.
