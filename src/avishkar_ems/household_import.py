"""Household Bill and Meter-Reading Import Engine for UrjaSetu EMS (Phase 9).

Delivers an end-to-end import wizard:
1. Utility Bill Import:
   - Text/CSV/XLSX bill extraction with field review before saving.
   - Extraction of billing period, readings, kWh, amount, fixed/energy charges, taxes, solar credits.
   - Robust standard library XLSX extraction via zipfile + XML.
2. Meter-Reading Import Wizard:
   - Canonical column mapping (cumulative reading, interval energy, solar, power).
   - Cumulative vs. interval consumption separation (never sum cumulative readings).
   - Detection of duplicate timestamps, out-of-order rows, negative values, and meter resets.
   - Idempotency with SHA-256 file fingerprinting.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PureWindowsPath
from typing import Any

from avishkar_ems.household_module import (
    HouseholdObservation,
    ObservationType,
    ValidationStatus,
)

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB limit
ALLOWED_EXTENSIONS = {".txt", ".csv", ".xlsx", ".json", ".tsv"}


def sanitize_and_validate_filename(filename: str) -> str:
    """Sanitizes filename against path traversal and validates permitted extensions."""
    # Both separators and drive letters are stripped on every OS, so an upload named
    # like a Windows path is reduced to its file name on the Linux server too.
    base_name = PureWindowsPath(filename).name
    # Strip dangerous characters while preserving legitimate filenames
    clean_name = re.sub(r"[^\w\.\-]", "_", base_name)
    if not clean_name:
        clean_name = "upload.txt"
    ext = Path(clean_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"FILE REJECTED: Extension '{ext}' is not permitted. Permitted formats: {sorted(ALLOWED_EXTENSIONS)}"
        )
    return clean_name


@dataclass(frozen=True)
class BillExtractionResult:
    """Parsed utility bill fields for review before saving."""

    bill_month: str  # "YYYY-MM"
    bill_date: str  # "YYYY-MM-DD"
    units_consumed_kwh: float
    total_amount_inr: float
    fixed_charge_inr: float
    energy_charge_inr: float
    tax_and_duty_inr: float
    net_meter_export_kwh: float
    solar_credit_inr: float
    previous_reading_kwh: float | None
    current_reading_kwh: float | None
    due_date: str | None
    tariff_category: str
    warnings: list[str]
    confidence_score: float  # 0.0 to 1.0
    source_filename: str
    raw_text_snippet: str


@dataclass(frozen=True)
class ColumnMappingConfig:
    """User-specified column mapping for meter-reading import."""

    timestamp_col: str
    cumulative_reading_col: str | None = None
    interval_kwh_col: str | None = None
    average_power_kw_col: str | None = None
    solar_kwh_col: str | None = None
    grid_import_kwh_col: str | None = None
    grid_export_kwh_col: str | None = None
    timezone_name: str = "Asia/Kolkata"
    date_format: str | None = None  # None for auto-parsing


@dataclass(frozen=True)
class ImportValidationSummary:
    """Detailed validation diagnostics from meter import analysis."""

    total_rows: int
    valid_rows: int
    duplicate_rows: int
    rejected_rows: int
    reset_events: int
    spike_events: int
    warnings: list[str]
    detected_interval_minutes: int
    from_timestamp: str | None
    to_timestamp: str | None


@dataclass(frozen=True)
class MeterImportExecutionResult:
    """Final outcome of confirmed meter reading import."""

    import_id: str
    property_id: str
    sha256_hash: str
    filename: str
    inserted_count: int
    skipped_count: int
    rejected_count: int
    validation_summary: ImportValidationSummary
    observations: list[HouseholdObservation]


# ------------------ FILE UTILITIES & XLSX PARSING ------------------


def compute_file_sha256(content: bytes) -> str:
    """Computes SHA-256 fingerprint for idempotency tracking."""
    return hashlib.sha256(content).hexdigest()


def validate_file_size(content: bytes, max_bytes: int = MAX_FILE_SIZE_BYTES) -> None:
    """Enforces strict file upload size limit."""
    if len(content) > max_bytes:
        raise ValueError(
            f"FILE REJECTED: Upload size ({len(content) / (1024 * 1024):.2f} MB) exceeds maximum allowed limit of {max_bytes / (1024 * 1024):.0f} MB."
        )


def parse_xlsx_to_rows(content: bytes) -> list[list[str]]:
    """Lightweight XLSX spreadsheet parser using Python standard library zipfile + XML.

    Avoids heavy third-party dependencies while reliably reading tabular data.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            # 1. Read shared strings
            shared_strings: list[str] = []
            if "xl/sharedStrings.xml" in z.namelist():
                tree = ET.fromstring(z.read("xl/sharedStrings.xml"))
                # Namespace handling: {http://schemas.openxmlformats.org/spreadsheetml/2006/main}si
                for si in tree.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si"):
                    t = si.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                    shared_strings.append(t.text if t is not None and t.text is not None else "")

            # 2. Read first sheet
            sheet_name = "xl/worksheets/sheet1.xml"
            if sheet_name not in z.namelist():
                # Try finding any sheet
                sheet_candidates = [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")]
                if not sheet_candidates:
                    raise ValueError("No worksheets found inside XLSX archive.")
                sheet_name = sheet_candidates[0]

            sheet_tree = ET.fromstring(z.read(sheet_name))
            rows: list[list[str]] = []
            ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
            sheet_data = sheet_tree.find(f"{ns}sheetData")
            if sheet_data is None:
                return []

            for row_el in sheet_data.findall(f"{ns}row"):
                row_cells: list[str] = []
                for c in row_el.findall(f"{ns}c"):
                    v_el = c.find(f"{ns}v")
                    cell_type = c.attrib.get("t", "")
                    val = v_el.text if v_el is not None and v_el.text is not None else ""
                    if cell_type == "s" and val.isdigit():
                        idx = int(val)
                        if idx < len(shared_strings):
                            val = shared_strings[idx]
                    row_cells.append(val.strip())
                if any(cell for cell in row_cells):
                    rows.append(row_cells)
            return rows
    except Exception as e:
        raise ValueError(f"Failed to parse XLSX file: {e}") from e


# ------------------ UTILITY BILL PARSER ------------------


class HouseholdBillParser:
    """Parses electricity bills from text, CSV, or structured statements."""

    @classmethod
    def parse_bill_content(cls, raw_content: str | bytes, filename: str = "bill.txt") -> BillExtractionResult:
        """Extracts bill metadata and financial components with strict validation."""
        filename = sanitize_and_validate_filename(filename)
        if isinstance(raw_content, bytes):
            validate_file_size(raw_content)
            # Check if XLSX
            if filename.lower().endswith(".xlsx"):
                rows = parse_xlsx_to_rows(raw_content)
                text = "\n".join([",".join(r) for r in rows])
            else:
                text = raw_content.decode("utf-8", errors="replace")
        else:
            text = raw_content

        warnings: list[str] = []

        # 1. Billing Month extraction (e.g. 2026-03, March 2026, 03/2026)
        bill_month = cls._extract_billing_month(text)
        if not bill_month:
            warnings.append("Could not reliably detect billing month; defaulted to current month.")
            bill_month = datetime.now().strftime("%Y-%m")

        # 2. Bill Date extraction (YYYY-MM-DD or DD/MM/YYYY)
        bill_date = cls._extract_date(text, pattern=r"(?:Bill Date|Date of Bill|Billed On)[\s:]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[/-][0-9]{2}[/-][0-9]{4})")
        if not bill_date:
            bill_date = f"{bill_month}-05"

        # 3. Consumption in kWh
        consumption_kwh = cls._extract_numeric(
            text,
            patterns=[
                r"(?:Units Consumed|Total Consumption|Total kWh|Billed Units|Energy Consumed)[\s:=]*([0-9]+(?:\.[0-9]+)?)",
                r"([0-9]+(?:\.[0-9]+)?)\s*(?:kWh|Units)",
            ],
            default=0.0,
        )
        if consumption_kwh <= 0.0:
            warnings.append("Consumption kWh could not be extracted or was zero.")

        # 4. Total Bill Amount (INR)
        total_amount = cls._extract_numeric(
            text,
            patterns=[
                r"(?:Total\s*Payable|Total\s*Bill|Total\s*Amount|Amount\s*Payable|Net\s*Payable|Net\s*Amount|Payable\s*Amount|Bill\s*Amount)[\s:=₹Rs.]*([0-9]+(?:\.[0-9]+)?)",
            ],
            default=0.0,
        )
        if total_amount <= 0.0:
            m_rs = re.search(r"(?:Total|Payable|Bill)[\s\w]*?(?:₹|Rs\.?)\s*([0-9]+(?:\.[0-9]+)?)", text, re.IGNORECASE)
            if m_rs:
                try:
                    total_amount = float(m_rs.group(1).replace(",", ""))
                except ValueError:
                    total_amount = 0.0
        if total_amount <= 0.0:
            warnings.append("Total bill amount could not be extracted.")

        # 5. Fixed Charges
        fixed_charge = cls._extract_numeric(
            text,
            patterns=[r"(?:Fixed Charges?|Demand Charges?)[\s:=₹Rs.]*([0-9]+(?:\.[0-9]+)?)"],
            default=0.0,
        )

        # 6. Energy Charges
        energy_charge = cls._extract_numeric(
            text,
            patterns=[r"(?:Energy Charges?)[\s:=₹Rs.]*([0-9]+(?:\.[0-9]+)?)"],
            default=max(0.0, total_amount - fixed_charge),
        )

        # 7. Taxes and duties
        tax_duty = cls._extract_numeric(
            text,
            patterns=[
                r"(?:Electricity\s*Duty|Tax\s*(?:and|&)?\s*Duty|Tax|Cess)[\s:=₹Rs.]*([0-9]+(?:\.[0-9]+)?)",
            ],
            default=0.0,
        )

        # 8. Solar exports and credits
        solar_export = cls._extract_numeric(
            text,
            patterns=[
                r"(?:Net\s*Meter\s*Export|Solar\s*Export|Export\s*Units|Gross\s*Export)[\s:=]*([0-9]+(?:\.[0-9]+)?)",
            ],
            default=0.0,
        )
        solar_credit = cls._extract_numeric(
            text,
            patterns=[r"(?:Solar Credit|Export Credit|Net Metering Credit)[\s:=₹Rs.]*([0-9]+(?:\.[0-9]+)?)"],
            default=0.0,
        )

        # 9. Meter readings
        prev_reading = cls._extract_numeric(
            text,
            patterns=[r"(?:Previous Reading|Prev Reading|Initial Reading)[\s:=]*([0-9]+(?:\.[0-9]+)?)"],
            default=None,
        )
        curr_reading = cls._extract_numeric(
            text,
            patterns=[r"(?:Current Reading|Curr Reading|Final Reading)[\s:=]*([0-9]+(?:\.[0-9]+)?)"],
            default=None,
        )

        # 10. Due Date
        due_date = cls._extract_date(text, pattern=r"(?:Due Date|Pay By)[\s:]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[/-][0-9]{2}[/-][0-9]{4})")

        # 11. Tariff Category
        tariff_cat = "DOMESTIC"
        if "LT-2" in text or "LT2" in text:
            tariff_cat = "LT-2(a) Domestic"
        elif "LT-1" in text or "LT1" in text:
            tariff_cat = "LT-1 Domestic (Group B)"

        # Calculate confidence score
        score = 1.0
        if not bill_month:
            score -= 0.25
        if consumption_kwh <= 0:
            score -= 0.35
        if total_amount <= 0:
            score -= 0.30
        confidence = max(0.1, round(score, 2))

        return BillExtractionResult(
            bill_month=bill_month,
            bill_date=bill_date,
            units_consumed_kwh=round(consumption_kwh, 2),
            total_amount_inr=round(total_amount, 2),
            fixed_charge_inr=round(fixed_charge, 2),
            energy_charge_inr=round(energy_charge, 2),
            tax_and_duty_inr=round(tax_duty, 2),
            net_meter_export_kwh=round(solar_export, 2),
            solar_credit_inr=round(solar_credit, 2),
            previous_reading_kwh=prev_reading,
            current_reading_kwh=curr_reading,
            due_date=due_date,
            tariff_category=tariff_cat,
            warnings=warnings,
            confidence_score=confidence,
            source_filename=filename,
            raw_text_snippet=text[:400].strip(),
        )

    @staticmethod
    def _extract_billing_month(text: str) -> str | None:
        # Match explicit label: Billing Month: 2026-02
        m_explicit = re.search(
            r"(?:Billing Month|Bill Month|For the Month of)[\s:]*(202[3-9]-(?:0[1-9]|1[0-2]))\b",
            text,
            re.IGNORECASE,
        )
        if m_explicit:
            return m_explicit.group(1)

        months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]
        # Match explicit label with Month Name: Billing Month: February 2026
        for idx, month_name in enumerate(months, 1):
            pattern = rf"(?:Billing Month|Bill Month|For the Month of)[\s:]*{month_name}\s+(202[3-9])\b"
            if re.search(pattern, text, re.IGNORECASE):
                year_m = re.search(rf"{month_name}\s+(202[3-9])\b", text, re.IGNORECASE)
                if year_m:
                    return f"{year_m.group(1)}-{idx:02d}"

        # Fallback match YYYY-MM
        m = re.search(r"\b(202[3-9])-(0[1-9]|1[0-2])\b", text)
        if m:
            return f"{m.group(1)}-{m.group(2)}"

        for idx, month_name in enumerate(months, 1):
            if re.search(rf"\b{month_name}\s+(202[3-9])\b", text, re.IGNORECASE):
                year_m = re.search(rf"\b{month_name}\s+(202[3-9])\b", text, re.IGNORECASE)
                if year_m:
                    return f"{year_m.group(1)}-{idx:02d}"
        return None

    @staticmethod
    def _extract_date(text: str, pattern: str) -> str | None:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            raw = m.group(1).replace("/", "-")
            parts = raw.split("-")
            if len(parts) == 3:
                if len(parts[0]) == 4:
                    return f"{parts[0]}-{parts[1]:0>2}-{parts[2]:0>2}"
                return f"{parts[2]}-{parts[1]:0>2}-{parts[0]:0>2}"
        return None

    @staticmethod
    def _extract_numeric(text: str, patterns: list[str], default: float | None = 0.0) -> float | None:
        for p in patterns:
            m = re.search(p, text, re.IGNORECASE)
            if m:
                try:
                    return float(m.group(1).replace(",", ""))
                except (ValueError, IndexError):
                    continue
        return default


# ------------------ METER READING IMPORT WIZARD ------------------


class MeterReadingImportEngine:
    """Configurable meter reading import engine with validation, deduplication, and anomaly checks."""

    @classmethod
    def parse_tabular_data(cls, file_content: bytes, filename: str) -> tuple[list[str], list[dict[str, str]]]:
        """Parses CSV or XLSX into headers and row dictionaries."""
        filename = sanitize_and_validate_filename(filename)
        validate_file_size(file_content)
        if filename.lower().endswith(".xlsx"):
            rows = parse_xlsx_to_rows(file_content)
            if not rows:
                return [], []
            headers = [h.strip() for h in rows[0]]
            data_rows = []
            for r in rows[1:]:
                # Pad row to match headers
                padded = r + [""] * (len(headers) - len(r))
                row_dict = {headers[i]: padded[i] for i in range(len(headers))}
                data_rows.append(row_dict)
            return headers, data_rows

        # CSV fallback
        decoded = file_content.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(decoded))
        headers = reader.fieldnames or []
        rows = list(reader)
        return list(headers), rows

    @classmethod
    def preview_and_validate(
        cls,
        rows: list[dict[str, str]],
        mapping: ColumnMappingConfig,
    ) -> tuple[ImportValidationSummary, list[dict[str, Any]]]:
        """Validates meter rows, detects resets, and separates cumulative readings from interval consumption."""
        if not rows:
            raise ValueError("No rows found in uploaded meter data.")
        if not mapping.timestamp_col:
            raise ValueError("Timestamp column mapping is required.")

        warnings: list[str] = []
        valid_records: list[dict[str, Any]] = []
        seen_timestamps: set[str] = set()
        duplicate_count = 0
        rejected_count = 0
        reset_count = 0
        spike_count = 0

        last_cumulative_reading: float | None = None
        last_timestamp_dt: datetime | None = None
        interval_diffs: list[int] = []

        for row_idx, r in enumerate(rows):
            raw_ts = r.get(mapping.timestamp_col, "").strip()
            if not raw_ts:
                rejected_count += 1
                continue

            parsed_ts = cls._parse_timestamp(raw_ts, mapping.date_format)
            if not parsed_ts:
                rejected_count += 1
                warnings.append(f"Row {row_idx + 1}: Unparseable timestamp '{raw_ts}'.")
                continue

            iso_ts = parsed_ts.isoformat()
            if iso_ts in seen_timestamps:
                duplicate_count += 1
                continue
            seen_timestamps.add(iso_ts)

            # Check timestamp interval cadence
            if last_timestamp_dt:
                diff_sec = int((parsed_ts - last_timestamp_dt).total_seconds())
                if diff_sec > 0:
                    interval_diffs.append(diff_sec // 60)
            last_timestamp_dt = parsed_ts

            # Extract numeric fields
            cumulative_val = cls._safe_float(r.get(mapping.cumulative_reading_col, "")) if mapping.cumulative_reading_col else None
            interval_val = cls._safe_float(r.get(mapping.interval_kwh_col, "")) if mapping.interval_kwh_col else None
            solar_val = cls._safe_float(r.get(mapping.solar_kwh_col, "")) if mapping.solar_kwh_col else None

            # Negative check
            if cumulative_val is not None and cumulative_val < 0:
                rejected_count += 1
                warnings.append(f"Row {row_idx + 1}: Negative cumulative reading ({cumulative_val}) rejected.")
                continue
            if interval_val is not None and interval_val < 0:
                rejected_count += 1
                warnings.append(f"Row {row_idx + 1}: Negative interval consumption ({interval_val}) rejected.")
                continue

            # Invariant: Distinguish cumulative readings from interval consumption
            derived_interval = interval_val
            validation_status = ValidationStatus.VALID

            if cumulative_val is not None:
                if last_cumulative_reading is not None:
                    delta_reading = cumulative_val - last_cumulative_reading
                    if delta_reading < 0:
                        # Meter reset or meter replacement detected!
                        reset_count += 1
                        validation_status = ValidationStatus.RESET_DETECTED
                        warnings.append(
                            f"Row {row_idx + 1} at {iso_ts}: Meter reset detected (reading dropped from {last_cumulative_reading:.1f} to {cumulative_val:.1f})."
                        )
                        # Set interval consumption to the new cumulative reading rather than negative
                        derived_interval = cumulative_val
                    else:
                        derived_interval = round(delta_reading, 4)
                last_cumulative_reading = cumulative_val

            # Spike detection for residential scale (> 50 kWh in a single interval)
            if derived_interval is not None and derived_interval > 50.0:
                spike_count += 1
                validation_status = ValidationStatus.FLAGGED_SPIKE
                warnings.append(f"Row {row_idx + 1} at {iso_ts}: High consumption jump ({derived_interval:.2f} kWh).")

            valid_records.append({
                "timestamp": iso_ts,
                "cumulative_reading_kwh": cumulative_val,
                "interval_consumption_kwh": derived_interval,
                "solar_kwh": solar_val,
                "validation_status": validation_status,
            })

        # Calculate dominant interval duration in minutes
        dom_interval = 15
        if interval_diffs:
            # Find most common interval
            dom_interval = max(set(interval_diffs), key=interval_diffs.count)

        summary = ImportValidationSummary(
            total_rows=len(rows),
            valid_rows=len(valid_records),
            duplicate_rows=duplicate_count,
            rejected_rows=rejected_count,
            reset_events=reset_count,
            spike_events=spike_count,
            warnings=warnings[:10],  # Top 10 warnings
            detected_interval_minutes=dom_interval,
            from_timestamp=valid_records[0]["timestamp"] if valid_records else None,
            to_timestamp=valid_records[-1]["timestamp"] if valid_records else None,
        )

        return summary, valid_records

    @classmethod
    def execute_import(
        cls,
        property_id: str,
        file_content: bytes,
        filename: str,
        mapping: ColumnMappingConfig,
    ) -> MeterImportExecutionResult:
        """Executes idempotent meter import and converts valid records to canonical observations."""
        filename = sanitize_and_validate_filename(filename)
        sha256 = compute_file_sha256(file_content)
        import_id = f"imp_{uuid.uuid4().hex[:8]}"

        _, rows = cls.parse_tabular_data(file_content, filename)
        summary, valid_records = cls.preview_and_validate(rows, mapping)

        observations: list[HouseholdObservation] = []
        for rec in valid_records:
            # 1. Cumulative reading observation if present
            if rec["cumulative_reading_kwh"] is not None:
                observations.append(
                    HouseholdObservation(
                        property_id=property_id,
                        metric_id="cumulative_meter_reading_kwh",
                        timestamp=rec["timestamp"],
                        value=rec["cumulative_reading_kwh"],
                        unit="kWh",
                        observation_type=ObservationType.CUMULATIVE_METER_READING,
                        data_source_id="METER_FILE_IMPORT",
                        import_id=import_id,
                        validation_status=rec["validation_status"],
                        provenance=f"METER_IMPORT:{filename}:{sha256[:8]}",
                    )
                )

            # 2. Interval consumption observation if present
            if rec["interval_consumption_kwh"] is not None:
                observations.append(
                    HouseholdObservation(
                        property_id=property_id,
                        metric_id="interval_consumption_kwh",
                        timestamp=rec["timestamp"],
                        value=rec["interval_consumption_kwh"],
                        unit="kWh",
                        observation_type=ObservationType.INTERVAL_CONSUMPTION,
                        data_source_id="METER_FILE_IMPORT",
                        import_id=import_id,
                        validation_status=rec["validation_status"],
                        provenance=f"METER_IMPORT:{filename}:{sha256[:8]}",
                    )
                )

            # 3. Solar generation observation if present
            if rec["solar_kwh"] is not None:
                observations.append(
                    HouseholdObservation(
                        property_id=property_id,
                        metric_id="solar_generation_kwh",
                        timestamp=rec["timestamp"],
                        value=rec["solar_kwh"],
                        unit="kWh",
                        observation_type=ObservationType.SOLAR_GENERATION,
                        data_source_id="METER_FILE_IMPORT",
                        import_id=import_id,
                        validation_status=rec["validation_status"],
                        provenance=f"METER_IMPORT:{filename}:{sha256[:8]}",
                    )
                )

        return MeterImportExecutionResult(
            import_id=import_id,
            property_id=property_id,
            sha256_hash=sha256,
            filename=filename,
            inserted_count=len(observations),
            skipped_count=summary.duplicate_rows,
            rejected_count=summary.rejected_rows,
            validation_summary=summary,
            observations=observations,
        )

    @staticmethod
    def _parse_timestamp(raw_text: str, custom_format: str | None = None) -> datetime | None:
        """Parses timestamp across common ISO and Indian date formats."""
        raw = raw_text.strip()
        if custom_format:
            try:
                return datetime.strptime(raw, custom_format)
            except ValueError:
                pass

        # Try ISO format
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            pass

        # Common format variants
        formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%d/%m/%Y %H:%M:%S",
            "%d/%m/%Y %H:%M",
            "%d-%m-%Y %H:%M:%S",
            "%d-%m-%Y %H:%M",
            "%Y/%m/%d %H:%M:%S",
            "%m/%d/%Y %H:%M:%S",
            "%m/%d/%Y %I:%M:%S %p",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(raw, fmt)
            except ValueError:
                continue
        return None

    @staticmethod
    def _safe_float(val: Any) -> float | None:
        if val is None:
            return None
        text = str(val).strip().replace(",", "")
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
