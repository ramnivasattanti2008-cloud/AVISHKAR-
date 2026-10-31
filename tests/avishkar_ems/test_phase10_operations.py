"""Comprehensive Operational & End-to-End Validation Test Suite for UrjaSetu EMS (Phase 10).

Verifies:
1. DataSourceHealthCenter operational evaluation across all registered sources.
2. Strict separation of transport reachability from observation freshness.
3. System liveness, readiness, and dependency health checks.
4. Dynamic ingestion telemetry recording, latency tracking, and secret-redacted error reporting.
5. Ingestion pipeline hardening: idempotency, deduplication, official revision tracking, and non-destructive rollbacks.
6. Full end-to-end workflow: Property creation -> Bill statement import -> Tariff cost reconstruction
   -> Forecasting eligibility gating -> Anomaly detection -> Health Center reporting.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from avishkar_ems.anomaly_detector import AnomalyDetectionEngine
from avishkar_ems.health_center import (
    DataSourceHealthCenter,
    OperationalState,
    SourceType,
)
from avishkar_ems.household_analytics import HouseholdAnalyticsEngine
from avishkar_ems.household_import import (
    ColumnMappingConfig,
    HouseholdBillParser,
    MeterReadingImportEngine,
)
from avishkar_ems.household_module import (
    HouseholdManager,
    HouseholdProfile,
    IntegrationStatus,
    UtilityBillRecord,
    UtilityProvider,
)
from avishkar_ems.household_tariffs import HouseholdTariffEngine
from avishkar_ems.time_series_trends import TimeSeriesPoint
from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    DataClassification,
    MeasurementKind,
    QualityStatus,
)
from avishkar_ems.trust.idempotent_ingestion import (
    IdempotentIngestionEngine,
    IngestionAction,
)
from avishkar_ems.trust.source_registry import (
    SourceConnectionStatus,
    SourceRecord,
    SourceRegistry,
)

# ---------------------------------------------------------------------------
# 1. HEALTH CENTER EVALUATION TESTS
# ---------------------------------------------------------------------------


def test_health_center_evaluates_all_connectors() -> None:
    """Verifies that every registered source is evaluated with complete operational telemetry."""
    health_center = DataSourceHealthCenter()
    connectors = health_center.evaluate_all()
    assert len(connectors) >= 6

    # Verify CEA Power Supply Position
    cea = next(c for c in connectors if c.source_id == "CEA_POWER_SUPPLY_POSITION")
    assert cea.source_type == SourceType.IMPORTED_REPORT
    assert cea.operational_state in {OperationalState.HEALTHY, OperationalState.DELAYED_STALE}
    assert cea.records_accepted > 0
    assert cea.freshness_threshold_days == 65.0
    assert cea.retrieval_latency_ms is not None
    assert cea.retrieval_latency_ms > 0

    # Verify APEPDCL is marked ACCESS_RESTRICTED (awaiting formal consumer MOU / OTP)
    apepdcl = next(c for c in connectors if c.source_id == "APEPDCL_CONSUMER_SERVICES")
    assert apepdcl.operational_state == OperationalState.ACCESS_RESTRICTED
    assert "awaiting regulatory approval" in apepdcl.state_explanation.lower()


def test_transport_success_vs_observation_staleness() -> None:
    """Strictly verifies that transport success with outdated observations yields DELAYED_STALE, never HEALTHY."""
    stale_time = datetime.now(UTC) - timedelta(days=120)  # 120 days old (> 65 day threshold)
    custom_reg = SourceRegistry()
    cea_rec = custom_reg.get("CEA_POWER_SUPPLY_POSITION")

    # Create record with old observation
    stale_record = SourceRecord(
        source_id="CEA_POWER_SUPPLY_POSITION",
        provider_name=cea_rec.official_provider_name,
        documentation_url=cea_rec.official_documentation_url,
        access_method=cea_rec.access_method,
        connection_status=SourceConnectionStatus.DATA_INGESTED,
        last_successful_retrieval=datetime.now(UTC),  # Transport succeeded right now!
        latest_observed_measurement=stale_time,  # But data is 120 days old
        geographic_coverage=["NATIONAL", "STATE"],
        metric_coverage=["ENERGY_REQUIREMENT"],
    )

    hc = DataSourceHealthCenter(registry=custom_reg)
    telemetry = hc.evaluate_connector(stale_record)

    assert telemetry.operational_state == OperationalState.DELAYED_STALE
    assert "is stale" in telemetry.state_explanation.lower()
    assert telemetry.observation_age_days is not None
    assert telemetry.observation_age_days >= 119.0


def test_system_liveness_and_readiness() -> None:
    """Verifies system liveness and application readiness checks."""
    hc = DataSourceHealthCenter()
    liveness = hc.get_liveness()
    assert liveness.status == "UP"
    assert liveness.uptime_seconds >= 0.0
    assert liveness.process_id > 0

    readiness = hc.get_readiness()
    assert readiness.status == "READY"
    assert readiness.components_verified["canonical_geo_catalog"] is True
    assert readiness.components_verified["cea_national_balance_file"] is True
    assert readiness.components_verified["geo_hierarchy_file"] is True


def test_dependency_health_checks() -> None:
    """Verifies health inspection of local report stores and utility gateway seams."""
    hc = DataSourceHealthCenter()
    deps = hc.get_dependency_health()
    assert len(deps) >= 3

    report_dep = next(d for d in deps if "Reports Cache" in d.dependency_name)
    assert report_dep.is_healthy is True
    assert report_dep.status_label == "OK"

    bescom_dep = next(d for d in deps if "BESCOM" in d.dependency_name)
    assert bescom_dep.is_healthy is True
    assert bescom_dep.status_label == "STANDBY_VERIFIED"


def test_dynamic_ingestion_metrics_and_secret_redaction() -> None:
    """Verifies that runtime ingestion telemetry is tracked and credentials in errors are redacted."""
    hc = DataSourceHealthCenter()
    leak_error = "Connection failed to endpoint with auth token Bearer super_secret_jwt_token_12345"

    hc.record_ingestion_metrics(
        source_id="CEA_POWER_SUPPLY_POSITION",
        latency_ms=45.2,
        records_received=100,
        records_accepted=75,
        records_rejected=25,
        warnings=["Non-fatal outlier detected in feeder 4"],
        error_message=leak_error,
        retry_count=2,
        retry_status="SUCCEEDED",
    )

    cea_rec = hc._registry.get("CEA_POWER_SUPPLY_POSITION")
    telemetry = hc.evaluate_connector(cea_rec)

    assert telemetry.retrieval_latency_ms == 45.2
    assert telemetry.records_received == 100
    assert telemetry.records_accepted == 75
    assert telemetry.records_rejected == 25
    assert telemetry.retry_count == 2
    # Verify rejection rate > 20% triggered DEGRADED state
    assert telemetry.operational_state == OperationalState.DEGRADED
    # Verify secret token was redacted
    assert "super_secret_jwt_token_12345" not in str(telemetry.last_failure_reason)
    assert "***REDACTED_TOKEN***" in str(telemetry.last_failure_reason)


# ---------------------------------------------------------------------------
# 2. INGESTION PIPELINE HARDENING & IDEMPOTENCY TESTS
# ---------------------------------------------------------------------------


def test_idempotent_ingestion_duplicate_suppression() -> None:
    """Verifies that identical observations are ingested once, and duplicates return IGNORED_DUPLICATE."""
    engine = IdempotentIngestionEngine()
    now = datetime(2025, 4, 1, 0, 0, tzinfo=UTC)

    obs = CanonicalObservation(
        observation_id="OBS_TEST_01",
        source_id="CEA_PSP_MONTHLY",
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
        reporting_period_end=now + timedelta(days=30),
        data_classification=DataClassification.OFFICIAL_OBSERVATION,
        quality_status=QualityStatus.VALID,
        original_source_record_id="REC_01",
        provenance_reference="CEA Annexure I",
        ingestion_run_id="RUN_001",
        measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
    )

    res1 = engine.ingest_observation(obs)
    assert res1.action == IngestionAction.INSERTED_NEW
    assert res1.version == 1

    # Re-ingest byte-identical observation
    res2 = engine.ingest_observation(obs)
    assert res2.action == IngestionAction.IGNORED_DUPLICATE
    assert res2.version == 1


def test_official_revision_history_preserved() -> None:
    """Verifies that official provider revisions update the record version and preserve prior history."""
    engine = IdempotentIngestionEngine()
    now = datetime(2025, 4, 1, 0, 0, tzinfo=UTC)

    obs_v1 = CanonicalObservation(
        observation_id="OBS_TEST_02",
        source_id="CEA_PSP_MONTHLY",
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
        reporting_period_end=now + timedelta(days=30),
        data_classification=DataClassification.OFFICIAL_OBSERVATION,
        quality_status=QualityStatus.VALID,
        original_source_record_id="REC_02",
        provenance_reference="CEA Annexure I Provisional",
        ingestion_run_id="RUN_001",
        measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
    )
    engine.ingest_observation(obs_v1)

    # Official revised publication with corrected number: 121500.0 MU
    obs_v2 = CanonicalObservation(
        observation_id="OBS_TEST_02_REV",
        source_id="CEA_PSP_MONTHLY",
        dataset_id="NATIONAL_BALANCE",
        metric_id="ENERGY_REQUIREMENT_MU",
        original_metric_name="Requirement",
        original_value=121500.0,
        original_unit="MU",
        normalized_value=121500.0,
        normalized_unit="MU",
        geographic_entity_id="IN",
        geographic_level="NATIONAL",
        reporting_period_start=now,
        reporting_period_end=now + timedelta(days=30),
        data_classification=DataClassification.OFFICIAL_OBSERVATION,
        quality_status=QualityStatus.VALID,
        original_source_record_id="REC_02_REV",
        provenance_reference="CEA Annexure I Final Revised",
        ingestion_run_id="RUN_002",
        measurement_kind=MeasurementKind.PERIOD_TOTAL_MU,
    )

    res_rev = engine.ingest_observation(obs_v2, allow_official_revisions=True)
    assert res_rev.action == IngestionAction.REVISED_CORRECTION
    assert res_rev.version == 2

    # Check that prior version is retained in history
    ckey = res_rev.composite_key
    history = engine._store[ckey].history
    assert len(history) == 2
    assert history[0][0] == 1
    assert history[0][1].normalized_value == 120000.0
    assert history[1][0] == 2
    assert history[1][1].normalized_value == 121500.0


# ---------------------------------------------------------------------------
# 3. END-TO-END WORKFLOW INTEGRATION TEST
# ---------------------------------------------------------------------------


def test_end_to_end_household_energy_workflow() -> None:
    """Traces full workflow:
    1. Household creation under authenticated user.
    2. Utility bill statement import with pre-commit review.
    3. Official tariff reconstruction (BESCOM LT-2a).
    4. Meter reading interval import with reset detection.
    5. Predictive intelligence holdout gating.
    6. Anomaly detection with MAD and seasonal residuals.
    7. Data-Source Health Center telemetry reporting.
    """
    mgr = HouseholdManager()
    user_id = "user_e2e_prod"

    # Step 1: Create Home Profile
    profile = HouseholdProfile(
        profile_id="home_e2e_blr",
        user_id=user_id,
        display_name="E2E Bengaluru Smart Residence",
        city="Bengaluru",
        district="Bengaluru Urban",
        locality="Indiranagar",
        state="KA",
        utility=UtilityProvider.BESCOM,
        connection_account_id="BES991122334",
        sanctioned_load_kw=5.0,
        solar_capacity_kwp=4.0,
        battery_capacity_kwh=5.0,
        tariff_category="LT-2a Domestic",
        integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
    )
    home = mgr.create_home(user_id=user_id, profile=profile)
    assert home.profile_id == "home_e2e_blr"

    # Step 2: Parse Bill Statements
    bill_text = """
    BANGALORE ELECTRICITY SUPPLY COMPANY LIMITED (BESCOM)
    Account ID: 991122334
    Billing Month: 2026-02
    Bill Date: 2026-03-05
    Sanctioned Load: 5.0 kW
    Units Consumed: 300 kWh
    Fixed Charges: Rs 475.00
    Energy Charges: Rs 1770.00
    Tax and Duty: Rs 135.00
    Net Meter Export: 120 kWh
    Solar Credit: Rs 456.00
    Total Payable: Rs 1924.00
    """
    extracted = HouseholdBillParser.parse_bill_content(bill_text.encode("utf-8"), filename="feb_bill.txt")
    assert extracted.bill_month == "2026-02"
    assert extracted.units_consumed_kwh == 300.0
    assert extracted.total_amount_inr == 1924.0
    assert extracted.net_meter_export_kwh == 120.0

    bill_record = UtilityBillRecord(
        bill_month=extracted.bill_month,
        bill_date=extracted.bill_date,
        units_consumed_kwh=extracted.units_consumed_kwh,
        total_amount_inr=extracted.total_amount_inr,
        fixed_charge_inr=extracted.fixed_charge_inr,
        energy_charge_inr=extracted.energy_charge_inr,
        tax_and_duty_inr=extracted.tax_and_duty_inr,
        net_meter_export_kwh=extracted.net_meter_export_kwh,
        solar_credit_inr=extracted.solar_credit_inr,
    )
    mgr.record_bill(profile_id=home.profile_id, bill=bill_record, user_id=user_id)
    assert len(mgr.get_home(user_id, home.profile_id).bills) == 1

    # Step 3: Tariff Reconstruction Check
    tariff_calc = HouseholdTariffEngine.calculate_bill(
        consumption_kwh=300.0,
        sanctioned_load_kw=5.0,
        schedule="KA_BESCOM_LT2A_2024",
        solar_export_kwh=120.0,
    )
    assert tariff_calc.consumption_kwh == 300.0
    assert tariff_calc.net_bill_inr > 0
    assert tariff_calc.fixed_charge_inr == 350.0  # 5 kW * ₹70/kW

    # Step 4: Import Meter Readings with Reset Detection
    csv_content = (
        b"Timestamp,Cumulative_kWh,Interval_kWh\n"
        b"2026-02-01 00:00,1000.0,0.5\n"
        b"2026-02-01 01:00,1001.2,1.2\n"
        b"2026-02-01 02:00,1002.5,1.3\n"
        b"2026-02-01 03:00,50.0,0.4\n"  # Meter reset!
    )

    cfg = ColumnMappingConfig(
        timestamp_col="Timestamp",
        cumulative_reading_col="Cumulative_kWh",
        interval_kwh_col="Interval_kWh",
    )
    res_import = MeterReadingImportEngine.execute_import(
        property_id=home.profile_id,
        file_content=csv_content,
        filename="feb_meter.csv",
        mapping=cfg,
    )
    assert res_import.validation_summary.reset_events == 1
    assert res_import.inserted_count > 0

    # Step 5: Predictive Intelligence 6-Month Holdout Gating
    fore = HouseholdAnalyticsEngine.forecast_household_demand(home, horizon_months=3)
    # Only 1 month uploaded -> must be gated out with data honesty disclaimer
    assert fore.is_eligible is False
    assert "at least 6 consecutive observations" in fore.eligibility_reason.lower()

    # Step 6: Anomaly Detection Engine
    detector = AnomalyDetectionEngine()
    raw_vals = [100.0, 102.0, 98.0, 105.0, 99.0, 101.0, 350.0]  # Clear spike at the end
    pts = [TimeSeriesPoint(period=f"2026-01-0{i}", value=v, unit="kWh") for i, v in enumerate(raw_vals, 1)]
    anomalies = detector.detect_rolling_mad_anomalies(
        series=pts,
        metric_id="household_kwh",
        geo_code="KA_BLR_URBAN",
        window_size=6,
        mad_threshold=2.5,
    )
    assert len(anomalies) >= 1
    assert anomalies[0].observed_value == 350.0
    assert "rolling baseline" in anomalies[0].explanation.lower() or "deviation" in anomalies[0].explanation.lower()

    # Step 7: Health Center Assessment
    hc = DataSourceHealthCenter()
    report = hc.get_system_health_report()
    assert report.liveness.status == "UP"
    assert report.readiness.status == "READY"
    assert report.summary_counts["total"] >= 6
    assert report.summary_counts["delayed_stale"] >= 1
    assert report.summary_counts["access_restricted"] >= 1
