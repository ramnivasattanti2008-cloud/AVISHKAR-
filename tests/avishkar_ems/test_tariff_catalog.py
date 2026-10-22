"""Tests for the tariff catalogue audit."""

import json
import tempfile
from datetime import date
from pathlib import Path

import pytest

from avishkar_ems.tariff_catalog import (
    TariffRecord,
    TariffStatus,
    catalogue,
    load_tariff_record,
    select_current,
    select_for_consumer,
)


def _write_tariff(tmp: Path, name: str, meta: dict, blocks=None) -> Path:
    data = {
        "name": name,
        "source": meta.pop("_source", "Some order"),
        "tou_blocks": blocks or [[0, 24, 7.0]],
        "export_rate": 3.0,
        "p2p_charges": 0.6,
        "shortfall_penalty": 5.0,
        "meta": meta,
    }
    p = tmp / f"{name}.json"
    p.write_text(json.dumps(data))
    return p


def test_load_current_record(tmp_path):
    p = _write_tariff(tmp_path, "current", {
        "state": "UP",
        "discom": "UPPCL",
        "category": "LMV-1",
        "consumerType": "RESIDENTIAL",
        "effectiveFrom": "2020-01-01",
        "effectiveTo": "2030-01-01",
        "_source": "UPERC order Annexure I",
    })
    rec = load_tariff_record(p)
    assert rec.status == TariffStatus.CURRENT
    assert rec.is_current_on(date(2025, 6, 1))
    assert not rec.is_current_on(date(2031, 1, 1))


def test_load_expired_record(tmp_path):
    p = _write_tariff(tmp_path, "expired", {
        "effectiveFrom": "2020-01-01",
        "effectiveTo": "2021-03-31",
        "_source": "old order",
    })
    rec = load_tariff_record(p)
    assert rec.status == TariffStatus.EXPIRED
    assert not rec.is_current_on()


def test_load_unverified_record(tmp_path):
    p = _write_tariff(tmp_path, "unverified", {})
    rec = load_tariff_record(p)
    assert rec.status == TariffStatus.UNVERIFIED


def test_load_not_yet_effective(tmp_path):
    p = _write_tariff(tmp_path, "future", {
        "effectiveFrom": "2030-01-01",
        "effectiveTo": "2031-01-01",
        "_source": "future order",
    })
    rec = load_tariff_record(p)
    assert rec.status == TariffStatus.NOT_YET_EFFECTIVE


def test_select_current_with_filters(tmp_path):
    _write_tariff(tmp_path, "up_res", {
        "state": "UP",
        "category": "LMV-1",
        "consumerType": "RESIDENTIAL",
        "effectiveFrom": "2020-01-01",
        "effectiveTo": "2030-01-01",
        "_source": "order",
    })
    _write_tariff(tmp_path, "up_com", {
        "state": "UP",
        "category": "LMV-2",
        "consumerType": "COMMERCIAL",
        "effectiveFrom": "2020-01-01",
        "effectiveTo": "2030-01-01",
        "_source": "order",
    })
    recs = catalogue(tmp_path)
    assert len(recs) == 2
    found = select_current(recs, state="UP", consumer_type="COMMERCIAL")
    assert found is not None
    assert found.consumer_type == "COMMERCIAL"
    missing = select_current(recs, state="KA")
    assert missing is None


def test_select_for_consumer(tmp_path):
    _write_tariff(tmp_path, "a", {
        "consumerType": "RESIDENTIAL",
        "effectiveFrom": "2020-01-01",
        "effectiveTo": "2030-01-01",
        "_source": "order",
    })
    recs = catalogue(tmp_path)
    found = select_for_consumer(recs, "RESIDENTIAL")
    assert found is not None
    assert select_for_consumer(recs, "INDUSTRIAL") is None


def test_select_current_returns_none_when_all_expired(tmp_path):
    _write_tariff(tmp_path, "expired", {
        "effectiveFrom": "2020-01-01",
        "effectiveTo": "2021-01-01",
        "_source": "order",
    })
    recs = catalogue(tmp_path)
    assert select_current(recs) is None