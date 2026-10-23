"""Tariff catalogue audit: expiry, provenance, and consumer-category selection.

The EMS ships a handful of tariff records in ``data/tariffs/*.json``.  Each record
may carry a ``meta`` block with ``effectiveFrom`` / ``effectiveTo`` dates, a
``source`` string naming the regulatory document, and a ``consumerType``.  This
module loads those records, validates them, and answers two questions that the
raw ``load_tariff`` helper cannot:

  * Which tariff is in force on a given date?
  * Is the record still current, or has it expired?

No prices are invented.  A record whose source is missing or whose effective
period has passed is reported as ``EXPIRED`` or ``UNVERIFIED``; the caller decides
what to do with that status.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

import pandas as pd

from avishkar_ems.tariffs import Tariff, load_tariff


class TariffStatus(StrEnum):
    """Verification status of a tariff record."""

    CURRENT = "CURRENT"
    EXPIRED = "EXPIRED"
    NOT_YET_EFFECTIVE = "NOT_YET_EFFECTIVE"
    UNVERIFIED = "UNVERIFIED"  # no source or effective dates supplied


@dataclass
class TariffRecord:
    """A tariff with its audit metadata."""

    name: str
    tariff: Tariff
    source: str
    state: str | None
    discom: str | None
    category: str | None
    consumer_type: str | None
    effective_from: date | None
    effective_to: date | None
    status: TariffStatus
    path: str | None = None
    notes: list[str] = field(default_factory=list)

    def is_current_on(self, when: date | datetime | None = None) -> bool:
        """True if this tariff is in force on the given date (default: today)."""
        if self.status != TariffStatus.CURRENT:
            return False
        if when is None:
            when = date.today()
        if isinstance(when, datetime):
            when = when.date()
        if self.effective_from and when < self.effective_from:
            return False
        if self.effective_to and when > self.effective_to:
            return False
        return True


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    try:
        return pd.to_datetime(text).date()
    except (ValueError, TypeError):
        return None


def load_tariff_record(path: str | Path) -> TariffRecord:
    """Load a tariff JSON file and return a ``TariffRecord`` with audit metadata."""
    path = Path(path)
    raw = json.loads(path.read_text())
    tariff = load_tariff(path)
    meta = raw.get("meta", {}) or {}
    eff_from = _parse_date(meta.get("effectiveFrom"))
    eff_to = _parse_date(meta.get("effectiveTo"))
    source = str(raw.get("source") or meta.get("source") or "").strip()
    notes = [str(n) for n in (meta.get("notes") or [])]

    if not source:
        status = TariffStatus.UNVERIFIED
    elif eff_from is None or eff_to is None:
        status = TariffStatus.UNVERIFIED
    elif eff_to < date.today():
        status = TariffStatus.EXPIRED
    elif eff_from > date.today():
        status = TariffStatus.NOT_YET_EFFECTIVE
    else:
        status = TariffStatus.CURRENT

    return TariffRecord(
        name=tariff.name,
        tariff=tariff,
        source=source,
        state=meta.get("state"),
        discom=meta.get("discom"),
        category=meta.get("category"),
        consumer_type=meta.get("consumerType"),
        effective_from=eff_from,
        effective_to=eff_to,
        status=status,
        path=str(path),
        notes=notes,
    )


def catalogue(directory: str | Path = "data/tariffs") -> list[TariffRecord]:
    """Return every ``TariffRecord`` found in ``directory`` (default: ``data/tariffs``)."""
    directory = Path(directory)
    if not directory.is_dir():
        return []
    records = []
    for path in sorted(directory.glob("*.json")):
        try:
            records.append(load_tariff_record(path))
        except (json.JSONDecodeError, KeyError, ValueError):
            continue
    return records


def select_current(
    records: list[TariffRecord],
    when: date | datetime | None = None,
    state: str | None = None,
    consumer_type: str | None = None,
    category: str | None = None,
) -> TariffRecord | None:
    """Return the first record that is current on ``when`` and matches the filters."""
    if when is None:
        when = date.today()
    if isinstance(when, datetime):
        when = when.date()
    state_l = state.lower() if state else None
    ct_l = consumer_type.lower() if consumer_type else None
    cat_l = category.lower() if category else None
    for rec in records:
        if not rec.is_current_on(when):
            continue
        if state_l and (rec.state or "").lower() != state_l:
            continue
        if ct_l and (rec.consumer_type or "").lower() != ct_l:
            continue
        if cat_l and (rec.category or "").lower() != cat_l:
            continue
        return rec
    return None


def select_for_consumer(
    records: list[TariffRecord],
    consumer_type: str,
    when: date | datetime | None = None,
) -> TariffRecord | None:
    """Return the first record whose ``consumerType`` matches, current on ``when``."""
    if not consumer_type:
        return None
    return select_current(records, when=when, consumer_type=consumer_type)
