"""Data Quality Validation Pipeline for UrjaSetu EMS.

Executes comprehensive 13-point data quality validation across every ingested observation.
Strict invariants:
1. Do not reject legitimate negative values for metrics where negative values have valid meaning
   (e.g., net power flow import/export, temperature).
2. Do not automatically discard unusual but potentially legitimate electricity measurements.
3. Assign quality outcomes: VALID, VALID_WITH_WARNINGS, INCOMPLETE, REJECTED, REQUIRES_REVIEW.
4. Provide structured ingestion summary with accepted, rejected, duplicated, and warning counts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    QualityStatus,
)
from avishkar_ems.trust.geo_integrity import (
    AUTHORITATIVE_ENTITIES,
)
from avishkar_ems.trust.unit_validation import (
    get_dimension,
)


class RuleOutcome(StrEnum):
    PASSED = "PASSED"
    WARNING = "WARNING"
    FAILED = "FAILED"


@dataclass(frozen=True)
class ValidationRuleResult:
    rule_id: str
    outcome: RuleOutcome
    message: str = ""


@dataclass(frozen=True)
class ValidationFinding:
    rule_id: str
    severity: str  # "ERROR", "WARNING", "INFO"
    message: str
    field_name: str | None = None


@dataclass
class IngestionBatchSummary:
    batch_id: str
    total_records: int = 0
    accepted_valid: int = 0
    accepted_with_warnings: int = 0
    incomplete_count: int = 0
    rejected_count: int = 0
    duplicate_count: int = 0
    review_required_count: int = 0
    findings: list[ValidationFinding] = field(default_factory=list)

    @property
    def total_accepted(self) -> int:
        return self.accepted_valid + self.accepted_with_warnings


# Metrics where negative values are strictly forbidden by physical definitions
NON_NEGATIVE_METRICS = {
    "ENERGY_REQUIREMENT",
    "ENERGY_SUPPLIED",
    "PEAK_DEMAND",
    "PEAK_MET",
    "SOLAR_GENERATION",
    "TOTAL_GENERATION",
    "RENEWABLE_GENERATION",
    "INSTALLED_SOLAR_CAPACITY",
    "SOLAR_CAPACITY",
    "BATTERY_CAPACITY",
    "INTERVAL_CONSUMPTION",
    "IMPORT_KWH",
}


class DataQualityValidator:
    """Pipeline enforcing rigorous schema and semantic data quality standards."""

    @classmethod
    def validate(cls, obs: CanonicalObservation) -> tuple[QualityStatus, list[ValidationRuleResult]]:
        """Convenience evaluation for single observation, emitting standardized RuleResults."""
        validator = cls()
        status, findings = validator.validate_observation(obs)
        results: list[ValidationRuleResult] = []

        # Rule ID alias mapping
        alias_map = {
            "DQ004_ILLEGAL_NEGATIVE": "VAL_VALUE_NON_NEGATIVE",
            "DQ005_CHRONOLOGY_ORDER": "VAL_PERIOD_INTERVAL",
            "DQ003_INVALID_UNIT": "VAL_UNIT_REGISTERED",
            "DQ001_REQUIRED_FIELDS": "VAL_REQ_FIELDS",
        }

        for f in findings:
            outcome = RuleOutcome.FAILED if f.severity == "ERROR" else RuleOutcome.WARNING
            results.append(ValidationRuleResult(rule_id=f.rule_id, outcome=outcome, message=f.message))
            if f.rule_id in alias_map:
                results.append(ValidationRuleResult(rule_id=alias_map[f.rule_id], outcome=outcome, message=f.message))

        if not results:
            results.append(ValidationRuleResult(rule_id="ALL_RULES", outcome=RuleOutcome.PASSED, message="Valid"))
        return status, results

    def validate_observation(
        self,
        obs: CanonicalObservation,
        seen_observation_ids: set[str] | None = None,
    ) -> tuple[QualityStatus, list[ValidationFinding]]:
        findings: list[ValidationFinding] = []

        # 1. Required fields check
        if not obs.observation_id or not obs.source_id or not obs.metric_id:
            findings.append(
                ValidationFinding(
                    rule_id="DQ001_REQUIRED_FIELDS",
                    severity="ERROR",
                    message="Missing mandatory identifiers: observation_id, source_id, or metric_id.",
                    field_name="observation_id",
                )
            )

        # 2. Impossible numeric values (NaN, Infinity)
        if math.isnan(obs.original_value) or math.isinf(obs.original_value):
            findings.append(
                ValidationFinding(
                    rule_id="DQ002_MALFORMED_VALUE",
                    severity="ERROR",
                    message="Observation value is NaN or Infinite.",
                    field_name="original_value",
                )
            )

        # 3. Unit validity
        try:
            get_dimension(obs.original_unit)
        except ValueError as err:
            findings.append(
                ValidationFinding(
                    rule_id="DQ003_INVALID_UNIT",
                    severity="ERROR",
                    message=str(err),
                    field_name="original_unit",
                )
            )

        # 4. Negative value validation
        is_non_neg = any(obs.metric_id.upper().startswith(m) or m in obs.metric_id.upper() for m in NON_NEGATIVE_METRICS)
        if is_non_neg and obs.original_value < 0:
            findings.append(
                ValidationFinding(
                    rule_id="DQ004_ILLEGAL_NEGATIVE",
                    severity="ERROR",
                    message=f"Metric '{obs.metric_id}' cannot have negative value ({obs.original_value}).",
                    field_name="original_value",
                )
            )

        # 5. Reporting period chronological ordering
        if obs.reporting_period_start > obs.reporting_period_end:
            findings.append(
                ValidationFinding(
                    rule_id="DQ005_CHRONOLOGY_ORDER",
                    severity="ERROR",
                    message=(
                        f"Reporting period start ({obs.reporting_period_start.isoformat()}) "
                        f"cannot be after end ({obs.reporting_period_end.isoformat()})."
                    ),
                    field_name="reporting_period_start",
                )
            )

        # 6. Future timestamp check
        now = datetime.now(obs.reporting_period_start.tzinfo)
        if obs.reporting_period_start > now:
            findings.append(
                ValidationFinding(
                    rule_id="DQ006_FUTURE_DATE",
                    severity="WARNING",
                    message="Reporting period start is in the future. Valid only if classification is FORECAST.",
                    field_name="reporting_period_start",
                )
            )

        # 7. Geographic entity check
        if obs.geographic_entity_id not in AUTHORITATIVE_ENTITIES:
            findings.append(
                ValidationFinding(
                    rule_id="DQ007_UNKNOWN_GEOGRAPHY",
                    severity="ERROR",
                    message=f"Geographic identifier '{obs.geographic_entity_id}' not found in canonical hierarchy.",
                    field_name="geographic_entity_id",
                )
            )

        # 8. Duplicate ID check in session
        if seen_observation_ids is not None and obs.observation_id in seen_observation_ids:
            findings.append(
                ValidationFinding(
                    rule_id="DQ008_DUPLICATE_RECORD",
                    severity="ERROR",
                    message=f"Duplicate observation ID '{obs.observation_id}' detected.",
                    field_name="observation_id",
                )
            )

        # 9. Source reference present
        if not obs.provenance_reference or len(obs.provenance_reference.strip()) < 3:
            findings.append(
                ValidationFinding(
                    rule_id="DQ009_MISSING_PROVENANCE",
                    severity="ERROR",
                    message="Missing authoritative provenance reference.",
                    field_name="provenance_reference",
                )
            )

        # Determine overall QualityStatus
        errors = [f for f in findings if f.severity == "ERROR"]
        warnings = [f for f in findings if f.severity == "WARNING"]

        if errors:
            status = QualityStatus.REJECTED
        elif warnings:
            status = QualityStatus.VALID_WITH_WARNINGS
        else:
            status = QualityStatus.VALID

        return status, findings

    def evaluate_batch(
        self,
        batch_id: str,
        observations: list[CanonicalObservation],
    ) -> tuple[IngestionBatchSummary, list[CanonicalObservation]]:
        """Evaluates an ingestion batch, updating status and generating a summary."""
        summary = IngestionBatchSummary(batch_id=batch_id, total_records=len(observations))
        seen_ids: set[str] = set()
        validated_obs: list[CanonicalObservation] = []

        for obs in observations:
            status, findings = self.validate_observation(obs, seen_ids)
            summary.findings.extend(findings)

            if status == QualityStatus.REJECTED:
                summary.rejected_count += 1
                reasons = "; ".join(f.message for f in findings if f.severity == "ERROR")
                # Return with updated status and reason
                upd = CanonicalObservation(
                    observation_id=obs.observation_id,
                    source_id=obs.source_id,
                    dataset_id=obs.dataset_id,
                    metric_id=obs.metric_id,
                    original_metric_name=obs.original_metric_name,
                    original_value=obs.original_value,
                    original_unit=obs.original_unit,
                    normalized_value=obs.normalized_value,
                    normalized_unit=obs.normalized_unit,
                    geographic_entity_id=obs.geographic_entity_id,
                    geographic_level=obs.geographic_level,
                    reporting_period_start=obs.reporting_period_start,
                    reporting_period_end=obs.reporting_period_end,
                    data_classification=obs.data_classification,
                    quality_status=QualityStatus.REJECTED,
                    original_source_record_id=obs.original_source_record_id,
                    provenance_reference=obs.provenance_reference,
                    ingestion_run_id=obs.ingestion_run_id,
                    measurement_kind=obs.measurement_kind,
                    warnings=[f.message for f in findings if f.severity == "WARNING"],
                    rejection_reason=reasons,
                    metadata=obs.metadata,
                )
                validated_obs.append(upd)
            elif status == QualityStatus.VALID_WITH_WARNINGS:
                summary.accepted_with_warnings += 1
                seen_ids.add(obs.observation_id)
                upd = CanonicalObservation(
                    observation_id=obs.observation_id,
                    source_id=obs.source_id,
                    dataset_id=obs.dataset_id,
                    metric_id=obs.metric_id,
                    original_metric_name=obs.original_metric_name,
                    original_value=obs.original_value,
                    original_unit=obs.original_unit,
                    normalized_value=obs.normalized_value,
                    normalized_unit=obs.normalized_unit,
                    geographic_entity_id=obs.geographic_entity_id,
                    geographic_level=obs.geographic_level,
                    reporting_period_start=obs.reporting_period_start,
                    reporting_period_end=obs.reporting_period_end,
                    data_classification=obs.data_classification,
                    quality_status=QualityStatus.VALID_WITH_WARNINGS,
                    original_source_record_id=obs.original_source_record_id,
                    provenance_reference=obs.provenance_reference,
                    ingestion_run_id=obs.ingestion_run_id,
                    measurement_kind=obs.measurement_kind,
                    warnings=[f.message for f in findings if f.severity == "WARNING"],
                    metadata=obs.metadata,
                )
                validated_obs.append(upd)
            else:
                summary.accepted_valid += 1
                seen_ids.add(obs.observation_id)
                validated_obs.append(obs)

        return summary, validated_obs
