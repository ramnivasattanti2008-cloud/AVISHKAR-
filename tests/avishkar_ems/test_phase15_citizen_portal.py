"""Automated Unit, Security, and Integration Tests for Citizen Energy Portal (Phase 15).

Verifies:
1. TC-1501: Public data access boundary & policy enforcement (deny-by-default, household isolation).
2. TC-1502: PII detection and redaction (phone, email, Aadhaar, meter accounts).
3. TC-1503: Evidence upload format validation with magic bytes signatures.
4. TC-1504: Evidence upload security defenses (size limit, disallowed extensions, path traversal, header forgery).
5. TC-1505: Privacy-aware aggregation with k-anonymity (k >= 10) and small-group suppression.
6. TC-1506: Differencing attack prevention across overlapping query subsets.
7. TC-1507: Citizen report submission lifecycle, rate limiting, and sanitization.
8. TC-1508: Moderation state machine transitions and rejection-reason enforcement.
9. TC-1509: Role-based authorization for moderation actions.
10. TC-1510: Cross-user privacy isolation for pending reports and private evidence.
11. TC-1511: Verified public indicators and statutory open datasets catalogue.
12. TC-1512: Full end-to-end citizen reporting and public transparency workflow.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from avishkar_ems.citizen_portal import (
    CitizenPortalService,
    EvidenceUploadValidator,
    IndicatorCategory,
    PIIScrubber,
    PrivacyAwareAggregationEngine,
    PublicEligibilityStatus,
    ReportCategory,
    ReportStatus,
    UserRole,
)


@pytest.fixture
def temp_portal_dirs():
    with tempfile.TemporaryDirectory() as tmp_data:
        data_p = Path(tmp_data)
        evidence_p = data_p / "evidence"
        yield data_p, evidence_p


def test_tc1501_public_data_access_boundary_policy(temp_portal_dirs):
    """TC-1501: Server-side policy denies private household data, PII, and unverified data."""
    data_p, evid_p = temp_portal_dirs
    portal = CitizenPortalService(data_dir=data_p, evidence_storage_dir=evid_p)

    # 1. Private household meter observation must be denied
    res1 = portal.check_public_eligibility({
        "data_classification": "HOUSEHOLD_METER",
        "value": 4.2,
        "unit": "kWh",
    })
    assert not res1.eligible
    assert res1.status == PublicEligibilityStatus.DENIED_HOUSEHOLD_PRIVATE

    # 2. Raw record containing PII must be denied
    res2 = portal.check_public_eligibility({
        "provenance": "VERIFIED_REPORT",
        "customer_name": "Test Consumer",
        "value": 150.0,
    })
    assert not res2.eligible
    assert res2.status == PublicEligibilityStatus.DENIED_PII

    # 3. Text field containing phone number must be denied
    res3 = portal.check_public_eligibility({
        "provenance": "VERIFIED_REPORT",
        "notes": "Call engineer at +91 9876543210 for readings",
    })
    assert not res3.eligible
    assert res3.status == PublicEligibilityStatus.DENIED_PII

    # 4. Small group size aggregation (< 10) must be denied
    res4 = portal.check_public_eligibility({
        "provenance": "CALCULATED_STATISTIC",
        "household_count": 4,
        "mean_kwh": 210.0,
    })
    assert not res4.eligible
    assert res4.status == PublicEligibilityStatus.DENIED_SMALL_GROUP

    # 5. Legitimate statutory public observation must be approved
    res5 = portal.check_public_eligibility({
        "data_classification": "OFFICIAL_OBSERVATION",
        "energySuppliedMu": 145000.0,
        "regionCode": "IN",
    })
    assert res5.eligible
    assert res5.status == PublicEligibilityStatus.ELIGIBLE


def test_tc1502_pii_scrubber_detection_and_redaction():
    """TC-1502: PII scrubber reliably detects and masks sensitive personal identifiers."""
    raw_text = (
        "Report for Ramesh at Indiranagar. Contact phone: +91 9845012345 or 9845098765. "
        "Email him at ramesh.kumar@example.com. Aadhaar: 1234 5678 9012. "
        "Meter RR number: CA-9876543210."
    )
    assert PIIScrubber.contains_pii(raw_text)

    scrubbed = PIIScrubber.scrub_text(raw_text)
    assert "[REDACTED_PHONE]" in scrubbed
    assert "[REDACTED_EMAIL]" in scrubbed
    assert "[REDACTED_AADHAAR]" in scrubbed
    assert "[REDACTED_ACCOUNT_ID]" in scrubbed
    assert "9845012345" not in scrubbed
    assert "ramesh.kumar@example.com" not in scrubbed
    assert "1234 5678 9012" not in scrubbed


def test_tc1503_evidence_upload_valid_formats(temp_portal_dirs):
    """TC-1503: Valid evidence files with correct magic bytes are accepted."""
    _, evid_p = temp_portal_dirs

    # Valid JPEG
    jpg_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 50
    ok, meta = EvidenceUploadValidator.validate_and_prepare(
        filename="outage_photo.jpg",
        content_bytes=jpg_bytes,
        declared_content_type="image/jpeg",
        submitter_id="cit_user_1",
        storage_dir=evid_p,
    )
    assert ok
    assert meta.content_type == "image/jpeg"
    assert not meta.is_approved_for_public_view  # Must be private initially

    # Valid PNG
    png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00" * 30
    ok_png, meta_png = EvidenceUploadValidator.validate_and_prepare(
        filename="transformer_diagram.png",
        content_bytes=png_bytes,
        declared_content_type="image/png",
        submitter_id="cit_user_1",
        storage_dir=evid_p,
    )
    assert ok_png
    assert meta_png.content_type == "image/png"

    # Valid PDF
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj"
    ok_pdf, meta_pdf = EvidenceUploadValidator.validate_and_prepare(
        filename="notice.pdf",
        content_bytes=pdf_bytes,
        declared_content_type="application/pdf",
        submitter_id="cit_user_1",
        storage_dir=evid_p,
    )
    assert ok_pdf
    assert meta_pdf.content_type == "application/pdf"

    # Valid CSV
    csv_bytes = b"timestamp,voltage_v\n2026-10-24T10:00:00Z,230.5\n"
    ok_csv, meta_csv = EvidenceUploadValidator.validate_and_prepare(
        filename="readings.csv",
        content_bytes=csv_bytes,
        declared_content_type="text/csv",
        submitter_id="cit_user_1",
        storage_dir=evid_p,
    )
    assert ok_csv
    assert meta_csv.content_type == "text/csv"


def test_tc1504_evidence_upload_security_defenses(temp_portal_dirs):
    """TC-1504: Security defenses against oversized, disallowed, path traversal, and forged files."""
    _, evid_p = temp_portal_dirs

    # 1. Oversized file (> 5 MB)
    huge_bytes = b"X" * (5 * 1024 * 1024 + 10)
    ok1, err1 = EvidenceUploadValidator.validate_and_prepare(
        filename="huge.pdf",
        content_bytes=huge_bytes,
        declared_content_type="application/pdf",
        submitter_id="user1",
        storage_dir=evid_p,
    )
    assert not ok1
    assert "FILE_OVERSIZED" in err1

    # 2. Disallowed extension (.exe / .py / .sh)
    ok2, err2 = EvidenceUploadValidator.validate_and_prepare(
        filename="malware.exe",
        content_bytes=b"MZ\x90\x00",
        declared_content_type="application/x-msdownload",
        submitter_id="user1",
        storage_dir=evid_p,
    )
    assert not ok2
    assert "DISALLOWED_EXTENSION" in err2

    # 3. Forged magic bytes (PNG extension with invalid bytes)
    ok3, err3 = EvidenceUploadValidator.validate_and_prepare(
        filename="fake.png",
        content_bytes=b"NOT_A_PNG_HEADER",
        declared_content_type="image/png",
        submitter_id="user1",
        storage_dir=evid_p,
    )
    assert not ok3
    assert "INVALID_FILE_SIGNATURE" in err3

    # 4. Path traversal attempt in filename
    ok4, meta4 = EvidenceUploadValidator.validate_and_prepare(
        filename="../../../etc/passwd.txt",
        content_bytes=b"harmless plain text data",
        declared_content_type="text/plain",
        submitter_id="user1",
        storage_dir=evid_p,
    )
    assert ok4
    # Ensure storage filename does not traverse and uses sanitized basename
    assert ".." not in meta4.storage_filename
    assert (evid_p / meta4.storage_filename).exists()


def test_tc1505_privacy_aware_aggregation_k_anonymity():
    """TC-1505: Mathematical k-anonymity (k >= 10) suppresses small household groups."""
    engine = PrivacyAwareAggregationEngine(min_group_size=10)

    records = [
        # Sector A: 12 distinct households (>= 10) -> Must pass
        {"locality": "Sector A", "consumption_kwh": 250.0, "household_id": f"house_a_{i}"}
        for i in range(12)
    ] + [
        # Sector B: 4 distinct households (< 10) -> Must be suppressed
        {"locality": "Sector B", "consumption_kwh": 180.0, "household_id": f"house_b_{i}"}
        for i in range(4)
    ]

    results = engine.aggregate_consumption_by_area(records, area_key="locality", metric_key="consumption_kwh")
    res_dict = {r["area"]: r for r in results}

    # Sector A
    assert res_dict["Sector A"]["status"] == "PUBLIC_AGGREGATE_APPROVED"
    assert res_dict["Sector A"]["household_count"] == 12
    assert res_dict["Sector A"]["mean_consumption_kwh"] == 250.0

    # Sector B
    assert res_dict["Sector B"]["status"] == "SUPPRESSED_PRIVACY_THRESHOLD"
    assert res_dict["Sector B"]["household_count"] is None
    assert res_dict["Sector B"]["mean_consumption_kwh"] is None
    assert "k-anonymity threshold" in res_dict["Sector B"]["explanation"]


def test_tc1506_privacy_aware_differencing_attack_defense():
    """TC-1506: Differencing attack detector blocks sequential queries with delta < k."""
    engine = PrivacyAwareAggregationEngine(min_group_size=10)

    # First query on 20 households
    query_1_ids = {f"user_{i}" for i in range(20)}
    ok1, msg1 = engine.check_differencing_risk(query_1_ids)
    assert ok1
    assert msg1 == "DIFFERENCING_CHECK_PASSED"

    # Second query on 19 of those households (delta = 1 household -> would allow isolating user_19!)
    query_2_ids = {f"user_{i}" for i in range(19)}
    ok2, msg2 = engine.check_differencing_risk(query_2_ids)
    assert not ok2
    assert "DIFFERENCING_ATTACK_DETECTED" in msg2


def test_tc1507_citizen_report_submission_lifecycle(temp_portal_dirs):
    """TC-1507: Citizen submission lifecycle, PII scrubbing, and rate limits."""
    data_p, evid_p = temp_portal_dirs
    portal = CitizenPortalService(data_dir=data_p, evidence_storage_dir=evid_p)

    # Valid submission
    ok, report = portal.submit_citizen_report(
        category=ReportCategory.SERVICE_INTERRUPTION,
        title="Feeder trip near Indiranagar 100ft road",
        description="Electricity outage since 2 PM. Call inspector at 9845012345 for verification.",
        geographic_level="DISTRICT",
        location_name="Bengaluru Urban - Indiranagar",
        submitter_id="cit_user_alpha",
        contact_email="cit_alpha@example.com",
    )
    assert ok
    assert report.status == ReportStatus.SUBMITTED
    assert "[REDACTED_PHONE]" in report.description
    assert "9845012345" not in report.description
    assert not report.is_verified_fact  # Strictly unverified user observation

    # Private residential house address rejection
    ok_priv, err_priv = portal.submit_citizen_report(
        category=ReportCategory.INFRASTRUCTURE_HAZARD,
        title="Sparking meter box",
        description="Meter is sparking and smoking continuously.",
        geographic_level="DISTRICT",
        location_name="House No 42, 3rd Cross, Indiranagar",
        submitter_id="cit_user_alpha",
    )
    assert not ok_priv
    assert "PRIVATE_ADDRESS_DISALLOWED" in err_priv

    # Rate limiting: max 5 submissions per hour
    for i in range(4):
        portal.submit_citizen_report(
            category=ReportCategory.OTHER,
            title=f"General observation report {i}",
            description="Testing rate limiting capacity of the platform.",
            geographic_level="DISTRICT",
            location_name="Bengaluru Urban",
            submitter_id="cit_user_alpha",
        )
    # 6th submission should be rate-limited
    ok_limit, err_limit = portal.submit_citizen_report(
        category=ReportCategory.OTHER,
        title="Exceeded submission rate",
        description="This submission should be rejected due to rate limits.",
        geographic_level="DISTRICT",
        location_name="Bengaluru Urban",
        submitter_id="cit_user_alpha",
    )
    assert not ok_limit
    assert "RATE_LIMIT_EXCEEDED" in err_limit


def test_tc1508_moderation_state_machine_valid_and_invalid_transitions(temp_portal_dirs):
    """TC-1508: State machine transition validity and rejection reason requirements."""
    data_p, evid_p = temp_portal_dirs
    portal = CitizenPortalService(data_dir=data_p, evidence_storage_dir=evid_p)

    ok, report = portal.submit_citizen_report(
        category=ReportCategory.INFRASTRUCTURE_HAZARD,
        title="Damaged electrical pole near junction",
        description="Concrete base is cracked and leaning over the sidewalk.",
        geographic_level="DISTRICT",
        location_name="Hubballi Central Junction",
        submitter_id="cit_user_beta",
    )
    assert ok
    rep_id = report.report_id

    # Invalid jump: SUBMITTED -> RESOLVED directly is prohibited
    ok_jump, err_jump = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.RESOLVED,
        moderator_id="mod_1",
        notes="Attempting invalid bypass",
    )
    assert not ok_jump
    assert "INVALID_TRANSITION" in err_jump

    # Valid transition: SUBMITTED -> UNDER_REVIEW
    ok_m1, _ = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.UNDER_REVIEW,
        moderator_id="mod_1",
        notes="Safety team reviewing infrastructure notice.",
    )
    assert ok_m1

    # Rejection requires reason
    ok_rej_bad, err_rej_bad = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.REJECTED,
        moderator_id="mod_1",
        notes="",
        rejection_reason="",
    )
    assert not ok_rej_bad
    assert "REJECTION_REASON_REQUIRED" in err_rej_bad

    # Valid transition: UNDER_REVIEW -> ACCEPTED_FOR_PUBLICATION
    ok_m2, _ = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.ACCEPTED_FOR_PUBLICATION,
        moderator_id="mod_1",
        notes="Approved for public community notice bulletin.",
        public_resolution_summary="Utility field crew dispatched for inspection.",
    )
    assert ok_m2

    # Valid transition: ACCEPTED_FOR_PUBLICATION -> RESOLVED
    ok_m3, _ = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.RESOLVED,
        moderator_id="mod_1",
        notes="Pole reinforced and verified safe.",
    )
    assert ok_m3


def test_tc1509_moderation_role_authorization(temp_portal_dirs):
    """TC-1509: Only authorized MODERATOR or ADMIN roles can moderate reports."""
    data_p, evid_p = temp_portal_dirs
    portal = CitizenPortalService(data_dir=data_p, evidence_storage_dir=evid_p)

    ok, rep = portal.submit_citizen_report(
        category=ReportCategory.SOLAR_OBSERVATION,
        title="Community solar inverter fault notice",
        description="Public rooftop array at community center shows inverter error code.",
        geographic_level="CITY_AREA",
        location_name="Malleshwaram Community Hall",
        submitter_id="cit_user_gamma",
    )
    assert ok

    # Citizen cannot perform moderation action
    ok_unauth, err_unauth = portal.moderate_report(
        report_id=rep.report_id,
        new_status=ReportStatus.UNDER_REVIEW,
        moderator_id="cit_user_gamma",
        notes="Trying to self-approve",
        user_role=UserRole.CITIZEN,
    )
    assert not ok_unauth
    assert "UNAUTHORIZED_MODERATOR" in err_unauth


def test_tc1510_cross_user_isolation_and_private_report_access(temp_portal_dirs):
    """TC-1510: Pending/unapproved reports are strictly isolated from unauthorized third parties."""
    data_p, evid_p = temp_portal_dirs
    portal = CitizenPortalService(data_dir=data_p, evidence_storage_dir=evid_p)

    ok, rep = portal.submit_citizen_report(
        category=ReportCategory.SERVICE_INTERRUPTION,
        title="Private unmoderated outage complaint",
        description="Transformer outage pending moderation review.",
        geographic_level="DISTRICT",
        location_name="Visakhapatnam Steel City",
        submitter_id="user_owner",
    )
    assert ok

    # Submitter can view their own pending report
    own_view = portal.get_citizen_report_for_user(rep.report_id, requester_id="user_owner", user_role=UserRole.CITIZEN)
    assert own_view is not None
    assert own_view["report_id"] == rep.report_id

    # Third-party citizen CANNOT view the unmoderated report
    other_view = portal.get_citizen_report_for_user(rep.report_id, requester_id="user_stranger", user_role=UserRole.CITIZEN)
    assert other_view is None

    # Unapproved report is NOT in public listing
    pub_list_before = portal.list_public_reports()
    assert not any(r["report_id"] == rep.report_id for r in pub_list_before["items"])

    # Once moderated to ACCEPTED_FOR_PUBLICATION, public listing contains it with PII stripped
    portal.moderate_report(
        report_id=rep.report_id,
        new_status=ReportStatus.UNDER_REVIEW,
        moderator_id="mod_officer",
        notes="Reviewing",
    )
    portal.moderate_report(
        report_id=rep.report_id,
        new_status=ReportStatus.ACCEPTED_FOR_PUBLICATION,
        moderator_id="mod_officer",
        notes="Approved for public display",
    )

    pub_list_after = portal.list_public_reports()
    assert any(r["report_id"] == rep.report_id for r in pub_list_after["items"])


def test_tc1511_verified_public_indicators_and_datasets_catalogue(temp_portal_dirs):
    """TC-1511: Verified public indicators load official statutory numbers with GODL-India datasets."""
    portal = CitizenPortalService()  # Uses repo default data directory

    # 1. Indicators
    indicators = portal.get_public_indicators(geo_scope="ALL")
    assert len(indicators) >= 3

    # Check National Demand Met
    nat_ind = next((ind for ind in indicators if ind.indicator_id == "ind_nat_demand_met"), None)
    assert nat_ind is not None
    assert nat_ind.value > 100000.0  # MU
    assert nat_ind.unit == "MU"
    assert "Central Electricity Authority" in nat_ind.source_organization
    assert nat_ind.verification_status == "VERIFIED_REPORT"
    assert nat_ind.is_observed_fact

    # Check Category Filter
    ren_inds = portal.get_public_indicators(category=IndicatorCategory.RENEWABLE_ENERGY)
    assert all(ind.category == IndicatorCategory.RENEWABLE_ENERGY for ind in ren_inds)

    # 2. Datasets Catalogue
    catalogue = portal.get_public_datasets_catalogue()
    assert len(catalogue) >= 3
    assert any("GODL-India" in d["license"] for d in catalogue)
    assert any("Central Electricity Authority" in d["publisher"] for d in catalogue)


def test_tc1512_end_to_end_citizen_portal_workflow(temp_portal_dirs):
    """TC-1512: Complete 10-step end-to-end citizen portal workflow."""
    data_p, evid_p = temp_portal_dirs
    portal = CitizenPortalService(data_dir=data_p, evidence_storage_dir=evid_p)

    # 1. Visitor views public indicators
    inds = portal.get_public_indicators(geo_scope="NATIONAL")
    assert len(inds) >= 1

    # 2. Citizen drafts and submits an observation
    ok_sub, rep = portal.submit_citizen_report(
        category=ReportCategory.EFFICIENCY_FEEDBACK,
        title="Public street lights on continuously during midday",
        description="Streetlights on ring road remain illuminated all afternoon. Please check timer circuit.",
        geographic_level="CITY_AREA",
        location_name="Koramangala Outer Ring Road",
        submitter_id="cit_citizen_e2e",
        contact_email="citizen.e2e@example.com",
        consent_public_display=True,
    )
    assert ok_sub
    rep_id = rep.report_id

    # 3. Citizen uploads supporting photo
    jpg_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 40
    ok_up, evid_meta = portal.upload_evidence_for_report(
        report_id=rep_id,
        filename="streetlights_noon.jpg",
        content_bytes=jpg_bytes,
        declared_content_type="image/jpeg",
        submitter_id="cit_citizen_e2e",
    )
    assert ok_up
    assert not evid_meta.is_approved_for_public_view

    # 4. Third-party user cannot see report yet
    third_party_view = portal.get_citizen_report_for_user(rep_id, requester_id="cit_other_user")
    assert third_party_view is None

    # 5. Moderator opens review queue
    queue = portal.list_moderation_queue(status_filter=ReportStatus.SUBMITTED)
    assert any(q["report_id"] == rep_id for q in queue)

    # 6. Moderator transitions report: SUBMITTED -> UNDER_REVIEW
    ok_m1, _ = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.UNDER_REVIEW,
        moderator_id="officer_kumar",
        notes="Field team assigned to investigate lighting control timer.",
    )
    assert ok_m1

    # 7. Moderator approves report and evidence: UNDER_REVIEW -> ACCEPTED_FOR_PUBLICATION
    ok_m2, _ = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.ACCEPTED_FOR_PUBLICATION,
        moderator_id="officer_kumar",
        notes="Observation verified; approved for public community bulletin.",
        approve_evidence_ids=[evid_meta.file_id],
        public_resolution_summary="Municipal energy cell notified to reset astronomical timer.",
    )
    assert ok_m2

    # 8. Report now appears in public community listing
    pub_listing = portal.list_public_reports(category=ReportCategory.EFFICIENCY_FEEDBACK)
    matching = next((r for r in pub_listing["items"] if r["report_id"] == rep_id), None)
    assert matching is not None
    assert matching["status"] == ReportStatus.ACCEPTED_FOR_PUBLICATION.value
    assert matching["evidence_count"] == 1
    assert "citizen.e2e@example.com" not in str(matching)  # Private email hash not exposed

    # 9. Municipal cell repairs issue, moderator resolves: ACCEPTED_FOR_PUBLICATION -> RESOLVED
    ok_m3, _ = portal.moderate_report(
        report_id=rep_id,
        new_status=ReportStatus.RESOLVED,
        moderator_id="officer_kumar",
        notes="Astronomical timer replaced; day-burning resolved.",
        public_resolution_summary="Defective light sensor replaced on 2026-10-24.",
    )
    assert ok_m3

    # 10. Final citizen status tracking check
    final_view = portal.get_citizen_report_for_user(rep_id, requester_id="cit_citizen_e2e")
    assert final_view["status"] == ReportStatus.RESOLVED.value
    assert "Defective light sensor replaced" in final_view["public_resolution_summary"]
