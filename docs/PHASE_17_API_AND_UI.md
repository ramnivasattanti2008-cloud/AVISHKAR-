# Phase 17: API Specification & UI Integration

## 1. Digital Twin Service API (`DigitalTwinService`)

```python
class DigitalTwinService:
    def create_scenario(
        self,
        user_id: str,
        twin_id: str,
        scenario_name: str,
        description: str,
        model_type: ScenarioModelType,
        parameters: dict[str, Any],
        parameter_units: dict[str, str] | None = None,
        assumptions: list[str] | None = None,
    ) -> EnergyScenario: ...

    def execute_scenario(
        self,
        scenario: EnergyScenario,
        user_id: str,
    ) -> ScenarioSimulationResult: ...

    def compare_twin_scenarios(
        self,
        twin_id: str,
        scenario_ids: list[str],
        user_id: str,
    ) -> ScenarioComparisonReport: ...

    def run_sensitivity_sweep(
        self,
        twin_id: str,
        model_type: ScenarioModelType,
        parameter_name: str,
        start_value: float,
        end_value: float,
        step_size: float,
        fixed_parameters: dict[str, Any],
        user_id: str,
    ) -> SensitivitySweepResult: ...
```

---

## 2. AI Copilot Tool Integration (`CopilotToolRegistry`)

UrjaSetu AI Copilot exposes What-If scenario simulation via allowlisted domain tools:

### Tool: `run_what_if_simulation`
- **Required Permission**: `OWNER_ONLY`
- **Input Schema**:
  ```json
  {
    "property_id": "home_blr_bescom",
    "model_type": "SOLAR_PV_ADDITION",
    "parameters": {
      "solar_capacity_kwp": 3.0
    }
  }
  ```
- **Output Evidence**:
  - `EvidenceItem` with ID `EVID-007`
  - `source_category`: `SIMULATION_ENGINE`
  - `data_classification`: `SIMULATED_SCENARIO`
  - Strict audit by `NumericalGroundingGuard`

### Tool: `compare_energy_scenarios`
- **Required Permission**: `OWNER_ONLY`
- **Input Schema**:
  ```json
  {
    "twin_id": "twin_blr_bescom_01",
    "scenario_ids": ["scen_blr_solar_3kwp", "scen_blr_efficiency_15pct"]
  }
  ```

---

## 3. Streamlit User Interface Integration

Integrated into `app/urjasetu_view.py` as:
**Tab 15: `🔮 15. Energy Digital Twin & What-If Simulator`**

### UI Sections:
1. **Scope & Baseline Telemetry**: Active digital twin selector displaying baseline energy, monthly bill, sanctioned load, and calibration badges.
2. **Interactive What-If Builder**: Intervention category radio, sliders with `[USER_SUPPLIED]`, `[ASSUMED]`, and `[STATUTORY]` tags, and "Execute What-If Simulation" action.
3. **Simulation Outcomes Dashboard**: 4 KPI metric cards, side-by-side Baseline vs. Simulated comparison table, and interactive Plotly component breakdown bar chart.
4. **Deterministic Sensitivity Explorer**: Interactive parameter sweep with step controls and Plotly curve rendering marginal savings.
5. **Multi-Scenario Comparative Study**: Multi-select scenario picker with ranking badges (Top Cost Savings, Top Energy Reduction, Top Avoided CO2).
6. **Technical Audit & Export**: Full calculation lineage, stated assumptions, model limitations, and JSON artifact download button.
