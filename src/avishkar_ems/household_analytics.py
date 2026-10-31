"""Household Energy Analytics & Predictive Intelligence for UrjaSetu EMS (Phase 9).

Connects household time series and billing records with:
1. Multi-home comparison (Bengaluru vs. Andhra Pradesh).
2. Historical consumption and cost analytics (effective cost/kWh, breakdown).
3. Household forecasting via Phase 8 Forecasting & Eligibility Engines.
4. Solar generation tracking (decoupled from nameplate capacity).
5. Data honesty guarantees: never downscales state totals to households.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from avishkar_ems.forecast_eligibility import ForecastEligibilityEngine, TimeSeriesPoint
from avishkar_ems.forecasting_engine import ModelTournamentEngine, ModelTournamentResult
from avishkar_ems.household_module import HouseholdProfile
from avishkar_ems.household_tariffs import HouseholdTariffEngine, TariffType


@dataclass(frozen=True)
class HomeComparisonSummary:
    """Side-by-side comparison between distinct household properties."""

    profile_id_a: str
    display_name_a: str
    state_a: str
    utility_a: str
    avg_monthly_kwh_a: float
    avg_effective_cost_per_kwh_a: float
    sanctioned_load_kw_a: float
    kwh_per_sanctioned_kw_a: float
    solar_capacity_kwp_a: float
    total_bills_count_a: int

    profile_id_b: str
    display_name_b: str
    state_b: str
    utility_b: str
    avg_monthly_kwh_b: float
    avg_effective_cost_per_kwh_b: float
    sanctioned_load_kw_b: float
    kwh_per_sanctioned_kw_b: float
    solar_capacity_kwp_b: float
    total_bills_count_b: int

    comparison_notes: list[str]


@dataclass(frozen=True)
class HouseholdForecastResult:
    """Outcome of household forecasting run reusing Phase 8 tournament."""

    property_id: str
    display_name: str
    metric: str
    unit: str
    is_eligible: bool
    eligibility_reason: str
    forecast_points: list[dict[str, Any]]
    champion_model_name: str | None
    tournament_result: ModelTournamentResult | None
    caveats: list[str] = field(default_factory=list)


class HouseholdAnalyticsEngine:
    """Delivers multi-home comparative analytics and predictive intelligence."""

    @classmethod
    def compare_homes(cls, home_a: HouseholdProfile, home_b: HouseholdProfile) -> HomeComparisonSummary:
        """Computes side-by-side comparative metrics normalized by sanctioned load."""
        # Home A stats
        bills_a = home_a.bills
        kwh_a = [b.units_consumed_kwh for b in bills_a]
        avg_kwh_a = sum(kwh_a) / len(kwh_a) if kwh_a else 0.0
        amounts_a = [b.total_amount_inr for b in bills_a]
        avg_cost_kwh_a = (sum(amounts_a) / sum(kwh_a)) if sum(kwh_a) > 0 else 0.0
        kwh_per_kw_a = round(avg_kwh_a / home_a.sanctioned_load_kw, 2) if home_a.sanctioned_load_kw > 0 else 0.0

        # Home B stats
        bills_b = home_b.bills
        kwh_b = [b.units_consumed_kwh for b in bills_b]
        avg_kwh_b = sum(kwh_b) / len(kwh_b) if kwh_b else 0.0
        amounts_b = [b.total_amount_inr for b in bills_b]
        avg_cost_kwh_b = (sum(amounts_b) / sum(kwh_b)) if sum(kwh_b) > 0 else 0.0
        kwh_per_kw_b = round(avg_kwh_b / home_b.sanctioned_load_kw, 2) if home_b.sanctioned_load_kw > 0 else 0.0

        notes = [
            f"Independent monitoring: {home_a.display_name} ({home_a.utility.value}, {home_a.state}) vs {home_b.display_name} ({home_b.utility.value}, {home_b.state}).",
            "Normalized consumption (kWh per kW sanctioned load) accounts for differences in connection capacity.",
            "Tariff structures reflect respective state regulatory commission orders (KERC for KA, APERC for AP).",
            "Data honesty guarantee: Household metrics are strictly derived from property-specific bills and meter telemetry.",
        ]

        return HomeComparisonSummary(
            profile_id_a=home_a.profile_id,
            display_name_a=home_a.display_name,
            state_a=home_a.state,
            utility_a=home_a.utility.value,
            avg_monthly_kwh_a=round(avg_kwh_a, 2),
            avg_effective_cost_per_kwh_a=round(avg_cost_kwh_a, 2),
            sanctioned_load_kw_a=home_a.sanctioned_load_kw,
            kwh_per_sanctioned_kw_a=kwh_per_kw_a,
            solar_capacity_kwp_a=home_a.solar_capacity_kwp,
            total_bills_count_a=len(bills_a),
            profile_id_b=home_b.profile_id,
            display_name_b=home_b.display_name,
            state_b=home_b.state,
            utility_b=home_b.utility.value,
            avg_monthly_kwh_b=round(avg_kwh_b, 2),
            avg_effective_cost_per_kwh_b=round(avg_cost_kwh_b, 2),
            sanctioned_load_kw_b=home_b.sanctioned_load_kw,
            kwh_per_sanctioned_kw_b=kwh_per_kw_b,
            solar_capacity_kwp_b=home_b.solar_capacity_kwp,
            total_bills_count_b=len(bills_b),
            comparison_notes=notes,
        )

    @classmethod
    def analyze_cost_trends(cls, profile: HouseholdProfile) -> list[dict[str, Any]]:
        """Analyzes historical bills, comparing actual billed amounts with reconstructed estimates."""
        results: list[dict[str, Any]] = []
        schedule_id = "KA_BESCOM_LT2A_2024" if profile.state == "KA" else "AP_APEPDCL_LT1_2024"

        for b in sorted(profile.bills, key=lambda x: x.bill_month):
            recon = HouseholdTariffEngine.calculate_bill(
                consumption_kwh=b.units_consumed_kwh,
                sanctioned_load_kw=profile.sanctioned_load_kw,
                schedule=schedule_id,
                solar_export_kwh=b.net_meter_export_kwh,
                calculation_type=TariffType.RECONSTRUCTED_ESTIMATE,
            )

            effective_rate = round(b.total_amount_inr / b.units_consumed_kwh, 2) if b.units_consumed_kwh > 0 else 0.0

            results.append({
                "bill_month": b.bill_month,
                "bill_date": b.bill_date,
                "units_kwh": b.units_consumed_kwh,
                "actual_amount_inr": b.total_amount_inr,
                "reconstructed_amount_inr": recon.net_bill_inr,
                "variance_inr": round(b.total_amount_inr - recon.net_bill_inr, 2),
                "fixed_charge_inr": b.fixed_charge_inr,
                "energy_charge_inr": b.energy_charge_inr,
                "solar_credit_inr": b.solar_credit_inr,
                "net_meter_export_kwh": b.net_meter_export_kwh,
                "effective_rate_per_kwh": effective_rate,
            })
        return results

    @classmethod
    def forecast_household_demand(
        cls,
        profile: HouseholdProfile,
        horizon_months: int = 3,
        synthetic_series: list[TimeSeriesPoint] | None = None,
    ) -> HouseholdForecastResult:
        """Forecasts household monthly consumption reusing Phase 8 tournament engine.

        If history has fewer than 6 observations, marks ineligible with clear diagnostic explanation.
        """
        # Convert bills to TimeSeriesPoints
        if synthetic_series is not None:
            series = synthetic_series
        else:
            sorted_bills = sorted(profile.bills, key=lambda x: x.bill_month)
            series = [
                TimeSeriesPoint(
                    period=b.bill_month,
                    value=b.units_consumed_kwh,
                    unit="kWh",
                )
                for b in sorted_bills
            ]

        # 1. Check eligibility via Phase 8 engine
        geo_entity = profile.state
        report = ForecastEligibilityEngine().check_eligibility(
            series=series,
            metric_id="electricity_demand",
            geo_code=geo_entity,
            target_horizon=horizon_months,
        )

        if not report.is_eligible:
            return HouseholdForecastResult(
                property_id=profile.profile_id,
                display_name=profile.display_name,
                metric="electricity_demand",
                unit="kWh",
                is_eligible=False,
                eligibility_reason="; ".join(report.rejection_reasons),
                forecast_points=[],
                champion_model_name=None,
                tournament_result=None,
                caveats=report.warnings + [
                    f"Household has {len(series)} recorded monthly bill(s). A minimum of 6 monthly observations is required for reliable baselines."
                ],
            )

        # 2. Run Phase 8 Model Tournament on eligible series
        holdout_count = max(2, len(series) // 4)
        periods = [s.period for s in series]
        values = [s.value for s in series]
        tournament = ModelTournamentEngine().run_tournament(
            periods=periods,
            values=values,
            target_metric="electricity_demand",
            geo_code=geo_entity,
            horizon_steps=horizon_months,
            holdout_steps=holdout_count,
        )

        # Build output forecast points
        forecast_points: list[dict[str, Any]] = []
        for p, p50, p10, p90 in zip(
            tournament.forecast_periods,
            tournament.forecast_p50,
            tournament.forecast_p10,
            tournament.forecast_p90,
            strict=False,
        ):
            forecast_points.append({
                "period": p,
                "forecast_p50_kwh": p50,
                "lower_bound_p10_kwh": p10,
                "upper_bound_p90_kwh": p90,
                "model_name": tournament.champion_model_name,
            })

        return HouseholdForecastResult(
            property_id=profile.profile_id,
            display_name=profile.display_name,
            metric="electricity_demand",
            unit="kWh",
            is_eligible=True,
            eligibility_reason="Series meets all 6 Phase 8 eligibility gates for household forecasting.",
            forecast_points=forecast_points,
            champion_model_name=tournament.champion_model_name,
            tournament_result=tournament,
            caveats=[
                "Forecast is generated from property-specific historical billing observations.",
                "Weather sensitivity is limited without localized cooling degree day telemetry.",
                "80% empirical uncertainty interval expands with horizon step.",
            ],
        )

    @classmethod
    def analyze_solar_performance(cls, profile: HouseholdProfile) -> dict[str, Any]:
        """Analyzes real measured solar generation and net-metering performance.

        Strictly enforces: installed capacity (kWp) is decoupled from measured generation.
        """
        bills = profile.bills
        total_export_kwh = sum(b.net_meter_export_kwh for b in bills)
        total_solar_credit_inr = sum(b.solar_credit_inr for b in bills)

        # Estimate average solar generation if meter intervals or solar observations exist
        solar_obs = [obs for obs in profile.observations if obs.observation_type.value == "SOLAR_GENERATION"]
        measured_solar_kwh = sum(obs.value for obs in solar_obs)

        has_solar = profile.solar_capacity_kwp > 0.0

        return {
            "has_solar_installation": has_solar,
            "installed_capacity_kwp": profile.solar_capacity_kwp,
            "measured_generation_kwh": round(measured_solar_kwh, 2) if solar_obs else None,
            "total_net_export_kwh": round(total_export_kwh, 2),
            "total_solar_credits_inr": round(total_solar_credit_inr, 2),
            "data_source": "OFFICIAL_NET_METER_STATEMENTS",
            "physics_disclaimer": (
                "Installed capacity (kWp) represents theoretical nameplate DC rating under standard test conditions. "
                "Actual generation depends on seasonal irradiance, azimuth, panel tilt, ambient temperature, and soiling. "
                "UrjaSetu never synthesizes solar generation from capacity alone."
            ),
        }
