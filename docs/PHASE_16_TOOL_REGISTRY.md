# Phase 16 — Tool Registry & Schema Specifications

## 1. Overview & Tool Invariants

The `CopilotToolRegistry` provides a strictly allowlisted, typed runtime interface between the AI Copilot and internal UrjaSetu domain services.

### Core Security Invariants
1. **No Arbitrary Code Execution**: Tools like `eval`, `exec`, `shell_exec`, or `execute_sql` are strictly prohibited.
2. **Strict Schema Validation**: Tool arguments are validated before execution. Missing required arguments or out-of-range numeric values reject execution immediately.
3. **Server-Side Authorization**: Private-data tools (`OWNER_ONLY`) verify that the target `property_id` is present in the server's `authorized_property_ids` set. Model-generated credentials or prompt instructions cannot override this check.
4. **Structured Output Contracts**: Every tool returns structured dictionaries accompanied by typed `EvidenceBundle` instances containing exact values, units, and source lineages.

---

## 2. Tool Registry Specification

### 2.1 `get_household_consumption_summary`
- **Description**: Retrieves verified interval consumption, average daily usage, and peak instantaneous demand for an authorized household.
- **Permission**: `OWNER_ONLY`
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "property_id": { "type": "string", "description": "Unique household property identifier" }
    },
    "required": ["property_id"]
  }
  ```
- **Output Schema**:
  ```json
  {
    "property_id": "prop-ka-blr-01",
    "display_name": "Bengaluru Residence (Indiranagar)",
    "interval_count": 12,
    "total_consumption_kwh": 312.4,
    "daily_average_kwh": 2499.2,
    "peak_demand_kw": 4.4,
    "sanctioned_load_kw": 5.0
  }
  ```

---

### 2.2 `get_utility_bill_breakdown`
- **Description**: Retrieves itemized utility billing statements with demand charges, energy charges, taxes, and net payable amount.
- **Permission**: `OWNER_ONLY`
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "property_id": { "type": "string", "description": "Unique household property identifier" },
      "bill_month": { "type": "string", "description": "Optional billing month e.g. '2026-03'" }
    },
    "required": ["property_id"]
  }
  ```
- **Output Schema**:
  ```json
  {
    "property_id": "prop-ka-blr-01",
    "bill_month": "2026-03",
    "units_consumed_kwh": 360.0,
    "total_amount_inr": 2840.0,
    "net_payable": 2840.0,
    "fixed_charge_inr": 250.0,
    "fixed_charges": 250.0,
    "energy_charge_inr": 2590.0,
    "energy_charges": 2590.0,
    "net_meter_export_kwh": 140.0,
    "solar_credit_inr": 350.0,
    "tariff_category": "LT-2 Domestic"
  }
  ```

---

### 2.3 `calculate_bill_under_tariff`
- **Description**: Calculates estimated electricity bill under official statutory tariff schedules (BESCOM LT-2).
- **Permission**: `PUBLIC_OPEN`
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "units_kwh": { "type": "number", "description": "Electricity consumption units in kWh (non-negative)" },
      "tariff_name": { "type": "string", "description": "Tariff schedule code, e.g. 'BESCOM_LT2'" },
      "sanctioned_load_kw": { "type": "number", "description": "Sanctioned demand load in kW" }
    },
    "required": ["units_kwh"]
  }
  ```
- **Mathematical Specification (BESCOM LT-2 Schedule)**:
  - Fixed charge: ₹110.00 / month
  - Tier 1 (0 to 50 kWh): ₹4.15 / kWh
  - Tier 2 (51 to 100 kWh): ₹5.60 / kWh
  - Tier 3 (> 100 kWh): ₹7.15 / kWh
  - State Electricity Duty: 9.0% of energy charges
  - Example for 250 kWh:
    - Tier 1: 50 × 4.15 = ₹207.50
    - Tier 2: 50 × 5.60 = ₹280.00
    - Tier 3: 150 × 7.15 = ₹1072.50
    - Energy Charges = ₹1560.00
    - Fixed Charges = ₹110.00
    - Electricity Duty = ₹140.40
    - **Total Estimated Bill = ₹1810.40**

---

### 2.4 `inspect_consumption_anomalies`
- **Description**: Inspects statistical consumption anomalies and deviations from trailing rolling baselines using Median Absolute Deviation (MAD).
- **Permission**: `OWNER_ONLY`
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "property_id": { "type": "string", "description": "Unique household property identifier" }
    },
    "required": ["property_id"]
  }
  ```

---

### 2.5 `get_active_recommendations`
- **Description**: Retrieves eligible energy efficiency, load realignment, and rooftop solar optimization recommendations.
- **Permission**: `OWNER_ONLY`
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "property_id": { "type": "string", "description": "Unique household property identifier" }
    },
    "required": ["property_id"]
  }
  ```

---

### 2.6 `get_public_energy_indicators`
- **Description**: Retrieves official CEA national and state statutory energy supply and demand indicators.
- **Permission**: `PUBLIC_OPEN`
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "geo_scope": { "type": "string", "description": "Geographic scope e.g. 'NATIONAL', 'ALL'" }
    }
  }
  ```
