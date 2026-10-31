"""UrjaSetu EMS Energy Data Trust, Validation, and Source Intelligence Engine.

Provides the foundational trust layer for all electricity, solar, and household
observations, calculations, forecasts, and geographical models.
"""

from __future__ import annotations

from avishkar_ems.trust.canonical_observation import (
    CanonicalObservation,
    DataClassification,
    MeasurementKind,
    QualityStatus,
)
from avishkar_ems.trust.conflict_resolver import (
    ConflictReport,
    ConflictResolver,
    ConflictSeverity,
)
from avishkar_ems.trust.connectors import (
    ApEnergyConnector,
    BaseEnergyConnector,
    BescomHistoricalConnector,
    CeaConnector,
    ConnectorHealthReport,
    DiscomConnector,
    ImportSummary,
    NasaPowerConnector,
    NppGenerationConnector,
    OpenMeteoSolarConnector,
)
from avishkar_ems.trust.data_quality import (
    DataQualityValidator,
    IngestionBatchSummary,
    RuleOutcome,
    ValidationRuleResult,
)
from avishkar_ems.trust.freshness_engine import (
    FreshnessEngine,
    FreshnessEvaluation,
    FreshnessStatus,
)
from avishkar_ems.trust.geo_integrity import (
    AntiDisaggregationGuard,
    CanonicalEntityCatalog,
    CanonicalGeoEntity,
    CoverageMatrixChecker,
    GeoAliasResolver,
    GeoLevel,
)
from avishkar_ems.trust.idempotent_ingestion import (
    IdempotentIngestionEngine,
    IngestionAction,
    IngestionResult,
    VersionedObservationRecord,
    generate_composite_key,
)
from avishkar_ems.trust.ingestion_scheduler import (
    IngestionScheduler,
    ScheduledJobConfig,
)
from avishkar_ems.trust.operational_safety import (
    RateLimiter,
    RetryPolicy,
    SchemaDriftDetector,
    SecretRedactor,
    StructuredAuditLogger,
    execute_with_resilience,
)
from avishkar_ems.trust.provenance_classifier import (
    CalculatedStatisticLineage,
    ForecastLineage,
    ProvenanceAuditor,
)
from avishkar_ems.trust.source_registry import (
    AccessMethod,
    ConnectionStatus,
    GeographicCoverage,
    MetricCoverage,
    ReportingCadence,
    SourceRecord,
    SourceRegistry,
)
from avishkar_ems.trust.unit_validation import (
    UNIT_REGISTRY,
    UnitCategory,
    UnitDefinition,
    UnitValidator,
    convert_power_to_energy,
    convert_units,
    validate_solar_share_denominator,
)

__version__ = "1.0.0"

__all__ = [
    "UNIT_REGISTRY",
    "AccessMethod",
    "AntiDisaggregationGuard",
    "ApEnergyConnector",
    "BaseEnergyConnector",
    "BescomHistoricalConnector",
    "CalculatedStatisticLineage",
    "CanonicalEntityCatalog",
    "CanonicalGeoEntity",
    "CanonicalObservation",
    "CeaConnector",
    "ConflictReport",
    "ConflictResolver",
    "ConflictSeverity",
    "ConnectionStatus",
    "ConnectorHealthReport",
    "CoverageMatrixChecker",
    "DataClassification",
    "DataQualityValidator",
    "DiscomConnector",
    "ForecastLineage",
    "FreshnessEngine",
    "FreshnessEvaluation",
    "FreshnessStatus",
    "GeoAliasResolver",
    "GeoLevel",
    "GeographicCoverage",
    "IdempotentIngestionEngine",
    "ImportSummary",
    "IngestionAction",
    "IngestionBatchSummary",
    "IngestionResult",
    "IngestionScheduler",
    "MeasurementKind",
    "MetricCoverage",
    "NasaPowerConnector",
    "NppGenerationConnector",
    "OpenMeteoSolarConnector",
    "ProvenanceAuditor",
    "QualityStatus",
    "RateLimiter",
    "ReportingCadence",
    "RetryPolicy",
    "RuleOutcome",
    "ScheduledJobConfig",
    "SchemaDriftDetector",
    "SecretRedactor",
    "SourceRecord",
    "SourceRegistry",
    "StructuredAuditLogger",
    "UnitCategory",
    "UnitDefinition",
    "UnitValidator",
    "ValidationRuleResult",
    "VersionedObservationRecord",
    "convert_power_to_energy",
    "convert_units",
    "execute_with_resilience",
    "generate_composite_key",
    "validate_solar_share_denominator",
]
