# Geographic Coverage & Boundary Integrity — UrjaSetu EMS

## 1. Geographic Hierarchy Model

UrjaSetu EMS enforces a five-tier geographic hierarchy:

```
National (India: IN)
  └── State (Karnataka: KA, Andhra Pradesh: AP)
        ├── District (Bengaluru Urban: KA_BLR_URBAN, Visakhapatnam: AP_VSKP)
        └── Utility Service Territory (BESCOM, APEPDCL)
              └── Household / Consumer Premise (BLR_DOM_001, VSKP_DOM_002)
```

### Critical Boundary Distinctions:
1. **BESCOM $\neq$ Bengaluru District**:
   - The Bangalore Electricity Supply Company Limited (BESCOM) serves **8 administrative districts** in Karnataka: Bengaluru Urban, Bengaluru Rural, Chikkaballapura, Kolar, Davanagere, Chitradurga, Tumakuru, and Ramanagara.
   - Attributing BESCOM-wide consumption to Bengaluru Urban alone would overstate district demand by 30–45%.
   - BESCOM telemetry is classified strictly under `GeoLevel.UTILITY`, never `GeoLevel.DISTRICT`.

2. **APEPDCL $\neq$ Visakhapatnam**:
   - The Andhra Pradesh Eastern Power Distribution Company Limited (APEPDCL) operates across **5 coastal districts**: Srikakulam, Vizianagaram, Visakhapatnam, East Godavari, and West Godavari.
   - Utility-wide figures cannot be presented as Visakhapatnam district observations.

3. **Anti-Disaggregation Guard**:
   - Under no circumstances does UrjaSetu divide state-level energy totals by district count or population share.
   - If district-level direct observations are absent, the application displays an explicit status: **"Metric unavailable at district level in official CEA series."**

---

## 2. Canonical Entities Catalog

| Entity ID | Name | Hierarchy Level | Parent Entity | Official Code / Reference |
|---|---|---|---|---|
| `IN` | Republic of India | `NATIONAL` | None | ISO 3166-1 `IND` |
| `KA` | Karnataka | `STATE` | `IN` | ISO 3166-2 `IN-KA` |
| `AP` | Andhra Pradesh | `STATE` | `IN` | ISO 3166-2 `IN-AP` |
| `KA_BLR_URBAN` | Bengaluru Urban District | `DISTRICT` | `KA` | Census Code `572` |
| `AP_VSKP` | Visakhapatnam District | `DISTRICT` | `AP` | Census Code `510` |
| `BESCOM` | Bangalore Electricity Supply Co. | `UTILITY` | `KA` | KERC Jurisdiction |
| `APEPDCL` | AP Eastern Power Distribution Co. | `UTILITY` | `AP` | APERC Jurisdiction |

---

## 3. Geographic Alias Resolution

The `GeoAliasResolver` maps colloquial names, historic variants, and abbreviations to stable canonical entities without fuzzy guessing:

| Alias / Input String | Normalized Form | Resolved Canonical Entity |
|---|---|---|
| "Bangalore" | `bangalore` | `KA_BLR_URBAN` |
| "Bengaluru" | `bengaluru` | `KA_BLR_URBAN` |
| "bengaluru urban" | `bengaluru urban` | `KA_BLR_URBAN` |
| "BLR" | `blr` | `KA_BLR_URBAN` |
| "Vizag" | `vizag` | `AP_VSKP` |
| "visakhapatnam" | `visakhapatnam` | `AP_VSKP` |
| "All India", "National" | `all india` | `IN` |
| "Karnataka" | `karnataka` | `KA` |
| "Andhra Pradesh" | `andhra pradesh` | `AP` |

Ambiguous names (e.g. "Bengaluru" without Urban/Rural specification) resolve to the documented commercial center (`KA_BLR_URBAN`), with caveats preserved in metadata. Unrecognized strings return `None` rather than guessing.

---

## 4. Geographic Coverage Matrix

| Metric ID | National (`IN`) | State (`KA`, `AP`) | District (`KA_BLR_URBAN`, `AP_VSKP`) | Utility (`BESCOM`, `APEPDCL`) | Household (`HOUSEHOLD`) |
|---|:---:|:---:|:---:|:---:|:---:|
| `ENERGY_REQUIREMENT_MU` | Available (CEA) | Available (CEA) | **Unavailable** | **Unavailable** | Not Applicable |
| `ENERGY_SUPPLIED_MU` | Available (CEA) | Available (CEA) | **Unavailable** | **Unavailable** | Not Applicable |
| `PEAK_DEMAND_MW` | Available (CEA) | Available (CEA) | **Unavailable** | **Unavailable** | Not Applicable |
| `SOLAR_CAPACITY_MW` | Available (CEA/MNRE) | Available (CEA/MNRE) | Planned (KREDL) | Planned (DISCOM) | Premise kWp |
| `SOLAR_GENERATION_MU` | Available (CEA) | Available (CEA) | **Unavailable** | Billed Export | Billed Export |
| `TOTAL_GENERATION_MU` | Available (CEA) | Available (CEA) | **Unavailable** | **Unavailable** | Not Applicable |
| `HOUSEHOLD_CONSUMPTION_KWH`| Not Applicable | Not Applicable | Not Applicable | Aggregate Billed | Available (Smart Meter) |
