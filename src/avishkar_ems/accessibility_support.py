"""Accessibility, Usability & Operational Support Engine for UrjaSetu EMS (Phase 23).

Delivers comprehensive WCAG 2.2 AA engineering support, usability enhancements, and production support:
1. Standardized Diagnostic Error Taxonomy with UUID correlation IDs, safe user messaging, and PII redaction.
2. Multi-Modal Status Badges: Strictly enforces that status is NEVER communicated by color alone.
   Combines unambiguous text labels, accessible Unicode status icons, and screen-reader descriptors.
3. Plain-Language Energy Terminology Glossary & Contextual Explainer.
4. Accessible Tabular Data Alternative Generator for charts and spatial visualizations.
5. Anti-Duplicate Submission / Debounce Guard for idempotent state mutations.
6. Responsive Layout Breakpoints & Table Reflow Helpers.
"""

from __future__ import annotations

import html
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from avishkar_ems.trust.operational_safety import SecretRedactor

# -----------------------------------------------------------------------------
# 1. DIAGNOSTIC ERROR TAXONOMY & CORRELATION IDS
# -----------------------------------------------------------------------------


class ErrorCategory(StrEnum):
    AUTHENTICATION_AUTHORIZATION = "AUTHENTICATION_AUTHORIZATION"
    INPUT_VALIDATION = "INPUT_VALIDATION"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    SIMULATION_BOUNDARY = "SIMULATION_BOUNDARY"
    EXTERNAL_DATA_PROVIDER = "EXTERNAL_DATA_PROVIDER"
    DATABASE_INTEGRITY = "DATABASE_INTEGRITY"
    SYSTEM_DEGRADED = "SYSTEM_DEGRADED"
    UNEXPECTED_INTERNAL = "UNEXPECTED_INTERNAL"


@dataclass(frozen=True)
class DiagnosticErrorRecord:
    """Structured, safe, and supportable error descriptor with correlation ID."""

    error_code: str
    correlation_id: str
    category: ErrorCategory
    safe_user_message: str
    technical_detail_redacted: str
    suggested_action: str
    support_reference_url: str
    timestamp: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {
            "error_code": self.error_code,
            "correlation_id": self.correlation_id,
            "category": self.category.value,
            "safe_user_message": self.safe_user_message,
            "technical_detail_redacted": self.technical_detail_redacted,
            "suggested_action": self.suggested_action,
            "support_reference_url": self.support_reference_url,
            "timestamp": self.timestamp,
        }

    def format_accessible_alert(self) -> str:
        """Formats an accessible markdown/plain-text alert with clear actionable next steps."""
        return (
            f"⚠️ **Error [{self.error_code}]:** {self.safe_user_message}\n\n"
            f"**Suggested Action:** {self.suggested_action}\n\n"
            f"*(Support Reference: `{self.correlation_id}` | Help: {self.support_reference_url})*"
        )


class DiagnosticErrorRegistry:
    """Factory and registry for consistent, sanitized diagnostic error reports."""

    # Canonical error catalog
    ERROR_CATALOG: dict[str, tuple[ErrorCategory, str, str, str]] = {
        "ERR_AUTH_UNAUTHORIZED": (
            ErrorCategory.AUTHENTICATION_AUTHORIZATION,
            "You do not have permission to access or modify this property.",
            "Verify that you are signed in with the correct account.",
            "/docs/help#access-control",
        ),
        "ERR_AUTH_SESSION_EXPIRED": (
            ErrorCategory.AUTHENTICATION_AUTHORIZATION,
            "Your authenticated session has expired.",
            "Please sign in again to continue your session.",
            "/docs/help#login",
        ),
        "ERR_TARIFF_NOT_FOUND": (
            ErrorCategory.RESOURCE_NOT_FOUND,
            "The requested electricity tariff schedule is not recognized in the registry.",
            "Select an approved gazetted tariff schedule from the dropdown.",
            "/docs/help#tariffs",
        ),
        "ERR_PROPERTY_NOT_FOUND": (
            ErrorCategory.RESOURCE_NOT_FOUND,
            "The requested household or property profile does not exist.",
            "Confirm the property ID or select a property from your registered list.",
            "/docs/help#properties",
        ),
        "ERR_INVALID_FILE_TYPE": (
            ErrorCategory.INPUT_VALIDATION,
            "The uploaded file format is not supported.",
            "Please upload a supported format (.pdf, .csv, .xlsx, .png, .jpg).",
            "/docs/help#bill-upload",
        ),
        "ERR_PAYLOAD_VALIDATION_FAILED": (
            ErrorCategory.INPUT_VALIDATION,
            "One or more form fields contain invalid or incomplete values.",
            "Review the highlighted fields, correct the errors, and try submitting again.",
            "/docs/help#forms",
        ),
        "ERR_NEGATIVE_CONSUMPTION": (
            ErrorCategory.INPUT_VALIDATION,
            "Consumption units (kWh) cannot be negative.",
            "Enter a valid positive consumption figure.",
            "/docs/help#meter-readings",
        ),
        "ERR_SIMULATION_BOUNDARY_EXCEEDED": (
            ErrorCategory.SIMULATION_BOUNDARY,
            "Simulation parameters exceed physical engineering limits.",
            "Adjust inputs within the recommended ranges (e.g., solar capacity up to 50 kWp).",
            "/docs/help#digital-twin",
        ),
        "ERR_CONNECTOR_TIMEOUT": (
            ErrorCategory.EXTERNAL_DATA_PROVIDER,
            "An external data provider took too long to respond.",
            "UrjaSetu is displaying verified cached telemetry. Try refreshing in a few minutes.",
            "/docs/help#data-freshness",
        ),
        "ERR_SERVICE_DEGRADED": (
            ErrorCategory.SYSTEM_DEGRADED,
            "The service is operating in degraded mode due to upstream telemetry latency.",
            "Cached estimates remain available; real-time sync will resume automatically.",
            "/docs/help#system-status",
        ),
    }

    @classmethod
    def create(
        cls,
        error_code: str,
        technical_detail: str = "",
        custom_user_message: str | None = None,
        correlation_id: str | None = None,
    ) -> DiagnosticErrorRecord:
        """Creates a sanitized diagnostic error with a unique correlation ID."""
        corr_id = correlation_id or f"corr_{uuid.uuid4().hex[:10]}"

        if error_code in cls.ERROR_CATALOG:
            cat, default_msg, action, doc_url = cls.ERROR_CATALOG[error_code]
        else:
            cat = ErrorCategory.UNEXPECTED_INTERNAL
            default_msg = "An unexpected error occurred while processing your request."
            action = "Please try again later or contact operational support with the reference ID."
            doc_url = "/docs/help#troubleshooting"

        safe_msg = custom_user_message or default_msg

        # Ensure no sensitive tokens, credentials, or PII leak into technical details
        sanitized_detail = SecretRedactor.redact_string(technical_detail)
        # Scrub explicit password, secret, and api key assignments in strings
        sanitized_detail = re.sub(
            r'(?i)(password|passwd|pwd|secret|api[_-]?key)\s*=\s*(["\'])(.*?)\2',
            r'\1="***REDACTED***"',
            sanitized_detail,
        )
        sanitized_detail = re.sub(
            r"(?i)(password|passwd|pwd|secret|api[_-]?key)\s*=\s*([^\s;,&]+)",
            r"\1=***REDACTED***",
            sanitized_detail,
        )
        # Strip potential stack traces or raw SQL patterns
        sanitized_detail = re.sub(r'File ".*?", line \d+, in .*', "[internal stack frame redacted]", sanitized_detail)

        return DiagnosticErrorRecord(
            error_code=error_code,
            correlation_id=corr_id,
            category=cat,
            safe_user_message=safe_msg,
            technical_detail_redacted=sanitized_detail,
            suggested_action=action,
            support_reference_url=doc_url,
        )


# -----------------------------------------------------------------------------
# 2. MULTI-MODAL STATUS INDICATORS (NEVER COLOR ALONE)
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class StatusIndicator:
    """Encapsulates a multi-modal status indicator adhering strictly to WCAG 2.2 AA (1.4.1)."""

    status_code: str
    label: str
    symbol: str
    accessible_description: str
    tone: str  # Semantic color tone token

    def format_badge_text(self) -> str:
        """Returns non-color text badge format: '[ICON] Label'."""
        return f"{self.symbol} {self.label}"

    def format_accessible_html(self) -> str:
        """Returns WCAG compliant HTML with screen-reader text."""
        return (
            f'<span class="status-badge" data-tone="{self.tone}" role="status">'
            f'<span aria-hidden="true">{self.symbol}</span> '
            f'<span class="status-label">{html.escape(self.label)}</span> '
            f'<span class="sr-only">({html.escape(self.accessible_description)})</span>'
            f"</span>"
        )


class MultiModalStatusRegistry:
    """Registry providing multi-modal (icon + text + role) status representations."""

    STATUS_MAP: dict[str, StatusIndicator] = {
        # Operational States
        "HEALTHY": StatusIndicator("HEALTHY", "Healthy", "✅", "Operational and within freshness threshold", "live"),
        "DELAYED_STALE": StatusIndicator("DELAYED_STALE", "Delayed / Stale", "⚠️", "Data is older than standard threshold; cached value active", "updated"),
        "DEGRADED": StatusIndicator("DEGRADED", "Degraded", "⚡", "Operating with intermittent telemetry errors or high latency", "estimated"),
        "FAILED": StatusIndicator("FAILED", "Failed", "❌", "Connector transport failed or unreachable", "unavailable"),
        "NOT_CONFIGURED": StatusIndicator("NOT_CONFIGURED", "Not Configured", "⚙️", "Configuration or credentials missing", "reference"),
        "ACCESS_RESTRICTED": StatusIndicator("ACCESS_RESTRICTED", "Restricted", "🔒", "Requires DISCOM MOU or OAuth credential", "reference"),
        # Alert Severities
        "CRITICAL": StatusIndicator("CRITICAL", "Critical Severity", "⛔", "Immediate operational attention required", "unavailable"),
        "HIGH": StatusIndicator("HIGH", "High Severity", "⚠️", "Significant variance requiring operator verification", "updated"),
        "MEDIUM": StatusIndicator("MEDIUM", "Medium Severity", "ℹ️", "Informational advisory notice", "forecast"),
        "LOW": StatusIndicator("LOW", "Low Severity", "◽", "Minor telemetry variance", "reference"),
        # Alert Lifecycles
        "OPEN": StatusIndicator("OPEN", "Open Alert", "🔴", "New alert pending acknowledgment", "unavailable"),
        "ACKNOWLEDGED": StatusIndicator("ACKNOWLEDGED", "Acknowledged", "🟡", "Under review by operator", "updated"),
        "RESOLVED": StatusIndicator("RESOLVED", "Resolved", "🟢", "Variance reconciled or resolved", "live"),
        # Data Provenance Tiers
        "MEASURED": StatusIndicator("MEASURED", "Measured", "📊", "Direct physical meter or telemetry observation", "live"),
        "IMPORTED": StatusIndicator("IMPORTED", "Imported", "📥", "Sourced from verified official DISCOM billing statement", "updated"),
        "USER_SUPPLIED": StatusIndicator("USER_SUPPLIED", "User-Supplied", "👤", "Declared by consumer without AMR meter verification", "estimated"),
        "DERIVED": StatusIndicator("DERIVED", "Derived", "🧮", "Computed via mathematical energy models", "forecast"),
        "ASSUMED": StatusIndicator("ASSUMED", "Assumed", "📐", "Engineering simulation assumption", "simulated"),
        # Verification Statuses
        "VALIDATED": StatusIndicator("VALIDATED", "Validated", "✓", "Mathematically reconciled against tariff order", "live"),
        "DISCREPANCY": StatusIndicator("DISCREPANCY", "Variance Detected", "≠", "Calculation differs from utility invoice", "updated"),
        "UNVERIFIED": StatusIndicator("UNVERIFIED", "Unverified", "?", "Awaiting official billing statement reconciliation", "reference"),
    }

    @classmethod
    def get(cls, status_key: str) -> StatusIndicator:
        """Retrieves indicator; falls back gracefully to a neutral textual indicator."""
        clean_key = str(status_key).strip().upper()
        if clean_key in cls.STATUS_MAP:
            return cls.STATUS_MAP[clean_key]
        return StatusIndicator(
            status_code=clean_key,
            label=clean_key.replace("_", " ").title(),
            symbol="•",
            accessible_description=f"Status: {clean_key}",
            tone="reference",
        )


# -----------------------------------------------------------------------------
# 3. PLAIN-LANGUAGE ENERGY TERMINOLOGY GLOSSARY
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class GlossaryEntry:
    term: str
    abbreviation: str | None
    plain_explanation: str
    consumer_example: str
    technical_nuance: str
    category: str  # "METRICS", "TARIFFS", "SOLAR", "PHYSICS", "POLICY"

    def format_accessible_card(self) -> str:
        abbr_text = f" ({self.abbreviation})" if self.abbreviation else ""
        return (
            f"### 📖 {self.term}{abbr_text}\n\n"
            f"**In Plain Language:** {self.plain_explanation}\n\n"
            f"**Real-World Example:** {self.consumer_example}\n\n"
            f"*(Technical Specification: {self.technical_nuance} | Category: {self.category})*"
        )


class EnergyGlossary:
    """Authoritative glossary providing accessible, clear explanations of domain terminology."""

    ENTRIES: dict[str, GlossaryEntry] = {
        "kwh": GlossaryEntry(
            term="Kilowatt-hour",
            abbreviation="kWh",
            plain_explanation="The fundamental unit of electricity consumption. One kilowatt-hour equals using 1,000 watts of power continuously for one full hour.",
            consumer_example="Running a 1,000-watt electric iron for 1 hour or a 100-watt television for 10 hours uses exactly 1 kWh (1 unit).",
            technical_nuance="1 kWh = 3.6 Megajoules (MJ). Electricity bills are billed on a per-kWh (per-unit) basis.",
            category="METRICS",
        ),
        "kw": GlossaryEntry(
            term="Kilowatt (Power / Connected Load)",
            abbreviation="kW",
            plain_explanation="The rate at which electricity is being consumed at any single instant. It measures demand capacity, not total consumption over time.",
            consumer_example="Turning on two 1.5-ton air conditioners simultaneously demands about 3.0 kW of electric power instantly.",
            technical_nuance="1 kW = 1,000 Watts = 1,000 Joules/second. Determines the sanctioned demand charge on your monthly bill.",
            category="METRICS",
        ),
        "peak_demand": GlossaryEntry(
            term="Peak Demand",
            abbreviation="kW (Max)",
            plain_explanation="The highest instantaneous electrical load recorded by your meter during any 15-minute window in a billing cycle.",
            consumer_example="If your household simultaneously runs an electric water heater, oven, and air conditioner, your peak demand spikes for that hour.",
            technical_nuance="Exceeding sanctioned load triggers utility penalties (penal demand charges) under DISCOM regulations.",
            category="METRICS",
        ),
        "tariff_slab": GlossaryEntry(
            term="Telescopic Tariff Slab",
            abbreviation="Slab",
            plain_explanation="A progressive pricing system where electricity rates increase in tiers as you use more power during the month.",
            consumer_example="Under BESCOM LT-2(a), your first 100 units cost ₹4.75 each; every unit above 100 costs ₹7.00 each.",
            technical_nuance="Telescopic slabs bill only incremental units at the higher rate, preserving lower rates for baseline consumption.",
            category="TARIFFS",
        ),
        "time_of_use": GlossaryEntry(
            term="Time-of-Use Tariff",
            abbreviation="ToU / ToD",
            plain_explanation="Electricity pricing that varies by time of day, making power cheaper during solar/night hours and dearer during evening peak hours.",
            consumer_example="Shifting washing machine usage from 7 PM (evening peak) to 11 AM (solar off-peak) lowers energy costs.",
            technical_nuance="Reflects the marginal cost of grid dispatch during daily peak ramp hours (typically 18:00–22:00 in India).",
            category="TARIFFS",
        ),
        "pm_surya_ghar": GlossaryEntry(
            term="PM Surya Ghar CFA Subsidy",
            abbreviation="CFA",
            plain_explanation="Direct financial assistance provided by the Central Government (MNRE) to subsidize residential rooftop solar installation costs.",
            consumer_example="A 2 kWp residential solar system receives a ₹60,000 direct subsidy; a 3 kWp or larger system receives ₹78,000.",
            technical_nuance=r"Statutory Central Financial Assistance under MNRE 2024 guidelines capped at ₹78,000 for systems $\ge 3$ kWp.",
            category="POLICY",
        ),
        "cuf": GlossaryEntry(
            term="Capacity Utilization Factor",
            abbreviation="CUF",
            plain_explanation="The ratio of actual solar electricity generated over a period compared to the maximum possible generation if the system operated at full power 24/7.",
            consumer_example="In South India, a good rooftop solar system achieves a monthly CUF of 18% to 22% due to nighttime and weather.",
            technical_nuance="CUF = (Total Generation in kWh) / (Installed Capacity in kW $\times$ Total Hours in Period).",
            category="SOLAR",
        ),
        "carbon_factor": GlossaryEntry(
            term="Grid Emissions Factor",
            abbreviation="kg CO2 / kWh",
            plain_explanation="The amount of carbon dioxide emitted into the atmosphere to produce one kilowatt-hour of grid electricity in India.",
            consumer_example="Consuming 100 kWh of grid electricity generates about 71.6 kg of carbon emissions.",
            technical_nuance="Statutory weighted average factor of 0.716 kg CO2/kWh from Central Electricity Authority (CEA) Baseline Database v19.",
            category="PHYSICS",
        ),
        "data_freshness": GlossaryEntry(
            term="Data Freshness & Provenance",
            abbreviation="Provenance",
            plain_explanation="Transparent labeling of where every data point originated (real meter, utility invoice, satellite, or simulation) and how recently it was recorded.",
            consumer_example="A reading marked 'MEASURED (T-1h)' comes from your smart meter 1 hour ago; a reading marked 'ESTIMATED' is derived mathematically.",
            technical_nuance="Enforces distinction between transport timestamp (API fetch) and physical observation timestamp.",
            category="POLICY",
        ),
    }

    @classmethod
    def get(cls, term_key: str) -> GlossaryEntry | None:
        key = term_key.lower().replace("-", "_").replace(" ", "_")
        return cls.ENTRIES.get(key)

    @classmethod
    def search(cls, query: str) -> list[GlossaryEntry]:
        q = query.lower()
        results: list[GlossaryEntry] = []
        for e in cls.ENTRIES.values():
            if (
                q in e.term.lower()
                or (e.abbreviation and q in e.abbreviation.lower())
                or q in e.plain_explanation.lower()
                or q in e.category.lower()
            ):
                results.append(e)
        return results


# -----------------------------------------------------------------------------
# 4. ACCESSIBLE TABULAR DATA ALTERNATIVES FOR CHARTS
# -----------------------------------------------------------------------------


class AccessibleTableGenerator:
    """Transforms graphical chart series into screen-reader accessible Markdown & HTML tables."""

    @staticmethod
    def generate_markdown_table(
        title: str,
        time_column_name: str,
        value_column_name: str,
        timestamps: list[str],
        values: list[float],
        unit: str = "kWh",
        provenance_label: str = "MEASURED",
    ) -> str:
        """Constructs an accessible Markdown table with explicit headers and summary caption."""
        if not timestamps or not values or len(timestamps) != len(values):
            return "*No data points available to construct tabular alternative.*"

        rows = [
            f"### 📋 Tabular Data Alternative: {title}",
            f"*Screen reader accessible presentation of chart data ({provenance_label}). Total intervals: {len(timestamps)}.*",
            "",
            f"| {time_column_name} | {value_column_name} ({unit}) | Data Provenance |",
            "| :--- | :--- | :--- |",
        ]

        for t, v in zip(timestamps, values, strict=True):
            rows.append(f"| {t} | {v:,.2f} | {provenance_label} |")

        return "\n".join(rows)


# -----------------------------------------------------------------------------
# 5. ANTI-DUPLICATE SUBMISSION & DEBOUNCE GUARD
# -----------------------------------------------------------------------------


class AntiDuplicateGuard:
    """Maintains short-lived session locks preventing accidental double-click / double-submission."""

    def __init__(self, debounce_window_seconds: float = 2.0) -> None:
        self.debounce_window = debounce_window_seconds
        self._action_locks: dict[str, float] = {}

    def try_acquire(self, action_key: str, user_id: str = "default_user") -> bool:
        """Returns True if the action is permitted; False if locked by a recent submission."""
        now = time.time()
        composite_key = f"{user_id}:{action_key}"

        # Clean old locks
        self._cleanup(now)

        last_time = self._action_locks.get(composite_key)
        if last_time is not None and (now - last_time) < self.debounce_window:
            return False

        self._action_locks[composite_key] = now
        return True

    def _cleanup(self, now: float) -> None:
        # Prune keys older than 3x debounce window
        cutoff = now - (self.debounce_window * 3.0)
        self._action_locks = {k: v for k, v in self._action_locks.items() if v > cutoff}
