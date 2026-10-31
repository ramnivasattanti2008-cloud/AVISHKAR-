"""Comprehensive Test Suite for Phase 9: Personal Home Energy Intelligence & Multi-Home Monitoring.

Covers:
1. Multi-home CRUD operations and property management.
2. Cross-user access denial and strict server-side ownership.
3. Utility account masking and password storage prevention.
4. Appliance breakdown refusal without physical submetering.
5. Official BESCOM and APEPDCL tariff calculations (telescopic slabs, fixed charges, tax).
6. Bill parser extraction (text, CSV, XLSX, confidence, caveats).
7. Meter import wizard (column mapping, cumulative vs interval, meter resets, spikes).
8. Cumulative readings vs interval consumption invariant (never sum cumulative readings).
9. Idempotent import tracking with SHA-256 fingerprinting.
10. File size validation and oversized upload rejection.
11. Multi-home comparative analytics (kWh per sanctioned kW).
12. Solar tracking (generation vs capacity decoupling).
13. Household forecasting eligibility and tournament execution.
"""

from __future__ import annotations

import io
import pathlib
import zipfile

import pytest

from avishkar_ems.forecast_eligibility import TimeSeriesPoint
from avishkar_ems.household_analytics import HouseholdAnalyticsEngine
from avishkar_ems.household_import import (
    ColumnMappingConfig,
    HouseholdBillParser,
    MeterReadingImportEngine,
    compute_file_sha256,
    validate_file_size,
)
from avishkar_ems.household_module import (
    HouseholdManager,
    HouseholdProfile,
    IntegrationStatus,
    UtilityBillRecord,
    UtilityProvider,
    ValidationStatus,
)
from avishkar_ems.household_tariffs import (
    APEPDCL_LT1_DOMESTIC,
    BESCOM_LT2A_DOMESTIC,
    HouseholdTariffEngine,
    TariffType,
)


@pytest.fixture
def manager() -> HouseholdManager:
    return HouseholdManager()


# ------------------ 1. MULTI-HOME & USER OWNERSHIP ISOLATION ------------------


def test_independent_household_profiles(manager: HouseholdManager) -> None:
    profiles = manager.list_profiles()
    assert len(profiles) >= 2

    blr = manager.get_profile("home_blr_bescom")
    vskp = manager.get_profile("home_vskp_apepdcl")

    assert blr.utility == UtilityProvider.BESCOM
    assert vskp.utility == UtilityProvider.APEPDCL
    assert blr.city == "Bengaluru"
    assert vskp.city == "Visakhapatnam"
    assert blr.profile_id != vskp.profile_id


def test_profile_data_isolation(manager: HouseholdManager) -> None:
    blr = manager.get_profile("home_blr_bescom")
    vskp = manager.get_profile("home_vskp_apepdcl")
    initial_vskp_bills = len(vskp.bills)

    new_bill = UtilityBillRecord(
        bill_month="2026-04",
        bill_date="2026-05-05",
        units_consumed_kwh=430.0,
        total_amount_inr=3350.0,
        fixed_charge_inr=350.0,
        energy_charge_inr=3000.0,
        net_meter_export_kwh=220.0,
        solar_credit_inr=682.0,
    )

    manager.record_bill("home_blr_bescom", new_bill)
    assert len(blr.bills) == 4
    # Visakhapatnam profile must remain strictly unaffected
    assert len(vskp.bills) == initial_vskp_bills


def test_cross_user_access_denial(manager: HouseholdManager) -> None:
    """Security Invariant: User B cannot access, modify, or delete User A's home."""
    # User A creates a home
    home_a = HouseholdProfile(
        profile_id="home_user_a_mysore",
        user_id="user_alice",
        display_name="Alice Mysore Cottage",
        city="Mysuru",
        state="KA",
        utility=UtilityProvider.BESCOM,
        connection_account_id="MYS11223344",
        sanctioned_load_kw=3.0,
        solar_capacity_kwp=2.0,
        battery_capacity_kwh=0.0,
        tariff_category="LT-2(a)",
        integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
    )
    manager.create_home("user_alice", home_a)

    # User Alice can access her own home
    assert manager.get_home("user_alice", "home_user_a_mysore").display_name == "Alice Mysore Cottage"

    # User Bob attempts to access Alice's home -> MUST raise PermissionError
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        manager.get_home("user_bob", "home_user_a_mysore")

    # User Bob attempts to update Alice's home -> MUST raise PermissionError
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        manager.update_home("user_bob", "home_user_a_mysore", display_name="Hacked Home")

    # User Bob attempts to delete Alice's home -> MUST raise PermissionError
    with pytest.raises(PermissionError, match="ACCESS DENIED"):
        manager.delete_home("user_bob", "home_user_a_mysore")


def test_multi_home_crud_workflow(manager: HouseholdManager) -> None:
    """Tests creating, renaming, editing, and deleting a home property."""
    user_id = "user_charlie"
    new_home = HouseholdProfile(
        profile_id="home_charlie_guntur",
        user_id=user_id,
        display_name="Charlie Guntur Villa",
        city="Guntur",
        state="AP",
        utility=UtilityProvider.APSPDCL,
        connection_account_id="GUN998877",
        sanctioned_load_kw=6.0,
        solar_capacity_kwp=5.0,
        battery_capacity_kwh=10.0,
        tariff_category="LT-1 Domestic",
        integration_status=IntegrationStatus.AWAITING_AUTHORIZATION,
    )
    manager.create_home(user_id, new_home)
    assert len(manager.list_homes(user_id)) == 1

    # Rename & update load
    updated = manager.update_home(user_id, "home_charlie_guntur", display_name="Charlie Guntur Smart Home", sanctioned_load_kw=7.0)
    assert updated.display_name == "Charlie Guntur Smart Home"
    assert updated.sanctioned_load_kw == 7.0

    # Delete home
    assert manager.delete_home(user_id, "home_charlie_guntur") is True
    assert len(manager.list_homes(user_id)) == 0


def test_refuse_utility_password_storage(manager: HouseholdManager) -> None:
    # Invariant: Never store utility passwords
    with pytest.raises(ValueError, match="DATA SECURITY VIOLATION"):
        manager.verify_no_password_storage({"username": "user1", "password": "supersecretpassword123"})


def test_refuse_appliance_level_claim_without_submeter(manager: HouseholdManager) -> None:
    # Invariant: Do not claim appliance-level measurement without actual sub-meter source
    breakdown = manager.get_appliance_breakdown("home_blr_bescom")
    assert breakdown["status"] == "UNAVAILABLE"
    assert "cannot be claimed as appliance-level measurements" in breakdown["message"]


def test_masked_account_id(manager: HouseholdManager) -> None:
    blr = manager.get_profile("home_blr_bescom")
    masked = blr.mask_account_id()
    assert masked.startswith("BES")
    assert masked.endswith("029")
    assert "..." in masked


# ------------------ 2. TARIFF & BILL RECONSTRUCTION ENGINE ------------------


def test_bescom_lt2a_tariff_calculation() -> None:
    """Verifies telescopic slab and fixed charge calculations for BESCOM LT-2(a)."""
    # 250 kWh consumption, 5 kW sanctioned load
    # Fixed charge: 5 kW * 70 = ₹350
    # Slabs:
    #   0 - 100 kWh: 100 * 4.75 = ₹475
    #   100 - 250 kWh: 150 * 7.00 = ₹1,050
    # Total Energy Charge = ₹1,525
    # Tax (9% on energy charge): 1525 * 0.09 = ₹137.25
    # Gross bill = 350 + 1525 + 137.25 = ₹2,012.25
    result = HouseholdTariffEngine.calculate_bill(
        consumption_kwh=250.0,
        sanctioned_load_kw=5.0,
        schedule=BESCOM_LT2A_DOMESTIC,
        solar_export_kwh=0.0,
        calculation_type=TariffType.RECONSTRUCTED_ESTIMATE,
    )

    assert result.fixed_charge_inr == 350.0
    assert result.energy_charge_inr == 1525.0
    assert result.tax_and_duty_inr == 137.25
    assert result.gross_bill_inr == 2012.25
    assert result.net_bill_inr == 2012.25
    assert result.calculation_type == TariffType.RECONSTRUCTED_ESTIMATE
    assert len(result.breakdown_slabs) == 2


def test_apepdcl_lt1_tariff_calculation() -> None:
    """Verifies progressive slab calculation for APEPDCL LT-1 Domestic Group B."""
    # 200 kWh consumption, 4 kW sanctioned load
    # Fixed charge: 4 kW * 60 = ₹240
    # Slabs:
    #   0 - 30 kWh: 30 * 1.90 = ₹57
    #   31 - 75 kWh: 45 * 3.00 = ₹135
    #   76 - 125 kWh: 50 * 4.50 = ₹225
    #   126 - 200 kWh: 75 * 6.00 = ₹450
    # Energy charge = 57 + 135 + 225 + 450 = ₹867
    # Tax (6%): 867 * 0.06 = ₹52.02
    # Gross bill = 240 + 867 + 52.02 = ₹1,159.02
    result = HouseholdTariffEngine.calculate_bill(
        consumption_kwh=200.0,
        sanctioned_load_kw=4.0,
        schedule=APEPDCL_LT1_DOMESTIC,
        solar_export_kwh=50.0,  # 50 kWh exported @ 2.50 = ₹125 credit
        calculation_type=TariffType.RECONSTRUCTED_ESTIMATE,
    )

    assert result.fixed_charge_inr == 240.0
    assert result.energy_charge_inr == 867.0
    assert result.tax_and_duty_inr == 52.02
    assert result.solar_credit_inr == 125.0
    assert result.net_bill_inr == round(1159.02 - 125.0, 2)


def test_negative_consumption_raises_error() -> None:
    with pytest.raises(ValueError, match="Consumption cannot be negative"):
        HouseholdTariffEngine.calculate_bill(consumption_kwh=-10.0, sanctioned_load_kw=5.0)


# ------------------ 3. UTILITY BILL PARSER ------------------


def test_parse_text_utility_bill() -> None:
    bill_text = """
    BANGALORE ELECTRICITY SUPPLY COMPANY LIMITED (BESCOM)
    Bill Date: 2026-03-05
    Billing Month: 2026-02
    Due Date: 2026-03-20
    Consumer Account: BES982341029
    Tariff: LT-2(a) Domestic
    Previous Reading: 14612.0
    Current Reading: 14997.0
    Units Consumed: 385.0 kWh
    Fixed Charges: Rs. 350.00
    Energy Charges: Rs. 2560.00
    Electricity Duty: Rs. 230.40
    Solar Export Units: 210.0 kWh
    Solar Credit: Rs. 651.00
    Net Payable: Rs. 2910.00
    """
    res = HouseholdBillParser.parse_bill_content(bill_text, filename="bescom_sample.txt")
    assert res.bill_month == "2026-02"
    assert res.bill_date == "2026-03-05"
    assert res.units_consumed_kwh == 385.0
    assert res.total_amount_inr == 2910.0
    assert res.fixed_charge_inr == 350.0
    assert res.net_meter_export_kwh == 210.0
    assert res.solar_credit_inr == 651.0
    assert res.confidence_score >= 0.8
    assert res.tariff_category == "LT-2(a) Domestic"


def test_bill_parser_missing_fields_warning() -> None:
    sparse_text = "Some utility paper without clear numbers"
    res = HouseholdBillParser.parse_bill_content(sparse_text, filename="unclear.txt")
    assert len(res.warnings) > 0
    assert res.confidence_score < 0.5


# ------------------ 4. METER IMPORT WIZARD & CUMULATIVE VS INTERVAL ------------------


def test_cumulative_vs_interval_separation() -> None:
    """CRITICAL INVARIANT: Cumulative meter readings must NOT be summed as interval consumption."""
    rows = [
        {"time": "2026-03-01 00:00:00", "cumulative_kwh": "1000.0"},
        {"time": "2026-03-01 01:00:00", "cumulative_kwh": "1001.2"},  # delta = 1.2
        {"time": "2026-03-01 02:00:00", "cumulative_kwh": "1002.0"},  # delta = 0.8
        {"time": "2026-03-01 03:00:00", "cumulative_kwh": "1003.5"},  # delta = 1.5
    ]
    mapping = ColumnMappingConfig(
        timestamp_col="time",
        cumulative_reading_col="cumulative_kwh",
    )
    summary, valid = MeterReadingImportEngine.preview_and_validate(rows, mapping)

    assert summary.valid_rows == 4
    # The derived interval consumption for rows 1, 2, 3 must be [1.2, 0.8, 1.5]
    assert valid[1]["interval_consumption_kwh"] == 1.2
    assert valid[2]["interval_consumption_kwh"] == 0.8
    assert valid[3]["interval_consumption_kwh"] == 1.5

    # Summing the intervals gives 3.5 kWh, whereas summing cumulative readings would wrongly give ~4000 kWh!
    total_interval_kwh = sum(v["interval_consumption_kwh"] for v in valid if v["interval_consumption_kwh"] is not None)
    assert round(total_interval_kwh, 2) == 3.5


def test_meter_reset_detection() -> None:
    """Detects meter reset or replacement when cumulative reading drops without producing negative consumption."""
    rows = [
        {"time": "2026-03-01 00:00:00", "meter_reading": "9998.0"},
        {"time": "2026-03-01 01:00:00", "meter_reading": "9999.5"},
        {"time": "2026-03-01 02:00:00", "meter_reading": "5.0"},  # Reset occurred!
        {"time": "2026-03-01 03:00:00", "meter_reading": "6.2"},
    ]
    mapping = ColumnMappingConfig(timestamp_col="time", cumulative_reading_col="meter_reading")
    summary, valid = MeterReadingImportEngine.preview_and_validate(rows, mapping)

    assert summary.reset_events == 1
    # Row 2 should be marked RESET_DETECTED and non-negative
    assert valid[2]["validation_status"] == ValidationStatus.RESET_DETECTED
    assert valid[2]["interval_consumption_kwh"] == 5.0  # safe handling


def test_idempotent_import_fingerprint() -> None:
    """Verifies SHA-256 fingerprinting for import idempotency."""
    csv_bytes = b"timestamp,interval_kwh\n2026-03-01 00:00:00,0.45\n2026-03-01 01:00:00,0.50\n"
    h1 = compute_file_sha256(csv_bytes)
    h2 = compute_file_sha256(csv_bytes)
    assert h1 == h2
    assert len(h1) == 64

    mapping = ColumnMappingConfig(timestamp_col="timestamp", interval_kwh_col="interval_kwh")
    res = MeterReadingImportEngine.execute_import(
        property_id="home_blr_bescom",
        file_content=csv_bytes,
        filename="test_meter.csv",
        mapping=mapping,
    )
    assert res.inserted_count == 2
    assert res.sha256_hash == h1


def test_oversized_upload_rejection() -> None:
    oversized = b"x" * (11 * 1024 * 1024)  # 11 MB
    with pytest.raises(ValueError, match="FILE REJECTED: Upload size"):
        validate_file_size(oversized)


def test_xlsx_parser_standard_library() -> None:
    """Tests standard library zipfile XML spreadsheet extraction."""
    # Build a minimal valid XLSX archive in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "xl/sharedStrings.xml",
            '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Timestamp</t></si><si><t>kWh</t></si></sst>',
        )
        z.writestr(
            "xl/worksheets/sheet1.xml",
            '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>2026-03-01</v></c><c r="B2"><v>12.5</v></c></row></sheetData></worksheet>',
        )
    content = buf.getvalue()

    headers, data = MeterReadingImportEngine.parse_tabular_data(content, "smart_meter.xlsx")
    assert headers == ["Timestamp", "kWh"]
    assert len(data) == 1
    assert data[0]["Timestamp"] == "2026-03-01"
    assert data[0]["kWh"] == "12.5"


# ------------------ 5. MULTI-HOME COMPARISON & SOLAR ANALYTICS ------------------


def test_multi_home_comparison(manager: HouseholdManager) -> None:
    blr = manager.get_profile("home_blr_bescom")
    vskp = manager.get_profile("home_vskp_apepdcl")

    comp = HouseholdAnalyticsEngine.compare_homes(blr, vskp)
    assert comp.profile_id_a == "home_blr_bescom"
    assert comp.profile_id_b == "home_vskp_apepdcl"
    assert comp.state_a == "KA"
    assert comp.state_b == "AP"
    assert comp.sanctioned_load_kw_a == 5.0
    assert comp.sanctioned_load_kw_b == 4.0
    assert comp.kwh_per_sanctioned_kw_a > 0.0
    assert comp.kwh_per_sanctioned_kw_b > 0.0
    assert len(comp.comparison_notes) >= 3


def test_solar_tracking_decoupled_from_capacity(manager: HouseholdManager) -> None:
    blr = manager.get_profile("home_blr_bescom")
    solar = HouseholdAnalyticsEngine.analyze_solar_performance(blr)

    assert solar["has_solar_installation"] is True
    assert solar["installed_capacity_kwp"] == 4.5
    assert solar["total_net_export_kwh"] > 0.0
    assert "never synthesizes solar generation from capacity alone" in solar["physics_disclaimer"]


# ------------------ 6. HOUSEHOLD FORECASTING ------------------


def test_household_forecasting_eligibility_rejection_on_short_history(manager: HouseholdManager) -> None:
    """Verifies that a household with only 3 months of bills is rejected by Phase 8 eligibility engine."""
    blr = manager.get_profile("home_blr_bescom")
    # blr has 3 bills
    res = HouseholdAnalyticsEngine.forecast_household_demand(blr, horizon_months=3)
    assert res.is_eligible is False
    assert any("minimum of 6" in c.lower() for c in res.caveats + [res.eligibility_reason])


def test_household_forecasting_tournament_on_eligible_series(manager: HouseholdManager) -> None:
    """Verifies that an eligible 12-month household series executes the Phase 8 model tournament."""
    blr = manager.get_profile("home_blr_bescom")
    # Synthetic 12-month series for household test
    months = [f"2025-{m:02d}" for m in range(1, 13)]
    kwh_vals = [320.0, 310.0, 350.0, 420.0, 450.0, 410.0, 380.0, 370.0, 360.0, 340.0, 330.0, 325.0]

    series = [
        TimeSeriesPoint(period=m, value=kwh, unit="kWh")
        for m, kwh in zip(months, kwh_vals, strict=False)
    ]

    res = HouseholdAnalyticsEngine.forecast_household_demand(blr, horizon_months=3, synthetic_series=series)
    assert res.is_eligible is True
    assert res.champion_model_name is not None
    assert len(res.forecast_points) == 3
    assert res.forecast_points[0]["forecast_p50_kwh"] > 0.0
    assert res.forecast_points[0]["lower_bound_p10_kwh"] <= res.forecast_points[0]["forecast_p50_kwh"]


def test_meter_import_duplicate_rows_skipped() -> None:
    """Verifies that rows with duplicate timestamps within an upload are cleanly skipped."""
    rows = [
        {"time": "2026-03-01 00:00:00", "kwh": "0.45"},
        {"time": "2026-03-01 00:00:00", "kwh": "0.45"},  # Duplicate!
        {"time": "2026-03-01 01:00:00", "kwh": "0.55"},
    ]
    mapping = ColumnMappingConfig(timestamp_col="time", interval_kwh_col="kwh")
    summary, valid = MeterReadingImportEngine.preview_and_validate(rows, mapping)
    assert summary.duplicate_rows == 1
    assert len(valid) == 2


def test_billing_cost_trend_analysis(manager: HouseholdManager) -> None:
    """Verifies historical cost trend analysis and variance calculation."""
    blr = manager.get_profile("home_blr_bescom")
    trends = HouseholdAnalyticsEngine.analyze_cost_trends(blr)
    assert len(trends) == 3
    for t in trends:
        assert t["actual_amount_inr"] > 0.0
        assert t["reconstructed_amount_inr"] > 0.0
        assert t["effective_rate_per_kwh"] > 0.0


def test_bill_calculation_disclaimer_and_labeling() -> None:
    """Verifies that calculated bills include disclaimers and clear estimate labeling."""
    res = HouseholdTariffEngine.calculate_bill(
        consumption_kwh=150.0,
        sanctioned_load_kw=3.0,
        schedule="KA_BESCOM_LT2A_2024",
    )
    assert res.calculation_type == TariffType.RECONSTRUCTED_ESTIMATE
    assert "Actual bill is from official utility statement" in res.disclaimer


def test_solar_credit_reduces_gross_bill() -> None:
    """Verifies that net-metering solar export credit correctly reduces gross bill amount."""
    without_solar = HouseholdTariffEngine.calculate_bill(
        consumption_kwh=300.0,
        sanctioned_load_kw=4.0,
        schedule=BESCOM_LT2A_DOMESTIC,
        solar_export_kwh=0.0,
    )
    with_solar = HouseholdTariffEngine.calculate_bill(
        consumption_kwh=300.0,
        sanctioned_load_kw=4.0,
        schedule=BESCOM_LT2A_DOMESTIC,
        solar_export_kwh=100.0,
    )
    assert with_solar.solar_credit_inr == 310.0  # 100 kWh * ₹3.10
    assert with_solar.net_bill_inr == round(without_solar.gross_bill_inr - 310.0, 2)


def test_appliance_submeter_opt_in_allows_breakdown(manager: HouseholdManager) -> None:
    """Verifies that sub-metered appliance breakdown is only accessible when verified CT clamps are present."""
    home = HouseholdProfile(
        profile_id="home_submetered",
        display_name="Smart Plug Residence",
        city="Bengaluru",
        state="KA",
        utility=UtilityProvider.BESCOM,
        connection_account_id="BES9999",
        sanctioned_load_kw=5.0,
        solar_capacity_kwp=0.0,
        battery_capacity_kwh=0.0,
        tariff_category="LT-2(a)",
        integration_status=IntegrationStatus.MANUAL_IMPORT_ONLY,
        has_submetered_appliances=True,
    )
    manager.create_home("user_default", home)
    breakdown = manager.get_appliance_breakdown("home_submetered")
    assert breakdown["status"] == "AVAILABLE"


def test_sqlite_persistence_survives_restart(tmp_path: pathlib.Path) -> None:
    """Verifies that household profiles, bills, and mutations persist to SQLite and survive restarts."""
    db_file = str(tmp_path / "test_urjasetu.db")
    mgr1 = HouseholdManager(db_path=db_file)

    new_home = HouseholdProfile(
        profile_id="home_persisted_test",
        display_name="Persistent Home",
        city="Mysuru",
        state="KA",
        utility=UtilityProvider.BESCOM,
        connection_account_id="MYS123456",
        sanctioned_load_kw=6.0,
        solar_capacity_kwp=3.0,
        battery_capacity_kwh=5.0,
        tariff_category="LT-2(a)",
        integration_status=IntegrationStatus.AUTHORIZED_ACTIVE,
    )
    mgr1.create_home("user_mysuru", new_home)
    bill = UtilityBillRecord("2026-05", "2026-06-01", 310.0, 2400.0, 210.0, 2190.0)
    mgr1.record_bill("home_persisted_test", bill, user_id="user_mysuru")

    # Re-instantiate manager pointing at the same database (simulating process restart)
    mgr2 = HouseholdManager(db_path=db_file)
    recovered = mgr2.get_home("user_mysuru", "home_persisted_test")
    assert recovered.display_name == "Persistent Home"
    assert recovered.sanctioned_load_kw == 6.0
    assert len(recovered.bills) == 1
    assert recovered.bills[0].bill_month == "2026-05"
    assert recovered.bills[0].total_amount_inr == 2400.0


