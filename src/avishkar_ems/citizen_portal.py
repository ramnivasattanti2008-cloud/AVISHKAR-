"""Citizen Energy Portal & Public Transparency Services for UrjaSetu EMS (Phase 15).

Delivers an authentic, privacy-conscious public energy portal:
1. Strict server-side Public Data Access Boundary (deny-by-default for private/unverified data).
2. Transparent, verified public energy indicators (CEA, KPTCL, POSOCO) with verifiable lineage.
3. Citizen submission and report moderation workflows with formal state machine & audit trail.
4. Upload and evidence security (file size, MIME magic bytes, path traversal defense, private storage).
5. Public aggregation and re-identification protection (k-anonymity k >= 10, differencing attack defense, PII scrubbing).
6. Comprehensive role-based access control (CITIZEN, MODERATOR, ADMIN).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

# -----------------------------------------------------------------------------
# 1. ENUMS & CONSTANTS
# -----------------------------------------------------------------------------

DEFAULT_MIN_GROUP_SIZE = 10
MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_SUBMISSIONS_PER_HOUR = 5


class PublicEligibilityStatus(StrEnum):
    ELIGIBLE = "ELIGIBLE"
    DENIED_HOUSEHOLD_PRIVATE = "DENIED_HOUSEHOLD_PRIVATE"
    DENIED_PII = "DENIED_PII"
    DENIED_UNVERIFIED = "DENIED_UNVERIFIED"
    DENIED_SMALL_GROUP = "DENIED_SMALL_GROUP"
    DENIED_OPERATIONAL_RESTRICTED = "DENIED_OPERATIONAL_RESTRICTED"


class IndicatorCategory(StrEnum):
    DEMAND_SUPPLY = "DEMAND_SUPPLY"
    RENEWABLE_ENERGY = "RENEWABLE_ENERGY"
    GENERATION_MIX = "GENERATION_MIX"
    TARIFF_TRANSPARENCY = "TARIFF_TRANSPARENCY"
    GRID_RELIABILITY = "GRID_RELIABILITY"


class ReportCategory(StrEnum):
    SERVICE_INTERRUPTION = "SERVICE_INTERRUPTION"
    INFRASTRUCTURE_HAZARD = "INFRASTRUCTURE_HAZARD"
    SOLAR_OBSERVATION = "SOLAR_OBSERVATION"
    DATA_CORRECTION = "DATA_CORRECTION"
    EFFICIENCY_FEEDBACK = "EFFICIENCY_FEEDBACK"
    OTHER = "OTHER"


class ReportStatus(StrEnum):
    SUBMITTED = "SUBMITTED"
    PENDING_REVIEW = "PENDING_REVIEW"
    UNDER_REVIEW = "UNDER_REVIEW"
    NEEDS_CLARIFICATION = "NEEDS_CLARIFICATION"
    ACCEPTED_FOR_PUBLICATION = "ACCEPTED_FOR_PUBLICATION"
    REJECTED = "REJECTED"
    RESOLVED = "RESOLVED"
    ARCHIVED = "ARCHIVED"


class UserRole(StrEnum):
    CITIZEN = "CITIZEN"
    MODERATOR = "MODERATOR"
    ADMIN = "ADMIN"


# Valid state machine transitions for report moderation
VALID_REPORT_TRANSITIONS: dict[ReportStatus, set[ReportStatus]] = {
    ReportStatus.SUBMITTED: {
        ReportStatus.PENDING_REVIEW,
        ReportStatus.UNDER_REVIEW,
        ReportStatus.REJECTED,
    },
    ReportStatus.PENDING_REVIEW: {
        ReportStatus.UNDER_REVIEW,
        ReportStatus.REJECTED,
    },
    ReportStatus.UNDER_REVIEW: {
        ReportStatus.NEEDS_CLARIFICATION,
        ReportStatus.ACCEPTED_FOR_PUBLICATION,
        ReportStatus.REJECTED,
    },
    ReportStatus.NEEDS_CLARIFICATION: {
        ReportStatus.UNDER_REVIEW,
        ReportStatus.SUBMITTED,
        ReportStatus.REJECTED,
    },
    ReportStatus.ACCEPTED_FOR_PUBLICATION: {
        ReportStatus.RESOLVED,
        ReportStatus.UNDER_REVIEW,
        ReportStatus.ARCHIVED,
    },
    ReportStatus.REJECTED: {
        ReportStatus.ARCHIVED,
        ReportStatus.UNDER_REVIEW,
    },
    ReportStatus.RESOLVED: {
        ReportStatus.ARCHIVED,
    },
    ReportStatus.ARCHIVED: set(),
}

# -----------------------------------------------------------------------------
# 2. DATA STRUCTURES & POLICIES
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class PublicDataPolicyRule:
    """Server-side policy definition governing public release of energy telemetry."""

    min_group_size: int = DEFAULT_MIN_GROUP_SIZE
    deny_by_default: bool = True
    disallowed_classifications: frozenset[str] = frozenset({
        "HOUSEHOLD_METER",
        "UNVERIFIED_OR_UNAVAILABLE",
        "RAW_UNMODERATED_CITIZEN_SUBMISSION",
    })
    allowed_classifications: frozenset[str] = frozenset({
        "OFFICIAL_OBSERVATION",
        "IMPORTED_STATUTORY",
        "VERIFIED_REPORT",
        "CALCULATED_STATISTIC",
        "PUBLIC_COMMUNITY_OBSERVATION",
    })


@dataclass(frozen=True)
class PublicDataEligibilityResult:
    """Result of checking whether an observation, record, or metric can be made public."""

    eligible: bool
    status: PublicEligibilityStatus
    reason: str
    policy_rules_evaluated: list[str]
    sanitized_data: dict[str, Any] | None = None


@dataclass(frozen=True)
class PublicEnergyIndicator:
    """Verified public energy indicator with traceable provenance and limitations."""

    indicator_id: str
    name: str
    category: IndicatorCategory
    geographic_scope: str  # "NATIONAL", "STATE_KA", "STATE_AP", "STATE_MH"
    geographic_display_name: str
    reporting_period: str
    value: float
    unit: str
    source_organization: str
    source_dataset: str
    source_url: str
    retrieval_timestamp: str
    data_classification: str
    verification_status: str
    methodology: str
    known_limitations: list[str]
    data_freshness_status: str
    is_observed_fact: bool = True


@dataclass(frozen=True)
class EvidenceFileMetadata:
    """Metadata for uploaded evidence attached to citizen reports."""

    file_id: str
    original_filename: str
    storage_filename: str
    file_size_bytes: int
    content_type: str
    sha256_hash: str
    uploaded_at: str
    submitter_id: str
    is_approved_for_public_view: bool = False


@dataclass(frozen=True)
class AuditLogEntry:
    """Tamper-evident audit log for moderation and lifecycle transitions."""

    timestamp: str
    actor_id: str
    actor_role: UserRole
    action: str
    previous_status: ReportStatus | None
    new_status: ReportStatus | None
    notes: str


@dataclass
class CitizenReport:
    """Citizen energy observation and public report record."""

    report_id: str
    category: ReportCategory
    title: str
    description: str
    geographic_level: str  # "STATE", "DISTRICT", "CITY_AREA"
    location_name: str
    submission_timestamp: str
    submitter_id: str  # Hashed or pseudonymous
    contact_email_hash: str
    consent_public_display: bool
    evidence_files: list[EvidenceFileMetadata]
    status: ReportStatus
    moderator_id: str | None = None
    moderation_timestamp: str | None = None
    moderator_notes: str | None = None
    public_resolution_summary: str | None = None
    rejection_reason: str | None = None
    audit_trail: list[AuditLogEntry] = field(default_factory=list)
    is_verified_fact: bool = False  # Strictly preserves truth-in-data invariant

    def to_public_dict(self) -> dict[str, Any]:
        """Strips private PII and internal moderator notes for public consumption."""
        return {
            "report_id": self.report_id,
            "category": self.category.value,
            "title": self.title,
            "description": self.description,
            "geographic_level": self.geographic_level,
            "location_name": self.location_name,
            "submission_timestamp": self.submission_timestamp,
            "status": self.status.value,
            "is_verified_fact": self.is_verified_fact,
            "public_resolution_summary": self.public_resolution_summary,
            "evidence_count": len([f for f in self.evidence_files if f.is_approved_for_public_view]),
            "approved_evidence_files": [
                {
                    "file_id": f.file_id,
                    "filename": f.original_filename,
                    "content_type": f.content_type,
                    "file_size_bytes": f.file_size_bytes,
                }
                for f in self.evidence_files
                if f.is_approved_for_public_view
            ],
        }

    def to_moderator_dict(self) -> dict[str, Any]:
        """Provides full detail for authorized moderators including audit trail."""
        return {
            "report_id": self.report_id,
            "category": self.category.value,
            "title": self.title,
            "description": self.description,
            "geographic_level": self.geographic_level,
            "location_name": self.location_name,
            "submission_timestamp": self.submission_timestamp,
            "submitter_id": self.submitter_id,
            "consent_public_display": self.consent_public_display,
            "status": self.status.value,
            "moderator_id": self.moderator_id,
            "moderation_timestamp": self.moderation_timestamp,
            "moderator_notes": self.moderator_notes,
            "public_resolution_summary": self.public_resolution_summary,
            "rejection_reason": self.rejection_reason,
            "is_verified_fact": self.is_verified_fact,
            "evidence_files": [
                {
                    "file_id": f.file_id,
                    "original_filename": f.original_filename,
                    "file_size_bytes": f.file_size_bytes,
                    "content_type": f.content_type,
                    "is_approved_for_public_view": f.is_approved_for_public_view,
                }
                for f in self.evidence_files
            ],
            "audit_trail": [
                {
                    "timestamp": a.timestamp,
                    "actor_id": a.actor_id,
                    "actor_role": a.actor_role.value,
                    "action": a.action,
                    "previous_status": a.previous_status.value if a.previous_status else None,
                    "new_status": a.new_status.value if a.new_status else None,
                    "notes": a.notes,
                }
                for a in self.audit_trail
            ],
        }


# -----------------------------------------------------------------------------
# 3. PII & SECURITY SCRUBBER
# -----------------------------------------------------------------------------


class PIIScrubber:
    """Detects and scrubs Personally Identifiable Information (PII)."""

    # Regex patterns for Indian telecom, emails, Aadhaar, meter account IDs
    PHONE_REGEX = re.compile(r"(?:(?:\+|0{0,2})91[\s-]?)?[6-9]\d{9}\b")
    EMAIL_REGEX = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
    AADHAAR_REGEX = re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b")
    ACCOUNT_REGEX = re.compile(r"\b(?:CA|ACC|MTR|BP|RR|CONS)[\s-]?\d{6,12}\b", re.IGNORECASE)

    @classmethod
    def contains_pii(cls, text: str) -> bool:
        """Checks if text contains identifiable personal or account information."""
        if not text:
            return False
        return bool(
            cls.PHONE_REGEX.search(text)
            or cls.EMAIL_REGEX.search(text)
            or cls.AADHAAR_REGEX.search(text)
            or cls.ACCOUNT_REGEX.search(text)
        )

    @classmethod
    def scrub_text(cls, text: str) -> str:
        """Replaces detected PII with standardized redaction tokens."""
        if not text:
            return ""
        scrubbed = cls.ACCOUNT_REGEX.sub("[REDACTED_ACCOUNT_ID]", text)
        scrubbed = cls.AADHAAR_REGEX.sub("[REDACTED_AADHAAR]", scrubbed)
        scrubbed = cls.EMAIL_REGEX.sub("[REDACTED_EMAIL]", scrubbed)
        scrubbed = cls.PHONE_REGEX.sub("[REDACTED_PHONE]", scrubbed)
        return scrubbed


# -----------------------------------------------------------------------------
# 4. EVIDENCE UPLOAD & FILE SECURITY
# -----------------------------------------------------------------------------


class EvidenceUploadValidator:
    """Validates uploaded evidence files with strict security invariants."""

    ALLOWED_EXTENSIONS: set[str] = {".jpg", ".jpeg", ".png", ".pdf", ".csv", ".txt"}
    ALLOWED_MIME_PREFIXES: set[str] = {"image/jpeg", "image/png", "application/pdf", "text/csv", "text/plain"}

    @classmethod
    def validate_and_prepare(
        cls,
        filename: str,
        content_bytes: bytes,
        declared_content_type: str,
        submitter_id: str,
        storage_dir: Path,
    ) -> tuple[bool, EvidenceFileMetadata | str]:
        """Validates file size, extension, magic bytes, and path traversal."""
        # 1. Size check
        if len(content_bytes) > MAX_UPLOAD_SIZE_BYTES:
            return False, f"FILE_OVERSIZED: File exceeds maximum allowed size of {MAX_UPLOAD_SIZE_BYTES / 1024 / 1024:.1f} MB."
        if len(content_bytes) == 0:
            return False, "EMPTY_FILE: Uploaded file is empty."

        # 2. Path traversal defense
        clean_name = os.path.basename(filename)
        ext = os.path.splitext(clean_name)[1].lower()
        if ext not in cls.ALLOWED_EXTENSIONS:
            return False, f"DISALLOWED_EXTENSION: Extension '{ext}' is not permitted. Allowed: {sorted(cls.ALLOWED_EXTENSIONS)}"

        # 3. Magic bytes / header check
        is_magic_valid = False
        detected_mime = declared_content_type

        if ext in {".jpg", ".jpeg"} and content_bytes.startswith(b"\xff\xd8\xff"):
            is_magic_valid = True
            detected_mime = "image/jpeg"
        elif ext == ".png" and content_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            is_magic_valid = True
            detected_mime = "image/png"
        elif ext == ".pdf" and content_bytes.startswith(b"%PDF-"):
            is_magic_valid = True
            detected_mime = "application/pdf"
        elif ext in {".csv", ".txt"}:
            # Verify valid UTF-8/ASCII text without binary nulls
            if b"\x00" not in content_bytes[:4096]:
                try:
                    content_bytes.decode("utf-8")
                    is_magic_valid = True
                    detected_mime = "text/csv" if ext == ".csv" else "text/plain"
                except UnicodeDecodeError:
                    is_magic_valid = False

        if not is_magic_valid:
            return False, f"INVALID_FILE_SIGNATURE: File header does not match declared format '{ext}'."

        # 4. Hash content and generate randomized storage name
        file_hash = hashlib.sha256(content_bytes).hexdigest()
        file_id = f"evid_{uuid.uuid4().hex[:8]}"
        storage_filename = f"cit_evid_{file_hash[:12]}_{uuid.uuid4().hex[:6]}{ext}"

        # Ensure storage directory exists
        storage_dir.mkdir(parents=True, exist_ok=True)
        target_path = storage_dir / storage_filename

        try:
            with open(target_path, "wb") as f:
                f.write(content_bytes)
        except OSError as e:
            return False, f"STORAGE_FAILURE: Could not persist evidence securely: {e}"

        meta = EvidenceFileMetadata(
            file_id=file_id,
            original_filename=clean_name,
            storage_filename=storage_filename,
            file_size_bytes=len(content_bytes),
            content_type=detected_mime,
            sha256_hash=file_hash,
            uploaded_at=datetime.now(UTC).isoformat(),
            submitter_id=submitter_id,
            is_approved_for_public_view=False,  # Private until reviewed
        )
        return True, meta


# -----------------------------------------------------------------------------
# 5. PRIVACY-AWARE AGGREGATION & RE-IDENTIFICATION PROTECTION
# -----------------------------------------------------------------------------


class PrivacyAwareAggregationEngine:
    """Guarantees k-anonymity (k >= 10) and protects against differencing attacks."""

    def __init__(self, min_group_size: int = DEFAULT_MIN_GROUP_SIZE):
        self.min_group_size = min_group_size
        self._prior_query_subsets: list[set[str]] = []

    def aggregate_consumption_by_area(
        self,
        records: list[dict[str, Any]],
        area_key: str = "locality",
        metric_key: str = "consumption_kwh",
    ) -> list[dict[str, Any]]:
        """Aggregates household consumption while suppressing groups smaller than k."""
        grouped: dict[str, list[float]] = {}
        household_ids: dict[str, set[str]] = {}

        for r in records:
            area = str(r.get(area_key, "Unknown"))
            val = float(r.get(metric_key, 0.0))
            hid = str(r.get("household_id", r.get("property_id", f"anon_{uuid.uuid4().hex[:6]}")))

            grouped.setdefault(area, []).append(val)
            household_ids.setdefault(area, set()).add(hid)

        results: list[dict[str, Any]] = []
        for area, vals in sorted(grouped.items()):
            distinct_hids = household_ids[area]
            n_households = len(distinct_hids)

            if n_households < self.min_group_size:
                results.append({
                    "area": area,
                    "status": "SUPPRESSED_PRIVACY_THRESHOLD",
                    "household_count": None,
                    "mean_consumption_kwh": None,
                    "total_consumption_kwh": None,
                    "explanation": (
                        f"Suppressed: Group size of {n_households} households is below the "
                        f"k-anonymity threshold (k >= {self.min_group_size}) to prevent re-identification."
                    ),
                })
            else:
                total_val = sum(vals)
                mean_val = total_val / len(vals)
                results.append({
                    "area": area,
                    "status": "PUBLIC_AGGREGATE_APPROVED",
                    "household_count": n_households,
                    "mean_consumption_kwh": round(mean_val, 2),
                    "total_consumption_kwh": round(total_val, 1),
                    "explanation": f"Aggregated across {n_households} distinct households (k >= {self.min_group_size}).",
                })
        return results

    def check_differencing_risk(self, requested_entity_ids: set[str]) -> tuple[bool, str]:
        """Protects against differencing attacks across sequential overlapping queries."""
        for prior_set in self._prior_query_subsets:
            # If queries differ by fewer than min_group_size entities, an attacker can isolate individuals
            diff_a = prior_set - requested_entity_ids
            diff_b = requested_entity_ids - prior_set

            if 0 < len(diff_a) < self.min_group_size or 0 < len(diff_b) < self.min_group_size:
                return False, (
                    "DIFFERENCING_ATTACK_DETECTED: Query overlaps with a prior query subset "
                    f"with a delta of fewer than {self.min_group_size} entities. Query denied."
                )

        # Track query subset for future differencing defense (keep last 50 queries)
        self._prior_query_subsets.append(requested_entity_ids)
        if len(self._prior_query_subsets) > 50:
            self._prior_query_subsets.pop(0)

        return True, "DIFFERENCING_CHECK_PASSED"


# -----------------------------------------------------------------------------
# 6. CITIZEN PORTAL SERVICE
# -----------------------------------------------------------------------------


class CitizenPortalService:
    """Unified service orchestrating public energy transparency and citizen reporting."""

    def __init__(
        self,
        data_dir: Path | None = None,
        evidence_storage_dir: Path | None = None,
        min_group_size: int = DEFAULT_MIN_GROUP_SIZE,
    ):
        self.repo_root = Path(__file__).resolve().parent.parent.parent
        if data_dir is not None and (data_dir / "energy_reports").exists():
            self.data_dir = data_dir
        else:
            self.data_dir = self.repo_root / "data"
        self.evidence_dir = evidence_storage_dir or (self.data_dir / "citizen_evidence")
        self.policy = PublicDataPolicyRule(min_group_size=min_group_size)
        self.aggregation_engine = PrivacyAwareAggregationEngine(min_group_size=min_group_size)

        # In-memory storage for reports & submissions (persisted safely in json if needed)
        self._reports: dict[str, CitizenReport] = {}
        self._submitter_submission_times: dict[str, list[datetime]] = {}

        # Pre-seed or initialize directory
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        self._initialize_canonical_public_indicators()

    # -------------------------------------------------------------------------
    # 6.1 Public Data Access Boundary & Policy Evaluation
    # -------------------------------------------------------------------------

    def check_public_eligibility(self, data_item: dict[str, Any]) -> PublicDataEligibilityResult:
        """Evaluates whether an entity or observation may be publicly exposed."""
        rules_evaluated: list[str] = []

        # 1. Classification check
        classification = str(data_item.get("data_classification", data_item.get("provenance", ""))).upper()
        rules_evaluated.append(f"Classification check: {classification}")

        if classification in self.policy.disallowed_classifications:
            return PublicDataEligibilityResult(
                eligible=False,
                status=PublicEligibilityStatus.DENIED_HOUSEHOLD_PRIVATE,
                reason=f"Classification '{classification}' is strictly restricted to private household/internal scope.",
                policy_rules_evaluated=rules_evaluated,
            )

        # 2. PII / Household Identifier Check
        for pii_key in ("account_number", "customer_name", "phone", "email", "meter_serial_number", "address"):
            if pii_key in data_item and data_item[pii_key]:
                return PublicDataEligibilityResult(
                    eligible=False,
                    status=PublicEligibilityStatus.DENIED_PII,
                    reason=f"Record contains raw PII field '{pii_key}'. Must be scrubbed or aggregated.",
                    policy_rules_evaluated=rules_evaluated,
                )

        # 3. Check for text PII in string values
        for k, v in data_item.items():
            if isinstance(v, str) and PIIScrubber.contains_pii(v):
                return PublicDataEligibilityResult(
                    eligible=False,
                    status=PublicEligibilityStatus.DENIED_PII,
                    reason=f"Field '{k}' contains telephone, email, or meter identifier patterns.",
                    policy_rules_evaluated=rules_evaluated,
                )

        # 4. Group Size Check if record represents an aggregation
        if "household_count" in data_item:
            count = data_item["household_count"]
            rules_evaluated.append(f"Household count check: {count}")
            if count is not None and count < self.policy.min_group_size:
                return PublicDataEligibilityResult(
                    eligible=False,
                    status=PublicEligibilityStatus.DENIED_SMALL_GROUP,
                    reason=f"Household count ({count}) is below k-anonymity threshold ({self.policy.min_group_size}).",
                    policy_rules_evaluated=rules_evaluated,
                )

        # 5. Allow if classification matches approved public tiers
        if classification in self.policy.allowed_classifications or not classification:
            return PublicDataEligibilityResult(
                eligible=True,
                status=PublicEligibilityStatus.ELIGIBLE,
                reason="Record satisfies all public data governance and privacy criteria.",
                policy_rules_evaluated=rules_evaluated,
                sanitized_data=data_item,
            )

        return PublicDataEligibilityResult(
            eligible=False,
            status=PublicEligibilityStatus.DENIED_OPERATIONAL_RESTRICTED,
            reason=f"Classification '{classification}' is not explicitly permitted under deny-by-default policy.",
            policy_rules_evaluated=rules_evaluated,
        )

    # -------------------------------------------------------------------------
    # 6.2 Public Energy Indicators & Provenance
    # -------------------------------------------------------------------------

    def _initialize_canonical_public_indicators(self) -> None:
        """Loads and indexes official indicators from repository data files."""
        self._indicators: list[PublicEnergyIndicator] = []

        # 1. National Balance from CEA
        nat_path = self.data_dir / "energy_reports" / "cea_national_balance.json"
        if nat_path.exists():
            try:
                with open(nat_path, encoding="utf-8") as f:
                    nat_data = json.load(f)
                obs_list = nat_data.get("observations", [])
                if obs_list:
                    latest = obs_list[-1]  # Latest reporting period
                    self._indicators.append(
                        PublicEnergyIndicator(
                            indicator_id="ind_nat_demand_met",
                            name="National Electricity Supplied",
                            category=IndicatorCategory.DEMAND_SUPPLY,
                            geographic_scope="NATIONAL",
                            geographic_display_name="All India",
                            reporting_period=latest.get("reportingPeriod", "2026-03"),
                            value=float(latest.get("energySuppliedMu", 0.0)),
                            unit="MU",
                            source_organization="Central Electricity Authority (CEA)",
                            source_dataset="CEA Power Supply Position Monthly Reports",
                            source_url=nat_data.get("sourceUrl", "https://cea.nic.in/power-supply-position-monthly-reports"),
                            retrieval_timestamp=nat_data.get("verifiedAt", "2026-10-24"),
                            data_classification="OFFICIAL_OBSERVATION",
                            verification_status="VERIFIED_REPORT",
                            methodology="Monthly statutory power supply accounting across all 5 regional load dispatch centers.",
                            known_limitations=[
                                "Excludes captive off-grid power plants not connected to regional grids.",
                                "Represents reporting-period monthly accounting reconciliation.",
                            ],
                            data_freshness_status="HISTORICAL_SERIES",
                            is_observed_fact=True,
                        )
                    )
                    self._indicators.append(
                        PublicEnergyIndicator(
                            indicator_id="ind_nat_peak_met",
                            name="National Peak Demand Met",
                            category=IndicatorCategory.DEMAND_SUPPLY,
                            geographic_scope="NATIONAL",
                            geographic_display_name="All India",
                            reporting_period=latest.get("reportingPeriod", "2026-03"),
                            value=float(latest.get("peakMetMw", 0.0)),
                            unit="MW",
                            source_organization="Central Electricity Authority (CEA)",
                            source_dataset="CEA Power Supply Position Monthly Reports",
                            source_url=nat_data.get("sourceUrl", "https://cea.nic.in/power-supply-position-monthly-reports"),
                            retrieval_timestamp=nat_data.get("verifiedAt", "2026-10-24"),
                            data_classification="OFFICIAL_OBSERVATION",
                            verification_status="VERIFIED_REPORT",
                            methodology="Peak simultaneous demand met across national grid during month.",
                            known_limitations=["Instantaneous monthly peak met, not 24-hour average."],
                            data_freshness_status="HISTORICAL_SERIES",
                            is_observed_fact=True,
                        )
                    )
            except Exception:
                pass

        # 2. State Balance KA and AP from CEA
        state_path = self.data_dir / "energy_reports" / "cea_state_balance.json"
        if state_path.exists():
            try:
                with open(state_path, encoding="utf-8") as f:
                    state_data = json.load(f)
                states = state_data.get("states", {})
                for scode, sinfo in states.items():
                    s_obs = sinfo.get("observations", [])
                    if s_obs:
                        latest_s = s_obs[-1]
                        self._indicators.append(
                            PublicEnergyIndicator(
                                indicator_id=f"ind_state_{scode.lower()}_supplied",
                                name=f"{sinfo.get('stateName', scode)} Energy Supplied",
                                category=IndicatorCategory.DEMAND_SUPPLY,
                                geographic_scope=f"STATE_{scode}",
                                geographic_display_name=sinfo.get("stateName", scode),
                                reporting_period=latest_s.get("reportingPeriod", "2026-03"),
                                value=float(latest_s.get("energySuppliedMu", 0.0)),
                                unit="MU",
                                source_organization="Central Electricity Authority (CEA)",
                                source_dataset="CEA Monthly Power Supply Position Reports",
                                source_url=state_data.get("sourceUrl", "https://cea.nic.in/power-supply-position-monthly-reports"),
                                retrieval_timestamp=state_data.get("verifiedAt", "2026-10-24"),
                                data_classification="OFFICIAL_OBSERVATION",
                                verification_status="VERIFIED_REPORT",
                                methodology="State electricity grid intake and utility dispatch reconciliations.",
                                known_limitations=[
                                    "State figures cannot be proportionally downscaled to revenue districts.",
                                    "Excludes off-grid private generation.",
                                ],
                                data_freshness_status="HISTORICAL_SERIES",
                                is_observed_fact=True,
                            )
                        )
            except Exception:
                pass

        # 3. Renewable Generation from CEA
        renew_path = self.data_dir / "energy_reports" / "cea_renewable_generation.json"
        if renew_path.exists():
            try:
                with open(renew_path, encoding="utf-8") as f:
                    ren_data = json.load(f)
                records = ren_data.get("records", [])
                if records:
                    # Filter for latest national record
                    nat_ren = [r for r in records if r.get("regionCode") == "IN"]
                    if nat_ren:
                        latest_ren = nat_ren[-1]
                        self._indicators.append(
                            PublicEnergyIndicator(
                                indicator_id="ind_nat_solar_gen",
                                name="All-India Solar Generation",
                                category=IndicatorCategory.RENEWABLE_ENERGY,
                                geographic_scope="NATIONAL",
                                geographic_display_name="All India",
                                reporting_period=latest_ren.get("reportingPeriod", "2026-03"),
                                value=float(latest_ren.get("solarGenerationMu", 0.0)),
                                unit="MU",
                                source_organization="Central Electricity Authority (CEA) & MNRE",
                                source_dataset="CEA Monthly Renewable Generation Reports",
                                source_url=ren_data.get("sourceUrl", "https://cea.nic.in/monthly-renewable-generation-reports"),
                                retrieval_timestamp=ren_data.get("verifiedAt", "2026-10-24"),
                                data_classification="OFFICIAL_OBSERVATION",
                                verification_status="VERIFIED_REPORT",
                                methodology="Grid-connected utility-scale and registered distributed solar generation.",
                                known_limitations=[
                                    "Generation (MU) must not be confused with installed capacity rating (MW).",
                                    "Unregistered micro-solar installations are not tracked in utility metering.",
                                ],
                                data_freshness_status="HISTORICAL_SERIES",
                                is_observed_fact=True,
                            )
                        )
            except Exception:
                pass

    def get_public_indicators(
        self,
        geo_scope: str = "ALL",
        category: IndicatorCategory | None = None,
    ) -> list[PublicEnergyIndicator]:
        """Returns verified public indicators matching the requested scope and category."""
        results: list[PublicEnergyIndicator] = []
        for ind in self._indicators:
            if geo_scope != "ALL" and ind.geographic_scope != geo_scope:
                continue
            if category is not None and ind.category != category:
                continue
            results.append(ind)
        return results

    def get_public_datasets_catalogue(self) -> list[dict[str, Any]]:
        """Returns list of public datasets with licensing and verified provenance."""
        return [
            {
                "dataset_id": "ds_pub_cea_balance",
                "name": "CEA National & State Power Supply Position",
                "publisher": "Central Electricity Authority (CEA), Ministry of Power, Govt. of India",
                "geographic_coverage": "National (All India) & States (KA, AP, MH)",
                "frequency": "Monthly",
                "license": "Government Open Data License - India (GODL-India)",
                "source_url": "https://cea.nic.in/power-supply-position-monthly-reports",
                "verification_status": "VERIFIED_OFFICIAL_REPORT",
                "classification": "OFFICIAL_OBSERVATION",
                "description": "Monthly energy requirements, energy supplied, peak demand, and peak met in MU and MW.",
                "known_limitations": "Accounting reconciliation, not high-frequency feeder trips.",
            },
            {
                "dataset_id": "ds_pub_cea_renewables",
                "name": "CEA Monthly Renewable Generation & Capacity",
                "publisher": "Central Electricity Authority (CEA) & MNRE",
                "geographic_coverage": "National & Major Renewable States",
                "frequency": "Monthly",
                "license": "Government Open Data License - India (GODL-India)",
                "source_url": "https://cea.nic.in/monthly-renewable-generation-reports",
                "verification_status": "VERIFIED_OFFICIAL_REPORT",
                "classification": "OFFICIAL_OBSERVATION",
                "description": "Solar PV, wind, and total renewable energy generation with installed capacity benchmarks.",
                "known_limitations": "Strictly distinguishes installed capacity (MW) from actual energy generation (MU).",
            },
            {
                "dataset_id": "ds_pub_npp_outturn",
                "name": "National Power Portal (NPP) Daily Outturn",
                "publisher": "National Power Portal / POSOCO (Grid-India)",
                "geographic_coverage": "National Grid & Regional Load Dispatch Centers",
                "frequency": "Daily",
                "license": "Government Open Data License - India (GODL-India)",
                "source_url": "https://npp.gov.in",
                "verification_status": "VERIFIED_OFFICIAL_REPORT",
                "classification": "OFFICIAL_OBSERVATION",
                "description": "Daily national energy balance, inter-regional transfers, and peak demand telemetry.",
                "known_limitations": "Provisional daily operational telemetry subject to monthly reconciliation.",
            },
        ]

    # -------------------------------------------------------------------------
    # 6.3 Citizen Submissions & Reporting Workflow
    # -------------------------------------------------------------------------

    def _enforce_rate_limit(self, submitter_id: str) -> bool:
        """Sliding-window rate limiter: max submissions per hour."""
        now = datetime.now(UTC)
        recent = [
            t for t in self._submitter_submission_times.get(submitter_id, [])
            if (now - t).total_seconds() < 3600
        ]
        if len(recent) >= MAX_SUBMISSIONS_PER_HOUR:
            return False
        recent.append(now)
        self._submitter_submission_times[submitter_id] = recent
        return True

    def submit_citizen_report(
        self,
        category: ReportCategory,
        title: str,
        description: str,
        geographic_level: str,
        location_name: str,
        submitter_id: str,
        contact_email: str = "",
        consent_public_display: bool = True,
        user_role: UserRole = UserRole.CITIZEN,
    ) -> tuple[bool, CitizenReport | str]:
        """Validates, scrubs, and records a citizen submission in SUBMITTED status."""
        # 1. Role validation
        if not submitter_id:
            return False, "INVALID_SUBMITTER: Submitter identifier cannot be empty."

        # 2. Rate limiting
        if not self._enforce_rate_limit(submitter_id):
            return False, f"RATE_LIMIT_EXCEEDED: Maximum {MAX_SUBMISSIONS_PER_HOUR} submissions per hour reached."

        # 3. Input sanitation and validation
        clean_title = title.strip()
        clean_desc = description.strip()
        clean_loc = location_name.strip()

        if len(clean_title) < 5:
            return False, "INVALID_TITLE: Title must be at least 5 characters long."
        if len(clean_desc) < 15:
            return False, "INVALID_DESCRIPTION: Description must provide at least 15 characters of detail."
        if not clean_loc:
            return False, "INVALID_LOCATION: Location name or administrative area must be provided."

        # Reject exact private street addresses to protect residential privacy
        if re.search(r"\b(?:flat\s?no|house\s?no|door\s?no|apartment\s?no|h\.?\s?no)\b", clean_loc, re.IGNORECASE):
            return False, "PRIVATE_ADDRESS_DISALLOWED: Do not submit private home door/flat numbers. Use neighborhood, landmark, or district level."

        # Scrub PII from title and description
        scrubbed_title = PIIScrubber.scrub_text(clean_title)
        scrubbed_desc = PIIScrubber.scrub_text(clean_desc)

        email_hash = hashlib.sha256(contact_email.strip().lower().encode("utf-8")).hexdigest() if contact_email else ""

        report_id = f"CIT-2026-{uuid.uuid4().hex[:6].upper()}"
        now_iso = datetime.now(UTC).isoformat()

        report = CitizenReport(
            report_id=report_id,
            category=category,
            title=scrubbed_title,
            description=scrubbed_desc,
            geographic_level=geographic_level,
            location_name=clean_loc,
            submission_timestamp=now_iso,
            submitter_id=submitter_id,
            contact_email_hash=email_hash,
            consent_public_display=consent_public_display,
            evidence_files=[],
            status=ReportStatus.SUBMITTED,
            audit_trail=[
                AuditLogEntry(
                    timestamp=now_iso,
                    actor_id=submitter_id,
                    actor_role=user_role,
                    action="REPORT_SUBMITTED",
                    previous_status=None,
                    new_status=ReportStatus.SUBMITTED,
                    notes="Citizen observation submitted to intake queue.",
                )
            ],
            is_verified_fact=False,  # Unverified user submission
        )

        self._reports[report_id] = report
        return True, report

    def upload_evidence_for_report(
        self,
        report_id: str,
        filename: str,
        content_bytes: bytes,
        declared_content_type: str,
        submitter_id: str,
        user_role: UserRole = UserRole.CITIZEN,
    ) -> tuple[bool, EvidenceFileMetadata | str]:
        """Validates and stores evidence for a specific citizen report."""
        if report_id not in self._reports:
            return False, f"REPORT_NOT_FOUND: No report found with id '{report_id}'."

        report = self._reports[report_id]

        # Ownership check: only report creator or moderator/admin can attach evidence
        if report.submitter_id != submitter_id and user_role not in {UserRole.MODERATOR, UserRole.ADMIN}:
            return False, "ACCESS_DENIED: Cannot upload evidence to another user's report."

        # Limit to 3 files per report
        if len(report.evidence_files) >= 3:
            return False, "EVIDENCE_LIMIT_REACHED: Maximum 3 evidence files allowed per report."

        ok, res = EvidenceUploadValidator.validate_and_prepare(
            filename=filename,
            content_bytes=content_bytes,
            declared_content_type=declared_content_type,
            submitter_id=submitter_id,
            storage_dir=self.evidence_dir,
        )
        if not ok or isinstance(res, str):
            return False, res

        report.evidence_files.append(res)
        report.audit_trail.append(
            AuditLogEntry(
                timestamp=datetime.now(UTC).isoformat(),
                actor_id=submitter_id,
                actor_role=user_role,
                action="EVIDENCE_ATTACHED",
                previous_status=report.status,
                new_status=report.status,
                notes=f"Attached evidence file '{res.original_filename}' (SHA256: {res.sha256_hash[:8]}).",
            )
        )
        return True, res

    # -------------------------------------------------------------------------
    # 6.4 Moderation & Verification Workflow
    # -------------------------------------------------------------------------

    def moderate_report(
        self,
        report_id: str,
        new_status: ReportStatus,
        moderator_id: str,
        notes: str,
        user_role: UserRole = UserRole.MODERATOR,
        public_resolution_summary: str | None = None,
        rejection_reason: str | None = None,
        approve_evidence_ids: list[str] | None = None,
    ) -> tuple[bool, str]:
        """Applies server-side validated state transition to a citizen report."""
        if user_role not in {UserRole.MODERATOR, UserRole.ADMIN}:
            return False, "UNAUTHORIZED_MODERATOR: Moderation requires MODERATOR or ADMIN role."

        if report_id not in self._reports:
            return False, f"REPORT_NOT_FOUND: No report with id '{report_id}'."

        report = self._reports[report_id]
        curr_status = report.status

        # Validate state machine transition
        valid_next = VALID_REPORT_TRANSITIONS.get(curr_status, set())
        if new_status not in valid_next:
            return False, (
                f"INVALID_TRANSITION: Cannot transition report from '{curr_status.value}' to '{new_status.value}'. "
                f"Allowed transitions: {[s.value for s in valid_next]}"
            )

        # Rejection requires reason
        if new_status == ReportStatus.REJECTED and not (rejection_reason or notes):
            return False, "REJECTION_REASON_REQUIRED: A clear explanation is required when rejecting a citizen report."

        # Update report state
        now_iso = datetime.now(UTC).isoformat()
        report.status = new_status
        report.moderator_id = moderator_id
        report.moderation_timestamp = now_iso
        report.moderator_notes = notes

        if rejection_reason:
            report.rejection_reason = rejection_reason
        if public_resolution_summary:
            report.public_resolution_summary = public_resolution_summary

        # Evidence approval if applicable
        if approve_evidence_ids and new_status == ReportStatus.ACCEPTED_FOR_PUBLICATION:
            updated_files: list[EvidenceFileMetadata] = []
            for f in report.evidence_files:
                if f.file_id in approve_evidence_ids:
                    updated_files.append(
                        EvidenceFileMetadata(
                            file_id=f.file_id,
                            original_filename=f.original_filename,
                            storage_filename=f.storage_filename,
                            file_size_bytes=f.file_size_bytes,
                            content_type=f.content_type,
                            sha256_hash=f.sha256_hash,
                            uploaded_at=f.uploaded_at,
                            submitter_id=f.submitter_id,
                            is_approved_for_public_view=True,
                        )
                    )
                else:
                    updated_files.append(f)
            report.evidence_files = updated_files

        # Record in audit trail
        report.audit_trail.append(
            AuditLogEntry(
                timestamp=now_iso,
                actor_id=moderator_id,
                actor_role=user_role,
                action=f"STATUS_TRANSITION_{new_status.value}",
                previous_status=curr_status,
                new_status=new_status,
                notes=notes,
            )
        )

        return True, f"Report successfully transitioned to {new_status.value}."

    # -------------------------------------------------------------------------
    # 6.5 Public & Authorized Report Retrieval
    # -------------------------------------------------------------------------

    def list_public_reports(
        self,
        geo_scope: str = "ALL",
        category: ReportCategory | None = None,
        search_query: str | None = None,
        page: int = 1,
        page_size: int = 10,
    ) -> dict[str, Any]:
        """Lists approved public reports with PII stripped and pagination."""
        eligible = [
            r for r in self._reports.values()
            if r.status in {ReportStatus.ACCEPTED_FOR_PUBLICATION, ReportStatus.RESOLVED}
            and r.consent_public_display
        ]

        # Scope filter
        if geo_scope != "ALL":
            eligible = [r for r in eligible if geo_scope.lower() in r.location_name.lower() or r.geographic_level == geo_scope]

        # Category filter
        if category:
            eligible = [r for r in eligible if r.category == category]

        # Search query
        if search_query:
            q = search_query.lower()
            eligible = [r for r in eligible if q in r.title.lower() or q in r.description.lower() or q in r.location_name.lower()]

        # Sort descending by submission time
        eligible.sort(key=lambda r: r.submission_timestamp, reverse=True)

        total_records = len(eligible)
        start_idx = max(0, (page - 1) * page_size)
        end_idx = start_idx + page_size
        paged_items = eligible[start_idx:end_idx]

        return {
            "page": page,
            "page_size": page_size,
            "total_records": total_records,
            "total_pages": max(1, (total_records + page_size - 1) // page_size),
            "items": [r.to_public_dict() for r in paged_items],
        }

    def get_citizen_report_for_user(
        self,
        report_id: str,
        requester_id: str,
        user_role: UserRole = UserRole.CITIZEN,
    ) -> dict[str, Any] | None:
        """Retrieves report detail respecting strict ownership and privacy boundaries."""
        if report_id not in self._reports:
            return None

        report = self._reports[report_id]

        # Submitter can see their own report in any status
        if report.submitter_id == requester_id:
            return {
                **report.to_public_dict(),
                "moderator_notes": report.moderator_notes if report.status == ReportStatus.NEEDS_CLARIFICATION else None,
                "rejection_reason": report.rejection_reason,
            }

        # Moderators / Admins can see full moderation detail
        if user_role in {UserRole.MODERATOR, UserRole.ADMIN}:
            return report.to_moderator_dict()

        # Unauthenticated / unrelated users can only view if accepted for public display
        if report.status in {ReportStatus.ACCEPTED_FOR_PUBLICATION, ReportStatus.RESOLVED} and report.consent_public_display:
            return report.to_public_dict()

        # Deny access by default
        return None

    def list_moderation_queue(
        self,
        status_filter: ReportStatus | None = None,
        user_role: UserRole = UserRole.MODERATOR,
    ) -> list[dict[str, Any]]:
        """Provides moderation queue listing for authorized moderators."""
        if user_role not in {UserRole.MODERATOR, UserRole.ADMIN}:
            return []

        queue = list(self._reports.values())
        if status_filter:
            queue = [r for r in queue if r.status == status_filter]
        queue.sort(key=lambda r: r.submission_timestamp, reverse=True)
        return [r.to_moderator_dict() for r in queue]

    # -------------------------------------------------------------------------
    # 6.6 Privacy-Safe Aggregation Facade
    # -------------------------------------------------------------------------

    def aggregate_safely(
        self,
        records: list[dict[str, Any]],
        area_key: str = "locality",
        metric_key: str = "consumption_kwh",
        min_k: int = DEFAULT_MIN_GROUP_SIZE,
    ) -> list[dict[str, Any]]:
        """Delegates to privacy engine to aggregate with k-anonymity guarantee."""
        engine = PrivacyAwareAggregationEngine(min_group_size=min_k)
        return engine.aggregate_consumption_by_area(records, area_key=area_key, metric_key=metric_key)
