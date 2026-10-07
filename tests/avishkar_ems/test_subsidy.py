"""The subsidy comes from data/policy/pm_surya_ghar.json, and reproduces the schedule stated on the official portal."""

from __future__ import annotations

import json

import pytest

from avishkar_ems.subsidy import POLICY_FILE, pm_surya_ghar


@pytest.mark.parametrize(
    ("kwp", "expected"),
    [
        (0.5, 15_000.0),
        (1.0, 30_000.0),
        (2.0, 60_000.0),
        (2.5, 69_000.0),  # 2 kW at 30,000 + 0.5 kW at 18,000
        (3.0, 78_000.0),
        (5.0, 78_000.0),  # capped for systems larger than 3 kW
        (10.0, 78_000.0),
    ],
)
def test_residential_schedule(kwp: float, expected: float) -> None:
    assert pm_surya_ghar(kwp) == pytest.approx(expected)


def test_not_residential_or_empty_system_gets_nothing() -> None:
    assert pm_surya_ghar(3.0, residential=False) == 0.0
    assert pm_surya_ghar(0.0) == 0.0
    assert pm_surya_ghar(-1.0) == 0.0


def test_policy_file_records_its_source_and_the_date_it_was_checked() -> None:
    d = json.loads(POLICY_FILE.read_text(encoding="utf-8"))
    assert d["sourceUrl"].startswith("https://pmsuryaghar.gov.in")
    assert d["verifiedAt"]
    assert d["notApplied"], "figures that were not applied must be listed, not silently dropped"
