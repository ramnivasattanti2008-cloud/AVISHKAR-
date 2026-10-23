"""Risk-aware, robust optimisation wrapper for day-ahead EMS planning.

A deterministic worst-case (maximin) formulation over explicit scenarios:
  1. Baseline: expected P50 solar and P50 load.
  2. Solar shortfall: adverse P10 solar and P50 load.
  3. Demand surge: expected P50 solar and adverse P90 load.
  4. Combined adverse: adverse P10 solar and adverse P90 load.

No probability distribution or calibration is assumed; scenarios are evaluated
explicitly. A risk-aversion parameter alpha in [0, 1] interpolates between the
risk-neutral baseline (alpha = 0) and the fully robust worst-case hedge (alpha = 1).

Includes a replanning trigger (ReplanningTrigger) that evaluates whether telemetry
or forecast deviations warrant refitting or re-optimising.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from avishkar_ems.planner import DayPlan, plan_day
from avishkar_ems.reserve import ReserveDecision
from avishkar_ems.site import SiteSpec

STEP_H = 0.25  # 15-minute intervals


@dataclass(frozen=True)
class RiskScenario:
    """An explicit operating scenario for robust evaluation."""

    name: str
    description: str
    pv_quantile: str  # "p10", "p50", "p90"
    load_quantile: str  # "p10", "p50", "p90"


STANDARD_SCENARIOS: tuple[RiskScenario, ...] = (
    RiskScenario("baseline", "Expected day: P50 solar and P50 load", "p50", "p50"),
    RiskScenario("solar_shortfall", "Low generation: P10 solar and P50 load", "p10", "p50"),
    RiskScenario("demand_surge", "High consumption: P50 solar and P90 load", "p50", "p90"),
    RiskScenario("combined_adverse", "Worst-case: P10 solar and P90 load", "p10", "p90"),
)


@dataclass
class ScenarioOutcome:
    """The evaluated outcome of a dispatch plan under one scenario."""

    scenario_name: str
    import_kwh: float
    export_kwh: float
    import_cost_inr: float
    export_revenue_inr: float
    wear_cost_inr: float
    shortfall_kwh: float
    shortfall_penalty_inr: float
    total_cost_inr: float


@dataclass
class RiskAssessment:
    """Summary of plan performance across all explicit scenarios."""

    baseline_cost: float
    worst_case_cost: float
    worst_scenario_name: str
    max_shortfall_kwh: float
    regret_inr: float  # worst_case_cost - baseline_cost
    scenario_outcomes: dict[str, ScenarioOutcome] = field(default_factory=dict)


@dataclass
class RobustPlanResult:
    """Result of risk-aware planning: the chosen plan plus risk metrics."""

    plan: DayPlan
    alpha: float
    assessment: RiskAssessment
    effective_pv: pd.Series
    effective_load: pd.Series


def build_scenarios(
    pv_bands: pd.DataFrame,
    load_bands: pd.DataFrame,
) -> dict[str, tuple[pd.Series, pd.Series]]:
    """Construct explicit scenarios from quantile forecasts."""
    scenarios: dict[str, tuple[pd.Series, pd.Series]] = {}
    for sc in STANDARD_SCENARIOS:
        sc_pv = pv_bands[sc.pv_quantile] if sc.pv_quantile in pv_bands.columns else pv_bands["p50"]
        sc_load = load_bands[sc.load_quantile] if sc.load_quantile in load_bands.columns else load_bands["p50"]
        scenarios[sc.name] = (sc_pv, sc_load)
    return scenarios


def evaluate_plan_scenario(
    plan: DayPlan,
    site: SiteSpec,
    pv_series: pd.Series | np.ndarray,
    load_series: pd.Series | np.ndarray,
    import_rate: np.ndarray,
    export_rate: np.ndarray,
    shortfall_penalty_rate: float = 10.0,
) -> ScenarioOutcome:
    """Evaluate how a predetermined dispatch plan performs under a specific realization."""
    pv = np.asarray(pv_series, dtype=float)
    load = np.asarray(load_series, dtype=float)
    imp_r = np.asarray(import_rate, dtype=float)
    exp_r = np.asarray(export_rate, dtype=float)

    n = len(plan.steps)
    battery_capacity_kwh = float(site.battery_kwh)
    min_soc = float(plan.floor_soc)
    max_soc = 1.0
    wear_rate = float(site.wear_inr_per_kwh)
    eff = float(site.one_way_eff)

    soc = float(plan.steps["soc"].iloc[0]) if "soc" in plan.steps else 0.5
    planned_batt_kw = plan.steps["batt_kw"].to_numpy(dtype=float)

    total_import_kwh = 0.0
    total_export_kwh = 0.0
    total_import_cost = 0.0
    total_export_rev = 0.0
    total_wear_cost = 0.0
    total_shortfall_kwh = 0.0

    for t in range(n):
        net_load_kw = load[t] - pv[t]
        req_batt_kw = planned_batt_kw[t]

        # Feasibility check on battery dispatch
        actual_batt_kw = req_batt_kw
        if req_batt_kw > 0.0:  # discharging
            avail_kwh = max(0.0, (soc - min_soc) * battery_capacity_kwh * eff)
            max_discharge_kw = min(float(site.battery_kw), avail_kwh / STEP_H)
            actual_batt_kw = min(req_batt_kw, max_discharge_kw)
            delta_soc = -(actual_batt_kw * STEP_H) / (battery_capacity_kwh * eff) if battery_capacity_kwh > 0 else 0.0
            total_wear_cost += actual_batt_kw * STEP_H * wear_rate
        elif req_batt_kw < 0.0:  # charging
            headroom_kwh = max(0.0, (max_soc - soc) * battery_capacity_kwh / eff)
            max_charge_kw = min(float(site.battery_kw), headroom_kwh / STEP_H)
            actual_batt_kw = max(req_batt_kw, -max_charge_kw)
            delta_soc = (-actual_batt_kw * STEP_H * eff) / battery_capacity_kwh if battery_capacity_kwh > 0 else 0.0
        else:
            delta_soc = 0.0

        soc = float(np.clip(soc + delta_soc, min_soc, max_soc))

        # Net balance required from the grid
        req_grid_kw = net_load_kw - actual_batt_kw
        max_grid_kw = float(site.ac_kw)

        if req_grid_kw > 0.0:  # importing from grid
            if req_grid_kw > max_grid_kw:
                shortfall_step = (req_grid_kw - max_grid_kw) * STEP_H
                total_shortfall_kwh += shortfall_step
                actual_grid_kw = max_grid_kw
            else:
                actual_grid_kw = req_grid_kw
            step_import_kwh = actual_grid_kw * STEP_H
            total_import_kwh += step_import_kwh
            total_import_cost += step_import_kwh * imp_r[t]
        else:  # exporting to grid
            actual_grid_kw = max(req_grid_kw, -max_grid_kw)
            step_export_kwh = abs(actual_grid_kw) * STEP_H
            total_export_kwh += step_export_kwh
            total_export_rev += step_export_kwh * exp_r[t]

    shortfall_pen = total_shortfall_kwh * shortfall_penalty_rate
    total_cost = total_import_cost - total_export_rev + total_wear_cost + shortfall_pen

    return ScenarioOutcome(
        scenario_name="custom",
        import_kwh=round(total_import_kwh, 4),
        export_kwh=round(total_export_kwh, 4),
        import_cost_inr=round(total_import_cost, 4),
        export_revenue_inr=round(total_export_rev, 4),
        wear_cost_inr=round(total_wear_cost, 4),
        shortfall_kwh=round(total_shortfall_kwh, 4),
        shortfall_penalty_inr=round(shortfall_pen, 4),
        total_cost_inr=round(total_cost, 4),
    )


def evaluate_scenarios(
    plan: DayPlan,
    site: SiteSpec,
    pv_bands: pd.DataFrame,
    load_bands: pd.DataFrame,
    import_rate: np.ndarray,
    export_rate: np.ndarray,
    shortfall_penalty_rate: float = 10.0,
) -> RiskAssessment:
    """Evaluate plan outcomes across all standard scenarios."""
    scenarios = build_scenarios(pv_bands, load_bands)
    outcomes: dict[str, ScenarioOutcome] = {}

    for name, (pv_s, ld_s) in scenarios.items():
        outcome = evaluate_plan_scenario(
            plan, site, pv_s, ld_s, import_rate, export_rate, shortfall_penalty_rate
        )
        outcome.scenario_name = name
        outcomes[name] = outcome

    baseline_cost = outcomes.get("baseline", next(iter(outcomes.values()))).total_cost_inr
    worst_name = max(outcomes, key=lambda k: outcomes[k].total_cost_inr)
    worst_cost = outcomes[worst_name].total_cost_inr
    max_shortfall = max(o.shortfall_kwh for o in outcomes.values())
    regret = round(worst_cost - baseline_cost, 4)

    return RiskAssessment(
        baseline_cost=baseline_cost,
        worst_case_cost=worst_cost,
        worst_scenario_name=worst_name,
        max_shortfall_kwh=max_shortfall,
        regret_inr=regret,
        scenario_outcomes=outcomes,
    )


def plan_risk_aware(
    site: SiteSpec,
    pv_bands: pd.DataFrame,
    load_bands: pd.DataFrame,
    import_rate: np.ndarray,
    export_rate: np.ndarray,
    p2p_fcst: np.ndarray,
    soc_init: float,
    reserve: ReserveDecision,
    alpha: float = 0.5,
    p2p_share: float = 0.0,
    p2p_mask: np.ndarray | None = None,
    soc_final: float | None = None,
    shortfall_penalty_rate: float = 10.0,
) -> RobustPlanResult:
    """Formulate and solve a risk-aware robust day plan.

    Parameters
    ----------
    alpha:
        Risk-aversion weight in [0, 1].
        0.0 = risk-neutral (plans purely on P50 forecasts).
        1.0 = worst-case maximin hedge (plans on P10 solar and P90 load).
        Values in (0, 1) blend the baseline and adverse bounds.
    """
    if not (0.0 <= alpha <= 1.0):
        raise ValueError(f"alpha must be in [0.0, 1.0], got {alpha}")

    # Interpolate effective planning forecasts
    pv_p50 = pv_bands["p50"]
    pv_p10 = pv_bands["p10"] if "p10" in pv_bands.columns else pv_p50
    effective_pv = (1.0 - alpha) * pv_p50 + alpha * pv_p10

    load_p50 = load_bands["p50"]
    load_p90 = load_bands["p90"] if "p90" in load_bands.columns else load_p50
    effective_load = (1.0 - alpha) * load_p50 + alpha * load_p90

    # Build effective bands for the deterministic LP solver
    hedged_pv_bands = pv_bands.copy()
    hedged_pv_bands["p50"] = effective_pv

    hedged_load_bands = load_bands.copy()
    hedged_load_bands["p50"] = effective_load

    plan = plan_day(
        site=site,
        pv_bands=hedged_pv_bands,
        load_bands=hedged_load_bands,
        import_rate=import_rate,
        export_rate=export_rate,
        p2p_fcst=p2p_fcst,
        soc_init=soc_init,
        reserve=reserve,
        p2p_share=p2p_share,
        p2p_mask=p2p_mask,
        soc_final=soc_final,
    )

    assessment = evaluate_scenarios(
        plan=plan,
        site=site,
        pv_bands=pv_bands,
        load_bands=load_bands,
        import_rate=import_rate,
        export_rate=export_rate,
        shortfall_penalty_rate=shortfall_penalty_rate,
    )

    return RobustPlanResult(
        plan=plan,
        alpha=alpha,
        assessment=assessment,
        effective_pv=effective_pv,
        effective_load=effective_load,
    )


class ReplanningTrigger:
    """Evaluates whether new observations or forecast updates warrant a plan refit.

    Triggers replanning when:
      1. No previous plan is registered.
      2. The input data hash has changed.
      3. The mean absolute deviation between newly observed telemetry and the
         forecasted horizon exceeds `deviation_threshold`.
    """

    def __init__(self, deviation_threshold: float = 0.15) -> None:
        if deviation_threshold <= 0.0:
            raise ValueError("deviation_threshold must be positive")
        self.deviation_threshold = deviation_threshold
        self._last_fingerprint: str | None = None
        self._last_pv_mean: float | None = None
        self._last_load_mean: float | None = None

    @staticmethod
    def fingerprint(pv_data: Any, load_data: Any, soc: float) -> str:
        """Create a cryptographic hash of the input parameters."""
        try:
            data = {"pv": str(pv_data), "load": str(load_data), "soc": round(soc, 4)}
            payload = json.dumps(data, sort_keys=True).encode()
        except (TypeError, ValueError):
            payload = f"{pv_data!r}:{load_data!r}:{soc}".encode()
        return hashlib.sha256(payload).hexdigest()

    def should_replan(
        self,
        current_pv: pd.Series | np.ndarray,
        current_load: pd.Series | np.ndarray,
        current_soc: float,
    ) -> bool:
        """Return True if replanning is recommended based on state drift or hash change."""
        current_fp = self.fingerprint(current_pv, current_load, current_soc)
        if self._last_fingerprint is None:
            return True

        if current_fp != self._last_fingerprint:
            # Check if numerical deviation exceeds the threshold
            pv_arr = np.asarray(current_pv, dtype=float)
            ld_arr = np.asarray(current_load, dtype=float)
            curr_pv_m = float(np.mean(pv_arr))
            curr_ld_m = float(np.mean(ld_arr))

            if self._last_pv_mean is not None and self._last_load_mean is not None:
                pv_diff = abs(curr_pv_m - self._last_pv_mean) / max(self._last_pv_mean, 0.1)
                ld_diff = abs(curr_ld_m - self._last_load_mean) / max(self._last_load_mean, 0.1)
                if pv_diff > self.deviation_threshold or ld_diff > self.deviation_threshold:
                    return True
            else:
                return True

        return False

    def record_plan(
        self,
        current_pv: pd.Series | np.ndarray,
        current_load: pd.Series | np.ndarray,
        current_soc: float,
    ) -> None:
        """Record the state of the executed plan."""
        self._last_fingerprint = self.fingerprint(current_pv, current_load, current_soc)
        pv_arr = np.asarray(current_pv, dtype=float)
        ld_arr = np.asarray(current_load, dtype=float)
        self._last_pv_mean = float(np.mean(pv_arr))
        self._last_load_mean = float(np.mean(ld_arr))

    def reset(self) -> None:
        """Clear the trigger state."""
        self._last_fingerprint = None
        self._last_pv_mean = None
        self._last_load_mean = None
