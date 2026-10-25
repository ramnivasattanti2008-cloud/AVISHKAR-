"""Comprehensive Automated Test Suite for UrjaSetu EMS Data Trust Engine (Phase 6).

Verifies:
1. Strict unit validation, conversions, and dimensional invariants (Power vs Energy).
2. Geographic hierarchy integrity, alias resolution, and anti-disaggregation protections.
3. Multi-dimensional data quality validation pipeline and batch auditing.
4. Idempotent ingestion and official revision history preservation.
5. Source freshness evaluation (7 statuses) distinguishing transport from cadence.
6. Provenance separation across observations, calculations, and forecasts.
7. Source connector contracts (CeaConnector, DiscomConnector).
8. Operational safety (secret redaction, rate limiting, retry policy, schema drift).
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
from avishkar_ems.trust.connectors.cea_connector import CeaConnector
from avishkar_ems.trust.connectors.discom_connector import DiscomConnector
from avishkar_ems.trust.data_quality import DataQualityValidator, RuleOutcome
from avishkar_ems.trust.freshness_engine import FreshnessEngine, FreshnessStatus
from avishkar_ems.trust.geo_integrity import (
    AntiDisaggregationGuard,
    CanonicalEntityCatalog,
    CoverageMatrixChecker,
    GeoAliasResolver,
    GeoLevel,
)
from avishkar_ems.trust.idempotent_ingestion import (
    IdempotentIngestionEngine,
    IngestionAction,
)
from avishkar_ems.trust.operational_safety import (
    RateLimiter,
    RetryPolicy,
    SchemaDriftDetector,
    SecretRedactor,
)
from avishkar_ems.trust.provenance_classifier import (
    CalculatedStatisticLineage,
    ForecastLineage,
    ProvenanceAuditor,
)
from avishkar_ems.trust.source_registry import (
    ConnectionStatus,
    ReportingCadence,
    SourceRecord,
    SourceRegistry,
)
from avishkar_ems.trust.unit_validation import (
    UnitCategory,
    UnitValidator,
    convert_power_to_energy,
    convert_units,
    validate_solar_share_denominator,
)

# ---------------------------------------------------------------------------
# FIXTURES
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_valid_observation() -> CanonicalObservation:
    now = datetime(2025, 1, 1, 0, 0, tzinfo=UTC)
    return CanonicalObservation(
        observation_id="TEST_OBS_001",
        source_id="CEA_PSP_MONTHLY",
        dataset_id="NATIONAL_BALANCE",
        metric_id="ENERGY_REQUIREMENT_MU",
        original_metric_name="Energy Requirement",
        original_value=144576.0,
        original_unit="MU",
        normalized_value=144576.0,
        normalized_unit="MU",
        geographic_entity_id="IN",
        geographic_level="NATIONAL",
        reporting_period_start=now,
        reporting_period_end=now + timedelta(days=31),
        data_classification=DataClassification.OFFICIAL_OBSERVATION,
        quality_status=QualityStatus.VALID,
        original_source_record_id="REC_2025_01",
        provenance_reference="CEA PSP Monthly Table 1",
        ingestion_run_id="RUN_20250101_000000",
        measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
        observation_timestamp=now + timedelta(days=31),
    )


# ---------------------------------------------------------------------------
# 1. UNIT VALIDATION TESTS
# ---------------------------------------------------------------------------


class TestUnitValidation:
    def test_valid_power_conversions(self) -> None:
        assert convert_units(1000.0, "kW", "MW") == 1.0
        assert convert_units(2.5, "GW", "MW") == 2500.0
        assert convert_units(500.0, "MW", "kW") == 500000.0

    def test_valid_energy_conversions(self) -> None:
        assert convert_units(1000.0, "kWh", "MWh") == 1.0
        assert convert_units(1.0, "GWh", "MWh") == 1000.0
        assert convert_units(1.0, "MU", "GWh") == 1.0
        assert convert_units(1.0, "MU", "kWh") == 1000000.0

    def test_incompatible_cross_category_conversions_rejected(self) -> None:
        with pytest.raises(TypeError, match="Cannot convert between incompatible unit categories"):
            convert_units(100.0, "kW", "kWh")

        with pytest.raises(TypeError, match="Cannot convert between incompatible unit categories"):
            convert_units(50.0, "MW", "MU")

    def test_convert_power_to_energy_requires_duration(self) -> None:
        # 100 kW for 2.5 hours = 250 kWh
        assert convert_power_to_energy(100.0, "kW", 2.5) == 250.0
        # 10 MW for 1 hour = 10 MWh
        assert convert_power_to_energy(10.0, "MW", 1.0, target_energy_unit="MWh") == 10.0

        with pytest.raises(ValueError, match="Duration in hours must be strictly positive"):
            convert_power_to_energy(100.0, "kW", 0.0)

        with pytest.raises(TypeError, match="Power value must be in POWER category"):
            convert_power_to_energy(100.0, "kWh", 1.0)

    def test_solar_share_denominator_type_validation(self) -> None:
        # Valid: Energy / Energy
        assert validate_solar_share_denominator("MU", "MU") is True
        assert validate_solar_share_denominator("kWh", "kWh") is True

        # Invalid: Energy / Capacity (Installed MW)
        with pytest.raises(TypeError, match="Solar share denominator must be in ENERGY category"):
            validate_solar_share_denominator("MU", "MW")

    def test_unit_validator_registry(self) -> None:
        assert UnitValidator.is_valid_unit("MW") is True
        assert UnitValidator.is_valid_unit("INVALID_UNIT") is False
        assert UnitValidator.get_category("MU") == UnitCategory.ENERGY


# ---------------------------------------------------------------------------
# 2. GEOGRAPHIC INTEGRITY TESTS
# ---------------------------------------------------------------------------


class TestGeographicIntegrity:
    def test_canonical_entities_catalog(self) -> None:
        in_entity = CanonicalEntityCatalog.get_entity("IN")
        assert in_entity is not None
        assert in_entity.level == GeoLevel.NATIONAL

        ka_entity = CanonicalEntityCatalog.get_entity("KA")
        assert ka_entity is not None
        assert ka_entity.parent_entity_id == "IN"

        blr_entity = CanonicalEntityCatalog.get_entity("KA_BLR_URBAN")
        assert blr_entity is not None
        assert blr_entity.level == GeoLevel.DISTRICT
        assert blr_entity.parent_entity_id == "KA"

    def test_geo_alias_resolver(self) -> None:
        assert GeoAliasResolver.resolve("Bangalore") == "KA_BLR_URBAN"
        assert GeoAliasResolver.resolve("bengaluru urban") == "KA_BLR_URBAN"
        assert GeoAliasResolver.resolve("BLR") == "KA_BLR_URBAN"
        assert GeoAliasResolver.resolve("Vizag") == "AP_VSKP"
        assert GeoAliasResolver.resolve("visakhapatnam") == "AP_VSKP"
        assert GeoAliasResolver.resolve("Unknown Region XYZ") is None

    def test_anti_disaggregation_guard(self) -> None:
        # State to District disaggregation without direct telemetry must be blocked
        with pytest.raises(ValueError, match="Synthetic disaggregation forbidden"):
            AntiDisaggregationGuard.assert_no_synthetic_disaggregation(
                source_level="STATE",
                target_level="DISTRICT",
                target_entity_id="KA_BLR_URBAN",
                has_direct_observations=False,
            )

        # Direct observations allow attribution
        AntiDisaggregationGuard.assert_no_synthetic_disaggregation(
            source_level="DISTRICT",
            target_level="DISTRICT",
            target_entity_id="KA_BLR_URBAN",
            has_direct_observations=True,
        )

    def test_coverage_matrix_checker(self) -> None:
        assert CoverageMatrixChecker.is_metric_available("IN", "ENERGY_REQUIREMENT_MU") is True
        assert CoverageMatrixChecker.is_metric_available("KA", "SOLAR_GENERATION_MU") is True
        # District level does NOT have monthly CEA balance
        assert CoverageMatrixChecker.is_metric_available("KA_BLR_URBAN", "ENERGY_REQUIREMENT_MU") is False


# ---------------------------------------------------------------------------
# 3. DATA QUALITY VALIDATION TESTS
# ---------------------------------------------------------------------------


class TestDataQualityValidator:
    def test_valid_observation_passes(self, sample_valid_observation: CanonicalObservation) -> None:
        status, results = DataQualityValidator.validate(sample_valid_observation)
        assert status == QualityStatus.VALID
        assert all(r.outcome in {RuleOutcome.PASSED, RuleOutcome.WARNING} for r in results)

    def test_invalid_period_dates_rejected(self, sample_valid_observation: CanonicalObservation) -> None:
        # start after end
        bad_obs = CanonicalObservation(
            **{
                **sample_valid_observation.__dict__,
                "observation_id": "BAD_DATES",
                "reporting_period_start": datetime(2025, 2, 1, tzinfo=UTC),
                "reporting_period_end": datetime(2025, 1, 1, tzinfo=UTC),
            }
        )
        status, results = DataQualityValidator.validate(bad_obs)
        assert status == QualityStatus.REJECTED
        date_rule = next(r for r in results if r.rule_id == "VAL_PERIOD_INTERVAL")
        assert date_rule.outcome == RuleOutcome.FAILED

    def test_negative_value_on_non_negative_metric_rejected(
        self, sample_valid_observation: CanonicalObservation
    ) -> None:
        bad_obs = CanonicalObservation(
            **{
                **sample_valid_observation.__dict__,
                "observation_id": "BAD_NEG",
                "original_value": -500.0,
                "normalized_value": -500.0,
            }
        )
        status, results = DataQualityValidator.validate(bad_obs)
        assert status == QualityStatus.REJECTED
        neg_rule = next(r for r in results if r.rule_id == "VAL_VALUE_NON_NEGATIVE")
        assert neg_rule.outcome == RuleOutcome.FAILED

    def test_unregistered_unit_rejected(self, sample_valid_observation: CanonicalObservation) -> None:
        bad_obs = CanonicalObservation(
            **{
                **sample_valid_observation.__dict__,
                "observation_id": "BAD_UNIT",
                "original_unit": "FAKE_JOULES",
            }
        )
        status, results = DataQualityValidator.validate(bad_obs)
        assert status == QualityStatus.REJECTED


# ---------------------------------------------------------------------------
# 4. IDEMPOTENT INGESTION AND REVISION TESTS
# ---------------------------------------------------------------------------


class TestIdempotentIngestion:
    def test_insert_and_duplicate_detection(self, sample_valid_observation: CanonicalObservation) -> None:
        engine = IdempotentIngestionEngine()

        # First ingestion -> INSERTED_NEW
        res1 = engine.ingest(sample_valid_observation)
        assert res1.action == IngestionAction.INSERTED_NEW
        assert res1.version == 1
        assert engine.count == 1

        # Second identical ingestion -> IGNORED_DUPLICATE
        res2 = engine.ingest(sample_valid_observation)
        assert res2.action == IngestionAction.IGNORED_DUPLICATE
        assert res2.version == 1
        assert engine.count == 1

    def test_official_provider_revision_creates_version(
        self, sample_valid_observation: CanonicalObservation
    ) -> None:
        engine = IdempotentIngestionEngine()
        engine.ingest(sample_valid_observation)

        # Provider publishes revised value for the same reporting period
        revised_obs = CanonicalObservation(
            **{
                **sample_valid_observation.__dict__,
                "observation_id": "TEST_OBS_001_REV",
                "original_value": 145000.0,
                "normalized_value": 145000.0,
                "source_publication_timestamp": datetime(2025, 2, 15, tzinfo=UTC),
            }
        )

        res = engine.ingest(revised_obs)
        assert res.action == IngestionAction.REVISED_CORRECTION
        assert res.version == 2
        assert engine.count == 1

        # Check revision history
        record = engine.get_record(res.composite_key)
        assert record is not None
        assert record.current_version == 2
        assert record.current_observation.normalized_value == 145000.0
        assert len(record.history) == 2
        assert record.history[0][1].normalized_value == 144576.0
        assert record.history[1][1].normalized_value == 145000.0


# ---------------------------------------------------------------------------
# 5. SOURCE FRESHNESS EVALUATION TESTS
# ---------------------------------------------------------------------------


class TestFreshnessEngine:
    def test_fresh_monthly_observation(self, sample_valid_observation: CanonicalObservation) -> None:
        source = SourceRegistry.get_source("CEA_PSP_MONTHLY")
        assert source is not None

        # Evaluated 10 days after reporting period end
        eval_time = sample_valid_observation.reporting_period_end + timedelta(days=10)
        evaluation = FreshnessEngine.evaluate(source, sample_valid_observation, now=eval_time)

        assert evaluation.status == FreshnessStatus.FRESH
        assert evaluation.is_cache_stale is False
        assert evaluation.confidence_score >= 0.9

    def test_delayed_monthly_observation(self, sample_valid_observation: CanonicalObservation) -> None:
        source = SourceRegistry.get_source("CEA_PSP_MONTHLY")
        assert source is not None

        # Evaluated 85 days after period end (exceeds 30d cadence + 45d publication delay = 75d threshold)
        eval_time = sample_valid_observation.reporting_period_end + timedelta(days=85)
        evaluation = FreshnessEngine.evaluate(source, sample_valid_observation, now=eval_time)

        assert evaluation.status == FreshnessStatus.DELAYED
        assert evaluation.is_cache_stale is False

    def test_stale_observation(self, sample_valid_observation: CanonicalObservation) -> None:
        # Create non-historical monthly source
        source = SourceRecord(
            source_id="TEST_SOURCE",
            official_provider_name="Test Provider",
            official_documentation_url="https://example.com/docs",
            source_homepage_url="https://example.com",
            dataset_name="Active Dynamic Grid Telemetry",
            dataset_description="Monthly active grid feed",
            original_endpoint_or_file="https://example.com/feed",
            access_method="VERIFIED_OFFICIAL_REPORT",
            authentication_requirements="None",
            geographic_coverage=["NATIONAL"],
            metric_coverage=["ENERGY_REQUIREMENT"],
            measurement_units=["MU"],
            reporting_frequency=ReportingCadence.MONTHLY,
            expected_publication_delay_days=15,
            connection_status=ConnectionStatus.DATA_SUCCESSFULLY_INGESTED,
        )

        eval_time = sample_valid_observation.reporting_period_end + timedelta(days=120)
        evaluation = FreshnessEngine.evaluate(source, sample_valid_observation, now=eval_time)

        assert evaluation.status == FreshnessStatus.STALE
        assert evaluation.is_cache_stale is True

    def test_unconfigured_source(self) -> None:
        source = SourceRegistry.get_source("APEPDCL_CONSUMER")
        assert source is not None

        evaluation = FreshnessEngine.evaluate(source, None)
        assert evaluation.status == FreshnessStatus.ACCESS_NOT_CONFIGURED


# ---------------------------------------------------------------------------
# 6. PROVENANCE SEPARATION TESTS
# ---------------------------------------------------------------------------


class TestProvenanceSeparation:
    def test_calculated_statistic_lineage(self) -> None:
        now = datetime(2025, 1, 1, tzinfo=UTC)
        stat = CalculatedStatisticLineage(
            statistic_id="STAT_GAP_202501",
            metric_id="ENERGY_GAP_MU",
            name="Energy Gap",
            value=686.0,
            unit="MU",
            formula="Energy Requirement - Energy Supplied",
            input_observation_ids=["CEA_REQ_IN_2024-04", "CEA_SUP_IN_2024-04"],
            geographic_entity_id="IN",
            geographic_level="NATIONAL",
            reporting_period_start=now,
            reporting_period_end=now + timedelta(days=31),
        )

        obs = stat.to_canonical_observation()
        assert obs.data_classification == DataClassification.CALCULATED_STATISTIC
        assert obs.source_id == "URJASETU_ANALYTICS_ENGINE"
        assert "Energy Requirement - Energy Supplied" in obs.provenance_reference

    def test_forecast_lineage(self) -> None:
        now = datetime(2025, 1, 1, tzinfo=UTC)
        fc = ForecastLineage(
            forecast_id="FC_DEMAND_202502",
            metric_id="ENERGY_REQUIREMENT_MU",
            target_metric_name="Energy Requirement",
            predicted_value=150000.0,
            unit="MU",
            model_id="SEASONAL_PERSISTENCE",
            model_version="1.0.0",
            input_period_start=now - timedelta(days=365),
            input_period_end=now,
            forecast_generation_time=now,
            forecast_horizon_months=1,
            target_period_start=now,
            target_period_end=now + timedelta(days=31),
            geographic_entity_id="IN",
            geographic_level="NATIONAL",
        )

        obs = fc.to_canonical_observation()
        assert obs.data_classification == DataClassification.FORECAST
        assert obs.source_id == "URJASETU_FORECAST_ENGINE"

    def test_auditor_rejects_silent_official_promotion(self, sample_valid_observation: CanonicalObservation) -> None:
        # Attempt to label a calculated dataset as OFFICIAL_OBSERVATION
        masquerading_obs = CanonicalObservation(
            **{
                **sample_valid_observation.__dict__,
                "observation_id": "FAKE_OFFICIAL",
                "dataset_id": "CALCULATED_FORECASTS",
                "data_classification": DataClassification.OFFICIAL_OBSERVATION,
            }
        )
        with pytest.raises(ValueError, match="claims OFFICIAL_OBSERVATION but dataset_id is"):
            ProvenanceAuditor.audit_classification(masquerading_obs)


# ---------------------------------------------------------------------------
# 7. SOURCE CONNECTOR CONTRACT TESTS
# ---------------------------------------------------------------------------


class TestSourceConnectors:
    def test_cea_connector_lifecycle(self) -> None:
        source = SourceRegistry.get_source("CEA_PSP_MONTHLY")
        assert source is not None

        connector = CeaConnector(source)
        access_ok, reason = connector.validate_access()
        assert access_ok is True

        raw = connector.fetch_raw()
        valid, errors = connector.validate_schema(raw)
        assert valid is True
        assert len(errors) == 0

        parsed = connector.parse(raw)
        assert len(parsed) > 0

        canonical = connector.normalize(parsed, "TEST_RUN_001")
        assert len(canonical) > 0
        assert all(c.data_classification == DataClassification.OFFICIAL_OBSERVATION for c in canonical)

        health = connector.health_check()
        assert health.is_healthy is True

    def test_discom_connector_pending_approval_handling(self) -> None:
        source = SourceRegistry.get_source("APEPDCL_CONSUMER")
        assert source is not None

        connector = DiscomConnector(source)
        access_ok, reason = connector.validate_access()
        assert access_ok is False
        assert "awaiting regulatory approval" in reason

        health = connector.health_check()
        assert health.is_healthy is False
        assert "awaiting regulatory approval" in (health.error_message or "")

    def test_discom_connector_mock_fixture_mode(self) -> None:
        source = SourceRegistry.get_source("BESCOM_MITHRA")
        assert source is not None

        fixture = [
            {
                "consumer_id": "BLR_MTR_101",
                "timestamp": "2025-01-01T10:00:00Z",
                "kwh": 2.45,
                "utility_id": "BESCOM",
            }
        ]

        connector = DiscomConnector(source, fixture_payload=fixture)
        access_ok, _ = connector.validate_access()
        assert access_ok is True

        parsed = connector.parse(connector.fetch_raw())
        canonical = connector.normalize(parsed, "TEST_FIXTURE_RUN")
        assert len(canonical) == 1
        assert canonical[0].data_classification == DataClassification.HOUSEHOLD_METER
        assert canonical[0].normalized_unit == "kWh"


# ---------------------------------------------------------------------------
# 8. OPERATIONAL SAFETY TESTS
# ---------------------------------------------------------------------------


class TestOperationalSafety:
    def test_secret_redactor_strings(self) -> None:
        secret_str = "Authorization: Bearer secret_token_xyz123 and phone 9876543210"
        clean = SecretRedactor.redact_string(secret_str)
        assert "secret_token_xyz123" not in clean
        assert "***REDACTED_TOKEN***" in clean
        assert "9876543210" not in clean
        assert "***PHONE_REDACTED***" in clean

    def test_secret_redactor_nested_dict(self) -> None:
        payload = {
            "api_key": "AKIAIOSFODNN7EXAMPLE",
            "db_password": "supersecretpassword",
            "consumer": {
                "mobile": "9123456789",
                "account_number": "1234567890",
            },
            "public_metric": "ENERGY_REQUIREMENT_MU",
        }
        clean = SecretRedactor.redact_dict(payload)
        assert clean["api_key"] == "***REDACTED_CREDENTIAL***"
        assert clean["db_password"] == "***REDACTED_CREDENTIAL***"
        assert clean["consumer"]["mobile"] == "***REDACTED_CREDENTIAL***"
        assert clean["public_metric"] == "ENERGY_REQUIREMENT_MU"

    def test_retry_policy_exponential_backoff(self) -> None:
        policy = RetryPolicy(base_delay_seconds=1.0, backoff_factor=2.0, jitter=False)
        assert policy.calculate_delay(0) == 1.0
        assert policy.calculate_delay(1) == 2.0
        assert policy.calculate_delay(2) == 4.0
        assert policy.calculate_delay(3) == 8.0

    def test_rate_limiter_throttling(self) -> None:
        limiter = RateLimiter(max_requests=2, window_seconds=60.0)
        assert limiter.acquire() is True
        assert limiter.acquire() is True
        # Third immediate request should be throttled
        assert limiter.acquire() is False

    def test_schema_drift_detector(self) -> None:
        expected = {"reportingPeriod", "energyRequirementMu", "energySuppliedMu"}
        actual_valid = {"reportingPeriod", "energyRequirementMu", "energySuppliedMu", "extraNote"}
        valid, warnings = SchemaDriftDetector.inspect(expected, actual_valid)
        assert valid is True
        assert any("Unexpected new columns" in w for w in warnings)

        actual_broken = {"reportingPeriod", "energyRequirementMu"}  # missing energySuppliedMu
        valid_b, warnings_b = SchemaDriftDetector.inspect(expected, actual_broken)
        assert valid_b is False
        assert any("Missing required columns" in w for w in warnings_b)
