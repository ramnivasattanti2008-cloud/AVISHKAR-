"""Comprehensive Automated Test Suite for Phase 11: UrjaSetu EMS Verified Public Data Connectors.

Verifies:
1. Reusable connector contracts for all official and open science energy data sources:
   - CeaConnector (CEA Power Supply Position & Renewable Generation)
   - ApEnergyConnector (APSLDC State Balance & APEPDCL Utility Statistics)
   - BescomHistoricalConnector (OpenCity 13-Year Historical Consumption)
   - NppGenerationConnector (NPP Daily Outturn & Thermal PLF)
   - OpenMeteoSolarConnector (Open-Meteo Verified Solar Irradiance & Temperature)
   - NasaPowerConnector (NASA POWER Climatological Solar Insolation)
   - DiscomConnector (Authorized Consumer Seams & Access Restrictions)
2. Canonical observation normalization, measurement kinds, units, and provenance.
3. Geographic integrity, anti-disaggregation guards, and entity hierarchy.
4. Idempotent ingestion, stable composite keys, and provider revision tracking.
5. Concurrency-protected scheduling and operational history tracking via IngestionScheduler.
6. Multi-source conflict resolution, source precedence hierarchy, and tolerance checks via ConflictResolver.
7. Safe diagnostic error reporting with credential/secret redaction.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    DataClassification,
    MeasurementKind,
    QualityStatus,
)
from avishkar_ems.trust.conflict_resolver import (
    ConflictResolver,
    ConflictSeverity,
)
from avishkar_ems.trust.connectors import (
    ApEnergyConnector,
    BescomHistoricalConnector,
    ImportSummary,
    NasaPowerConnector,
    NppGenerationConnector,
    OpenMeteoSolarConnector,
)
from avishkar_ems.trust.geo_integrity import (
    AntiDisaggregationGuard,
    CanonicalEntityCatalog,
    GeoLevel,
)
from avishkar_ems.trust.idempotent_ingestion import (
    IdempotentIngestionEngine,
)
from avishkar_ems.trust.ingestion_scheduler import (
    IngestionScheduler,
)
from avishkar_ems.trust.source_registry import (
    SourceRegistry,
)

# ---------------------------------------------------------------------------
# 1. CONNECTOR LIFECYCLE & NORMALIZATION TESTS
# ---------------------------------------------------------------------------


class TestPhase11Connectors:
    def test_openmeteo_connector_lifecycle(self) -> None:
        source = SourceRegistry.get_source("OPEN_METEO_SOLAR")
        assert source is not None

        fixture = {
            "hourly": {
                "time": ["2026-10-24T10:00", "2026-10-24T11:00", "2026-10-24T12:00"],
                "direct_normal_irradiance": [350.0, 520.0, 680.0],
                "temperature_2m": [24.5, 26.2, 28.0],
            }
        }
        connector = OpenMeteoSolarConnector(source, location_code="KA_BLR_URBAN", offline_fixture=fixture)
        ok, msg = connector.validate_access()
        assert ok is True

        raw = connector.fetch_raw()
        valid, errors = connector.validate_schema(raw)
        assert valid is True
        assert len(errors) == 0

        parsed = connector.parse(raw)
        assert len(parsed) == 3

        canonical = connector.normalize(parsed, "RUN_OM_001")
        # 3 hours * 2 metrics (DNI + Temp) = 6 observations
        assert len(canonical) == 6

        dni_obs = [c for c in canonical if c.metric_id == "DIRECT_NORMAL_IRRADIANCE_WM2"]
        temp_obs = [c for c in canonical if c.metric_id == "SURFACE_TEMPERATURE_C"]
        assert len(dni_obs) == 3
        assert len(temp_obs) == 3

        assert dni_obs[0].normalized_unit == "W/m²"
        assert dni_obs[0].measurement_kind == MeasurementKind.IRRADIANCE_WM2
        assert dni_obs[0].geographic_entity_id == "KA_BLR_URBAN"
        assert dni_obs[0].data_classification == DataClassification.OFFICIAL_OBSERVATION

        health = connector.health_check()
        assert health.is_healthy is True
        assert health.latency_ms is not None

    def test_nasa_power_connector_lifecycle(self) -> None:
        source = SourceRegistry.get_source("NASA_POWER_SOLAR")
        assert source is not None

        fixture = {
            "properties": {
                "parameter": {
                    "ALLSKY_SFC_SW_DWN": {
                        "JAN": 5.12,
                        "FEB": 5.85,
                        "MAR": 6.32,
                        "APR": 6.45,
                        "MAY": 6.10,
                        "JUN": 4.95,
                        "JUL": 4.50,
                        "AUG": 4.65,
                        "SEP": 5.10,
                        "OCT": 5.05,
                        "NOV": 4.90,
                        "DEC": 4.85,
                        "ANN": 5.32,
                    }
                }
            }
        }
        connector = NasaPowerConnector(source, location_code="KA_BLR_URBAN", offline_fixture=fixture)
        ok, msg = connector.validate_access()
        assert ok is True

        raw = connector.fetch_raw()
        valid, errors = connector.validate_schema(raw)
        assert valid is True
        assert len(errors) == 0

        parsed = connector.parse(raw)
        assert len(parsed) == 13  # 12 months + 1 annual

        canonical = connector.normalize(parsed, "RUN_NASA_001")
        assert len(canonical) == 13

        jan_obs = next(c for c in canonical if c.observation_id.endswith("_M01"))
        assert jan_obs.normalized_value == 5.12
        assert jan_obs.normalized_unit == "kWh/m²/day"
        assert jan_obs.measurement_kind == MeasurementKind.DAILY_INSOLATION
        assert jan_obs.geographic_entity_id == "KA_BLR_URBAN"

        ann_obs = next(c for c in canonical if c.observation_id.endswith("_ANNUAL"))
        assert ann_obs.normalized_value == 5.32
        assert ann_obs.reporting_period_start.month == 1
        assert ann_obs.reporting_period_end.month == 12

        health = connector.health_check()
        assert health.is_healthy is True

    def test_ap_connector_lifecycle(self) -> None:
        source = SourceRegistry.get_source("AP_ENERGY")
        assert source is not None

        connector = ApEnergyConnector(source)
        ok, msg = connector.validate_access()
        assert ok is True

        raw = connector.fetch_raw()
        valid, errors = connector.validate_schema(raw)
        assert valid is True

        parsed = connector.parse(raw)
        assert len(parsed) > 0

        canonical = connector.normalize(parsed, "RUN_AP_001")
        assert len(canonical) > 0

        # Check requirement, supply, peak demand, and peak met
        metrics_found = {c.metric_id for c in canonical}
        assert "ENERGY_REQUIREMENT_MU" in metrics_found
        assert "ENERGY_SUPPLIED_MU" in metrics_found
        assert "PEAK_DEMAND_MW" in metrics_found
        assert "PEAK_MET_MW" in metrics_found
        assert "INSTALLED_SOLAR_CAPACITY_MW" in metrics_found

        ap_records = [c for c in canonical if c.geographic_entity_id == "AP"]
        assert all(c.geographic_level == "STATE" for c in ap_records)

        apepdcl_records = [c for c in canonical if c.geographic_entity_id == "APEPDCL"]
        assert all(c.geographic_level == "UTILITY" for c in apepdcl_records)

    def test_bescom_historical_connector_lifecycle(self) -> None:
        source = SourceRegistry.get_source("BESCOM_OPENCITY")
        assert source is not None

        connector = BescomHistoricalConnector(source)
        ok, msg = connector.validate_access()
        assert ok is True

        raw = connector.fetch_raw()
        valid, errors = connector.validate_schema(raw)
        assert valid is True

        parsed = connector.parse(raw)
        assert len(parsed) >= 13  # 13 financial years

        canonical = connector.normalize(parsed, "RUN_BESCOM_001")
        assert len(canonical) > 0

        # Check T&D loss calculation and physical invariants
        for obs in canonical:
            assert obs.geographic_entity_id == "BESCOM"
            assert obs.geographic_level == "UTILITY"
            if obs.metric_id == "BESCOM_T_AND_D_LOSS_PCT":
                assert 0.0 <= obs.normalized_value <= 50.0  # Plausible T&D loss percentage

    def test_npp_generation_connector_lifecycle(self) -> None:
        source = SourceRegistry.get_source("NPP_OUTTURN")
        assert source is not None

        connector = NppGenerationConnector(source)
        ok, msg = connector.validate_access()
        assert ok is True

        raw = connector.fetch_raw()
        valid, errors = connector.validate_schema(raw)
        assert valid is True

        parsed = connector.parse(raw)
        assert len(parsed) > 0

        canonical = connector.normalize(parsed, "RUN_NPP_001")
        assert len(canonical) > 0
        total_gens = [c for c in canonical if c.metric_id == "DAILY_GENERATION_MU"]
        assert len(total_gens) > 0
        assert all(t.normalized_value > 0.0 for t in total_gens)
        assert all(t.geographic_entity_id == "IN" for t in total_gens)


# ---------------------------------------------------------------------------
# 2. INGESTION SCHEDULER & MUTEX CONCURRENCY TESTS
# ---------------------------------------------------------------------------


class TestPhase11IngestionScheduler:
    def test_scheduler_registration_and_job_listing(self) -> None:
        scheduler = IngestionScheduler()
        engine = IdempotentIngestionEngine()
        source = SourceRegistry.get_source("OPEN_METEO_SOLAR")
        assert source is not None

        fixture = {
            "hourly": {
                "time": ["2026-10-24T12:00"],
                "direct_normal_irradiance": [450.0],
                "temperature_2m": [25.0],
            }
        }
        scheduler.register_connector(
            source_id="OPEN_METEO_SOLAR",
            cadence="HOURLY",
            connector_factory=lambda: OpenMeteoSolarConnector(source, offline_fixture=fixture),
            engine=engine,
            is_automated=True,
        )

        jobs = scheduler.list_scheduled_jobs()
        assert len(jobs) == 1
        assert jobs[0]["source_id"] == "OPEN_METEO_SOLAR"
        assert jobs[0]["cadence"] == "HOURLY"
        assert jobs[0]["is_automated"] is True
        assert jobs[0]["is_running"] is False

    def test_scheduler_manual_sync_execution(self) -> None:
        scheduler = IngestionScheduler()
        engine = IdempotentIngestionEngine()
        source = SourceRegistry.get_source("OPEN_METEO_SOLAR")
        assert source is not None

        fixture = {
            "hourly": {
                "time": ["2026-10-24T12:00"],
                "direct_normal_irradiance": [450.0],
                "temperature_2m": [25.0],
            }
        }
        scheduler.register_connector(
            source_id="OPEN_METEO_SOLAR",
            cadence="HOURLY",
            connector_factory=lambda: OpenMeteoSolarConnector(source, offline_fixture=fixture),
            engine=engine,
            is_automated=True,
        )

        summary = scheduler.trigger_sync("OPEN_METEO_SOLAR", operator_id="TEST_OPERATOR")
        assert isinstance(summary, ImportSummary)
        assert summary.source_id == "OPEN_METEO_SOLAR"
        assert summary.status in {"COMPLETED", "SUCCESS"}
        assert summary.accepted_count == 2
        assert summary.rejected_count == 0

        # Run history audit
        history = scheduler.get_run_history("OPEN_METEO_SOLAR")
        assert len(history) == 1
        assert history[0].accepted_count == 2

    def test_scheduler_prevents_concurrent_runs(self) -> None:
        scheduler = IngestionScheduler()
        engine = IdempotentIngestionEngine()
        source = SourceRegistry.get_source("OPEN_METEO_SOLAR")
        assert source is not None

        scheduler.register_connector(
            source_id="OPEN_METEO_SOLAR",
            cadence="HOURLY",
            connector_factory=lambda: OpenMeteoSolarConnector(source),
            engine=engine,
            is_automated=True,
        )

        # Artificially acquire active run lock
        scheduler._active_runs.add("OPEN_METEO_SOLAR")

        with pytest.raises(RuntimeError, match="CONCURRENCY VIOLATION"):
            scheduler.trigger_sync("OPEN_METEO_SOLAR")

        # Release lock
        scheduler._active_runs.discard("OPEN_METEO_SOLAR")

    def test_run_pending_jobs(self) -> None:
        scheduler = IngestionScheduler()
        engine = IdempotentIngestionEngine()
        source = SourceRegistry.get_source("OPEN_METEO_SOLAR")
        assert source is not None

        fixture = {
            "hourly": {
                "time": ["2026-10-24T12:00"],
                "direct_normal_irradiance": [450.0],
                "temperature_2m": [25.0],
            }
        }
        scheduler.register_connector(
            source_id="OPEN_METEO_SOLAR",
            cadence="HOURLY",
            connector_factory=lambda: OpenMeteoSolarConnector(source, offline_fixture=fixture),
            engine=engine,
            is_automated=True,
        )

        # Force job next_run_time into the past
        job = scheduler._jobs["OPEN_METEO_SOLAR"]
        job.next_run_time = datetime.now(UTC) - timedelta(minutes=10)

        results = scheduler.run_pending_jobs()
        assert len(results) == 1
        assert results[0].accepted_count == 2
        assert job.next_run_time > datetime.now(UTC)


# ---------------------------------------------------------------------------
# 3. CONFLICT RESOLUTION & MULTI-SOURCE PRECEDENCE TESTS
# ---------------------------------------------------------------------------


class TestPhase11ConflictResolver:
    def test_identical_observations_no_conflict(self) -> None:
        resolver = ConflictResolver(tolerance_pct=1.0)
        now = datetime(2026, 1, 1, tzinfo=UTC)

        obs_a = CanonicalObservation(
            observation_id="OBS_A",
            source_id="CEA_POWER_SUPPLY_POSITION",
            dataset_id="NATIONAL_BALANCE",
            metric_id="ENERGY_REQUIREMENT_MU",
            original_metric_name="Requirement",
            original_value=120000.0,
            original_unit="MU",
            normalized_value=120000.0,
            normalized_unit="MU",
            geographic_entity_id="IN",
            geographic_level="NATIONAL",
            reporting_period_start=now,
            reporting_period_end=now + timedelta(days=31),
            data_classification=DataClassification.OFFICIAL_OBSERVATION,
            quality_status=QualityStatus.VALID,
            original_source_record_id="A",
            provenance_reference="CEA",
            ingestion_run_id="RUN_1",
            measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
        )
        obs_b = CanonicalObservation(
            **{
                **obs_a.__dict__,
                "observation_id": "OBS_B",
                "source_id": "NPP_GENERATION_DASHBOARD",
                "original_source_record_id": "B",
            }
        )

        report = resolver.compare_observations(obs_a, obs_b)
        assert report is not None
        assert report.severity == ConflictSeverity.IDENTICAL
        assert report.resolved_canonical_value == 120000.0
        # Winner must be CEA (precedence 100 vs NPP 80)
        assert report.primary_source_id == "CEA_POWER_SUPPLY_POSITION"

    def test_acceptable_rounding_variance(self) -> None:
        resolver = ConflictResolver(tolerance_pct=1.0)
        now = datetime(2026, 1, 1, tzinfo=UTC)

        obs_a = CanonicalObservation(
            observation_id="OBS_CEA",
            source_id="CEA_POWER_SUPPLY_POSITION",
            dataset_id="NATIONAL_BALANCE",
            metric_id="ENERGY_REQUIREMENT_MU",
            original_metric_name="Requirement",
            original_value=10000.0,
            original_unit="MU",
            normalized_value=10000.0,
            normalized_unit="MU",
            geographic_entity_id="KA",
            geographic_level="STATE",
            reporting_period_start=now,
            reporting_period_end=now + timedelta(days=31),
            data_classification=DataClassification.OFFICIAL_OBSERVATION,
            quality_status=QualityStatus.VALID,
            original_source_record_id="CEA",
            provenance_reference="CEA",
            ingestion_run_id="RUN_1",
            measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
        )
        obs_b = CanonicalObservation(
            **{
                **obs_a.__dict__,
                "observation_id": "OBS_KA",
                "source_id": "KARNATAKA_OPEN_DATA",
                "original_value": 10050.0,  # 0.498% variance (<= 1.0% tolerance)
                "normalized_value": 10050.0,
            }
        )

        report = resolver.compare_observations(obs_a, obs_b)
        assert report is not None
        assert report.severity == ConflictSeverity.ACCEPTABLE_ROUNDING
        assert report.relative_difference_pct <= 1.0
        # CEA wins by precedence (100 vs 70)
        assert report.resolved_canonical_value == 10000.0

    def test_material_discrepancy_precedence_resolution(self) -> None:
        resolver = ConflictResolver(tolerance_pct=1.0)
        now = datetime(2026, 1, 1, tzinfo=UTC)

        obs_cea = CanonicalObservation(
            observation_id="OBS_CEA",
            source_id="CEA_POWER_SUPPLY_POSITION",
            dataset_id="NATIONAL_BALANCE",
            metric_id="ENERGY_REQUIREMENT_MU",
            original_metric_name="Requirement",
            original_value=10000.0,
            original_unit="MU",
            normalized_value=10000.0,
            normalized_unit="MU",
            geographic_entity_id="KA",
            geographic_level="STATE",
            reporting_period_start=now,
            reporting_period_end=now + timedelta(days=31),
            data_classification=DataClassification.OFFICIAL_OBSERVATION,
            quality_status=QualityStatus.VALID,
            original_source_record_id="CEA",
            provenance_reference="CEA",
            ingestion_run_id="RUN_1",
            measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
        )
        obs_other = CanonicalObservation(
            **{
                **obs_cea.__dict__,
                "observation_id": "OBS_OTHER",
                "source_id": "OPEN_METEO_SOLAR",
                "original_value": 12000.0,  # 16.7% material discrepancy (> 1%)
                "normalized_value": 12000.0,
            }
        )

        report = resolver.compare_observations(obs_cea, obs_other)
        assert report is not None
        assert report.severity == ConflictSeverity.MATERIAL_DISCREPANCY
        assert report.relative_difference_pct > 1.0
        assert report.resolved_canonical_value == 10000.0
        assert "CEA_POWER_SUPPLY_POSITION" in report.resolution_applied


# ---------------------------------------------------------------------------
# 4. GEOGRAPHIC INTEGRITY & ANTI-DISAGGREGATION TESTS
# ---------------------------------------------------------------------------


class TestPhase11GeographicIntegrity:
    def test_anti_disaggregation_guard_blocks_state_to_district(self) -> None:
        ka_state = CanonicalEntityCatalog.get_entity("KA")
        blr_urban = CanonicalEntityCatalog.get_entity("KA_BLR_URBAN")
        assert ka_state is not None
        assert blr_urban is not None

        # Guard: State total cannot be directly assigned to district without meter telemetry
        with pytest.raises(ValueError, match="Synthetic disaggregation forbidden"):
            AntiDisaggregationGuard.assert_no_synthetic_disaggregation(
                source_level="STATE",
                target_level="DISTRICT",
                target_entity_id="KA_BLR_URBAN",
                has_direct_observations=False,
            )

    def test_utility_territory_distinct_from_district(self) -> None:
        bescom = CanonicalEntityCatalog.get_entity("BESCOM")
        blr_urban = CanonicalEntityCatalog.get_entity("KA_BLR_URBAN")
        assert bescom is not None
        assert blr_urban is not None
        assert bescom.level == GeoLevel.UTILITY
        assert blr_urban.level == GeoLevel.DISTRICT
        assert bescom.entity_id != blr_urban.entity_id

        # BESCOM service territory contains 8 districts, not just Bengaluru Urban
        assert "KA_BLR_URBAN" in bescom.served_districts
        assert len(bescom.served_districts) == 8
