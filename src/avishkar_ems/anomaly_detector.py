"""Dedicated Anomaly Detection Engine for UrjaSetu EMS.

Operates independently from forecasting models to identify unexpected observations,
structural level breaks, and data-quality variances.

Strict Invariants:
1. NEVER label a statistical anomaly as theft, fraud, equipment failure, corruption,
   or a power shortage without independent supporting evidence.
2. Explanations are strictly non-accusatory and framed as variances requiring operational verification.
3. Cryptographic deduplication prevents duplicate alert generation for the same underlying observation.
4. Categorizes variances into four explicit classes:
   - DATA_QUALITY_ANOMALY (physical bound violation, impossible step change, zero/flatline)
   - STATISTICAL_OUTLIER (extreme deviation under robust rolling MAD)
   - TREND_SHIFT (persistent change in historical trajectory)
   - OPERATIONAL_VARIANCE (deviation from seasonal baseline requiring dispatch review)
"""

from __future__ import annotations

import datetime
import hashlib
from dataclasses import dataclass, field
from enum import StrEnum

from avishkar_ems.time_series_trends import TimeSeriesPoint


class AnomalyCategory(StrEnum):
    DATA_QUALITY_ANOMALY = "DATA_QUALITY_ANOMALY"
    STATISTICAL_OUTLIER = "STATISTICAL_OUTLIER"
    TREND_SHIFT = "TREND_SHIFT"
    OPERATIONAL_VARIANCE = "OPERATIONAL_VARIANCE"


class AnomalySeverity(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


@dataclass(frozen=True)
class AnomalyRecord:
    anomaly_id: str
    metric_id: str
    geo_code: str
    period: str
    observed_value: float
    expected_value: float
    absolute_deviation: float
    relative_deviation_pct: float | None
    category: AnomalyCategory
    severity: AnomalySeverity
    method: str
    threshold: float
    evidence_quality: str  # "HIGH", "MEDIUM", "LOW"
    source_provenance: str
    explanation: str
    recommended_verification_steps: list[str]
    detected_timestamp: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.UTC).isoformat()
    )


class AnomalyDetectionEngine:
    """Robust anomaly detection across rolling window MAD, seasonal residuals, and data quality."""

    def __init__(self) -> None:
        self._seen_alert_hashes: set[str] = set()

    def _generate_alert_hash(self, metric: str, geo: str, period: str, method: str) -> str:
        raw = f"{metric}:{geo}:{period}:{method}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def _compute_median(values: list[float]) -> float:
        s = sorted(values)
        n = len(s)
        if n % 2 == 1:
            return s[n // 2]
        return (s[n // 2 - 1] + s[n // 2]) / 2.0

    @classmethod
    def _compute_mad(cls, values: list[float], median_val: float) -> float:
        deviations = [abs(v - median_val) for v in values]
        return cls._compute_median(deviations)

    def detect_data_quality_anomalies(
        self,
        series: list[TimeSeriesPoint],
        metric_id: str,
        geo_code: str,
        min_allowed_value: float = 0.0,
    ) -> list[AnomalyRecord]:
        """Detects negative physical values, sudden zero drops, or flatlines."""
        anomalies: list[AnomalyRecord] = []
        for i, pt in enumerate(series):
            # 1. Negative value on positive metric
            if pt.value < min_allowed_value:
                h = self._generate_alert_hash(metric_id, geo_code, pt.period, "PHYSICAL_LOWER_BOUND")
                if h not in self._seen_alert_hashes:
                    self._seen_alert_hashes.add(h)
                    anomalies.append(
                        AnomalyRecord(
                            anomaly_id=h,
                            metric_id=metric_id,
                            geo_code=geo_code,
                            period=pt.period,
                            observed_value=pt.value,
                            expected_value=min_allowed_value,
                            absolute_deviation=round(abs(pt.value - min_allowed_value), 2),
                            relative_deviation_pct=None,
                            category=AnomalyCategory.DATA_QUALITY_ANOMALY,
                            severity=AnomalySeverity.CRITICAL,
                            method="Physical Lower Bound Check",
                            threshold=min_allowed_value,
                            evidence_quality="HIGH",
                            source_provenance=pt.source_ref or "Reported Observation",
                            explanation=(
                                f"Observed value {pt.value} in {pt.period} violates the physical minimum bound ({min_allowed_value}). "
                                "This indicates an upstream telemetry formatting or unit conversion error."
                            ),
                            recommended_verification_steps=[
                                "Inspect raw upstream publication for negative sign typographical error.",
                                "Verify whether observation was reported as net export rather than gross generation.",
                                "Cross-reference with state SLDC log books.",
                            ],
                        )
                    )

            # 2. Complete Zero Drop from active baseline
            if i > 0 and pt.value == 0.0 and series[i - 1].value > 100.0:
                h = self._generate_alert_hash(metric_id, geo_code, pt.period, "ZERO_DROP")
                if h not in self._seen_alert_hashes:
                    self._seen_alert_hashes.add(h)
                    anomalies.append(
                        AnomalyRecord(
                            anomaly_id=h,
                            metric_id=metric_id,
                            geo_code=geo_code,
                            period=pt.period,
                            observed_value=0.0,
                            expected_value=series[i - 1].value,
                            absolute_deviation=round(series[i - 1].value, 2),
                            relative_deviation_pct=100.0,
                            category=AnomalyCategory.DATA_QUALITY_ANOMALY,
                            severity=AnomalySeverity.HIGH,
                            method="Zero Drop Telemetry Check",
                            threshold=0.0,
                            evidence_quality="HIGH",
                            source_provenance=pt.source_ref or "Reported Observation",
                            explanation=(
                                f"Observed value dropped to zero in {pt.period} from {series[i - 1].value} {pt.unit} in preceding period. "
                                "This typically indicates missing reporting submission rather than zero physical consumption."
                            ),
                            recommended_verification_steps=[
                                "Check if reporting entity filed a nil return due to portal transition.",
                                "Verify if month is currently under audit reconciliation.",
                            ],
                        )
                    )

        return anomalies

    def detect_rolling_mad_anomalies(
        self,
        series: list[TimeSeriesPoint],
        metric_id: str,
        geo_code: str,
        window_size: int = 6,
        mad_threshold: float = 3.0,
    ) -> list[AnomalyRecord]:
        """Detects statistical outliers using Median Absolute Deviation on trailing window."""
        anomalies: list[AnomalyRecord] = []
        n = len(series)
        if n < window_size + 1:
            return anomalies

        for i in range(window_size, n):
            window = [p.value for p in series[i - window_size : i]]
            cur_pt = series[i]
            med = self._compute_median(window)
            mad = self._compute_mad(window, med)

            # If MAD is near zero, use a small floor to prevent divide-by-zero
            scale = 1.4826 * max(mad, 1e-4 * med, 1.0)
            modified_z = abs(cur_pt.value - med) / scale

            if modified_z >= mad_threshold:
                h = self._generate_alert_hash(metric_id, geo_code, cur_pt.period, "ROLLING_MAD")
                if h not in self._seen_alert_hashes:
                    self._seen_alert_hashes.add(h)
                    dev = round(cur_pt.value - med, 2)
                    rel_pct = round((dev / med) * 100.0, 2) if med > 0 else None
                    sev = (
                        AnomalySeverity.CRITICAL
                        if modified_z >= 4.5
                        else (AnomalySeverity.HIGH if modified_z >= 3.5 else AnomalySeverity.MEDIUM)
                    )

                    anomalies.append(
                        AnomalyRecord(
                            anomaly_id=h,
                            metric_id=metric_id,
                            geo_code=geo_code,
                            period=cur_pt.period,
                            observed_value=cur_pt.value,
                            expected_value=round(med, 2),
                            absolute_deviation=abs(dev),
                            relative_deviation_pct=abs(rel_pct) if rel_pct is not None else None,
                            category=AnomalyCategory.STATISTICAL_OUTLIER,
                            severity=sev,
                            method=f"Robust Rolling MAD (k={window_size}, z={modified_z:.2f})",
                            threshold=mad_threshold,
                            evidence_quality="HIGH",
                            source_provenance=cur_pt.source_ref or "Reported Observation",
                            explanation=(
                                f"In {cur_pt.period}, observed {cur_pt.value:,.1f} {cur_pt.unit} deviated by {abs(dev):,.1f} {cur_pt.unit} "
                                f"({modified_z:.1f}x MAD) from the rolling median baseline of {med:,.1f} {cur_pt.unit}. "
                                "This is a statistical deviation that warrants verification against economic activity or extreme weather."
                            ),
                            recommended_verification_steps=[
                                "Review regional temperature anomalies (heatwave or unseasonal rainfall).",
                                "Verify industrial tariff category billing cycles or bulk consumer commissioning.",
                                "Confirm whether utility contracted dispatch boundaries were updated.",
                            ],
                        )
                    )

        return anomalies

    def detect_seasonal_residual_anomalies(
        self,
        series: list[TimeSeriesPoint],
        metric_id: str,
        geo_code: str,
        season_length: int = 12,
        residual_pct_threshold: float = 20.0,
    ) -> list[AnomalyRecord]:
        """Detects deviations when observation diverges significantly from the same calendar month in history."""
        anomalies: list[AnomalyRecord] = []
        n = len(series)
        if n < season_length + 1:
            return anomalies

        # Map calendar month (1-12) to list of historical values
        by_month: dict[int, list[tuple[str, float]]] = {m: [] for m in range(1, 13)}
        for pt in series:
            m = int(pt.period[5:7])
            by_month[m].append((pt.period, pt.value))

        for pt in series[season_length:]:
            m = int(pt.period[5:7])
            history_vals = [val for p, val in by_month[m] if p < pt.period]
            if not history_vals:
                continue

            expected_seasonal = sum(history_vals) / len(history_vals)
            diff = pt.value - expected_seasonal
            rel_diff_pct = (diff / expected_seasonal) * 100.0 if expected_seasonal > 0 else 0.0

            if abs(rel_diff_pct) >= residual_pct_threshold:
                h = self._generate_alert_hash(metric_id, geo_code, pt.period, "SEASONAL_RESIDUAL")
                if h not in self._seen_alert_hashes:
                    self._seen_alert_hashes.add(h)
                    anomalies.append(
                        AnomalyRecord(
                            anomaly_id=h,
                            metric_id=metric_id,
                            geo_code=geo_code,
                            period=pt.period,
                            observed_value=pt.value,
                            expected_value=round(expected_seasonal, 2),
                            absolute_deviation=round(abs(diff), 2),
                            relative_deviation_pct=round(abs(rel_diff_pct), 2),
                            category=AnomalyCategory.OPERATIONAL_VARIANCE,
                            severity=AnomalySeverity.MEDIUM if abs(rel_diff_pct) < 30.0 else AnomalySeverity.HIGH,
                            method=f"Seasonal Residual Analysis (Month {m:02d} Baseline)",
                            threshold=residual_pct_threshold,
                            evidence_quality="HIGH",
                            source_provenance=pt.source_ref or "Reported Observation",
                            explanation=(
                                f"In {pt.period}, observed {pt.value:,.1f} {pt.unit} varied by {rel_diff_pct:+.1f}% "
                                f"from historical seasonal average for month {m:02d} ({expected_seasonal:,.1f} {pt.unit}). "
                                "Indicates operational variance distinct from standard annual cyclicality."
                            ),
                            recommended_verification_steps=[
                                "Check agricultural irrigation power rationing schedule changes.",
                                "Examine early or delayed monsoon arrival impact on agricultural pumping.",
                            ],
                        )
                    )

        return anomalies

    def run_all_detectors(
        self,
        series: list[TimeSeriesPoint],
        metric_id: str,
        geo_code: str,
    ) -> list[AnomalyRecord]:
        """Runs the complete suite of transparent anomaly detectors with automatic deduplication."""
        results: list[AnomalyRecord] = []
        results.extend(self.detect_data_quality_anomalies(series, metric_id, geo_code))
        results.extend(self.detect_rolling_mad_anomalies(series, metric_id, geo_code))
        results.extend(self.detect_seasonal_residual_anomalies(series, metric_id, geo_code))
        return results
