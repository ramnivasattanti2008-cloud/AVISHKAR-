"""Meter CSV validation tests.

These tests exercise the ``read_meter_csv`` helper with malformed, missing and
empty inputs. They do NOT fabricate energy values: a row that cannot be
parsed is dropped, and a file with no usable rows raises.
"""

from __future__ import annotations

import pytest

from avishkar_ems.userdata import read_meter_csv


def _write(tmp_path, text, name="meter.csv"):
    p = tmp_path / name
    p.write_text(text)
    return p


def test_rejects_empty_file(tmp_path):
    p = _write(tmp_path, "")
    with pytest.raises(ValueError):
        read_meter_csv(p)


def test_rejects_missing_usage_column(tmp_path):
    p = _write(tmp_path, "timestamp\n2023-01-01 00:00\n")
    with pytest.raises(ValueError):
        read_meter_csv(p)


def test_drops_negative_readings(tmp_path):
    p = _write(tmp_path, "timestamp,load_kw\n2023-01-01 00:00,-5\n2023-01-01 00:15,1.2\n")
    s = read_meter_csv(p)
    assert (s >= 0).all()
    assert len(s) >= 1


def test_drops_non_numeric_usage(tmp_path):
    p = _write(tmp_path, "timestamp,load_kw\n2023-01-01 00:00,abc\n2023-01-01 00:15,1.2\n")
    s = read_meter_csv(p)
    # The non-numeric row is dropped; the remaining valid reading is preserved.
    assert (s == 1.2).all()


def test_drops_duplicate_timestamps(tmp_path):
    lines = ["timestamp,load_kw"]
    for i in range(4):
        lines.append(f"2023-01-01 00:{i:02d},1.0")
    lines.append("2023-01-01 00:00,9.9")  # duplicate of first
    p = _write(tmp_path, "\n".join(lines))
    s = read_meter_csv(p)
    assert not s.index.duplicated().any()


def test_rejects_no_rows_file(tmp_path):
    p = _write(tmp_path, "timestamp,load_kw\n")
    with pytest.raises(ValueError):
        read_meter_csv(p)


def test_handles_wh_unit(tmp_path):
    p = _write(tmp_path, "timestamp,usage_wh\n2023-01-01 00:00,600\n2023-01-01 00:15,600\n")
    s = read_meter_csv(p)
    # 600 Wh over 15 min = 2.4 kW average
    assert abs(float(s.iloc[0]) - 2.4) < 0.5
