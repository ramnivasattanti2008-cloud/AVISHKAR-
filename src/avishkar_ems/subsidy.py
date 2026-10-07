"""PM Surya Ghar: Muft Bijli Yojana central financial assistance for residential rooftop solar.

The rates are configuration, not code: they live in `data/policy/pm_surya_ghar.json` together with the source they were
read from and the date they were checked (the official portal, pmsuryaghar.gov.in). The platform API seeds its
`policy_rules` table from the same file, so the two cannot drift. Rules change, so check the portal before relying on
them. Batteries are not covered by this calculation.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

POLICY_FILE = Path(__file__).resolve().parents[2] / "data" / "policy" / "pm_surya_ghar.json"


@lru_cache(maxsize=1)
def _residential_rule() -> dict:
    rules = json.loads(POLICY_FILE.read_text(encoding="utf-8"))["rules"]
    return next(r for r in rules if r["appliesTo"] == "RESIDENTIAL")


def pm_surya_ghar(dc_kwp: float, residential: bool = True) -> float:
    """Subsidy in rupees for a residential system of `dc_kwp`; 0 for anything that is not a residential household."""
    if not residential or dc_kwp <= 0:
        return 0.0
    rule = _residential_rule()
    total, lower = 0.0, 0.0
    for tier in rule["tiers"]:
        total += max(min(dc_kwp, tier["upToKw"]) - lower, 0.0) * tier["inrPerKw"]
        lower = tier["upToKw"]
    return min(total, float(rule["capInr"]))
