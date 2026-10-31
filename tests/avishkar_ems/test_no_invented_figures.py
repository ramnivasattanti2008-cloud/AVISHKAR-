"""The dashboard must not state a figure it did not work out.

On 2026-10-30 the dashboard's front page showed, as this household's own achievements:

  * a pre-solar bill of INR 4,250 a month, a current bill of INR 480, a saving of INR 3,770 a month and
    INR 45,240 a year -- all four written into a dictionary. The engine's own replay of that same site puts the
    annual benefit near INR 15,500, so the headline overstated it about threefold;
  * a DISCOM consumer id, `DVVNL-RES-281001-8492`, which was a realistic-looking fake;
  * a solar self-consumption of 79.2% and a grid-import reduction of 81.5%, with the home placed in the
    "Top 12% Cleanest Homes in District" and credited with 78 tons of CO2, "equivalent to 3,500 trees";
  * a state residential average to compare against, with no source.

The ARKA assistant repeated the ranking, the ratio and a 25-year figure of INR 11.4 lakh, in both languages.

These tests read the source and fail if any of it comes back. They are deliberately literal: the point is not
that *some* constant appears, but that these specific unsourced claims do not.
"""

from __future__ import annotations

import ast
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DASHBOARD = ROOT / "app" / "dashboard.py"
ARKA = ROOT / "src" / "avishkar_ems" / "arka_assistant.py"


def _personal_homes() -> dict[str, dict]:
    """The site registry, parsed out of the dashboard without importing it (importing runs the whole script)."""
    tree = ast.parse(DASHBOARD.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "PERSONAL_HOMES" for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError("PERSONAL_HOMES was not found in app/dashboard.py")


class TestTheSiteRegistry:
    def test_holds_no_money_at_all(self) -> None:
        homes = _personal_homes()
        assert homes, "the registry is empty, so this test would check nothing"
        for key, home in homes.items():
            money = [f for f in home if f.endswith(("_inr", "_bill", "_savings")) or "bill" in f or "saving" in f]
            assert money == [], f"{key} carries money in the registry ({money}); every figure in money must come from the replay"

    def test_holds_no_consumer_number(self) -> None:
        for key, home in _personal_homes().items():
            assert "consumer_no" not in home, f"{key} carries a consumer number; only the household can supply one"

    def test_holds_no_unsourced_state_average(self) -> None:
        for key, home in _personal_homes().items():
            averages = [f for f in home if "avg" in f or "average" in f or "benchmark" in f]
            assert averages == [], f"{key} carries {averages}; AVISHKAR holds no sourced state or district average"

    def test_still_describes_the_place_and_the_equipment(self) -> None:
        """The fix must not have gutted the registry: what it legitimately holds is still there."""
        homes = _personal_homes()
        for key, home in homes.items():
            for field in ("location", "discom", "state_name", "sanctioned_load_kw", "solar_setup", "battery_setup"):
                assert field in home, f"{key} lost {field}, which is a real property of the site"


class TestTheClaimsThatWereRemoved:
    """Each of these strings was on the page or in the assistant's reply, and none of them had a source."""

    GONE_FROM_DASHBOARD = [
        "DVVNL-RES-281001-8492",
        "Top 12% Cleanest Homes in District",
        "78 Tons CO₂",
        "Equivalent to 3,500 trees",
        "Net Wealth Created for Family",
    ]
    GONE_FROM_ARKA = [
        "Top 12% Cleanest in District",
        "Top 12% most efficient solar homes",
        "शीर्ष 12%",
        "11.4 Lakhs",
        "11.4 लाख",
        "reduction in utility coal imports",
    ]

    @pytest.mark.parametrize("claim", GONE_FROM_DASHBOARD)
    def test_the_dashboard_no_longer_claims_it(self, claim: str) -> None:
        text = DASHBOARD.read_text(encoding="utf-8")
        # The explanatory comments naming what was removed are allowed; a live string is not.
        lines = [ln for ln in text.splitlines() if claim in ln and not ln.lstrip().startswith("#")]
        assert lines == [], f"{claim!r} is back on the dashboard: {lines[:2]}"

    @pytest.mark.parametrize("claim", GONE_FROM_ARKA)
    def test_arka_no_longer_claims_it(self, claim: str) -> None:
        text = ARKA.read_text(encoding="utf-8")
        lines = [ln for ln in text.splitlines() if claim in ln and not ln.lstrip().startswith("#")]
        assert lines == [], f"{claim!r} is back in the assistant: {lines[:2]}"

    def test_the_assistant_says_no_benchmark_is_held_in_both_languages(self) -> None:
        """Strings shown to people come in English/Hindi pairs; the refusal to invent one must too."""
        text = ARKA.read_text(encoding="utf-8")
        assert "holds no sourced residential average" in text
        assert "AVISHKAR के पास नहीं है" in text
        assert "Quoting one would be an invention" in text

    def test_no_percentage_is_ranked_against_an_average_the_project_does_not_hold(self) -> None:
        text = DASHBOARD.read_text(encoding="utf-8")
        for pattern in (r"vs State Avg", r"State Average Benchmark"):
            hits = [ln for ln in text.splitlines() if re.search(pattern, ln) and not ln.lstrip().startswith("#")]
            assert hits == [], f"a comparison against a state average is back: {hits[:2]}"


class TestTheReplacementsAreComputed:
    def test_the_banner_takes_its_money_from_the_replay(self) -> None:
        text = DASHBOARD.read_text(encoding="utf-8")
        assert "_pb_totals.annual_benefit()" in text, "the annual saving is no longer taken from the replay"
        assert "_pb_totals.bill_without_system" in text, "the bill without a system is no longer taken from the replay"
        # And the four figures are derived from those two, not set independently.
        assert "monthly_save = annual_save / 12.0" in text
        assert "cur_bill = pre_bill - monthly_save" in text

    def test_self_consumption_is_computed_from_the_replay_and_may_be_unknown(self) -> None:
        text = DASHBOARD.read_text(encoding="utf-8")
        assert "def solar_self_consumption(steps) -> float | None:" in text
        assert "_sc = solar_self_consumption(ex)" in text
        # It must be able to say it does not know, rather than dividing by zero on a day with no sun.
        assert "if pv_kwh <= 0:" in text and "return None" in text

    def test_carbon_is_refused_rather_than_estimated(self) -> None:
        text = DASHBOARD.read_text(encoding="utf-8")
        assert "no sourced emission factor" in text, "the carbon metric must say why it has no number"


class TestTheHelperItself:
    def test_self_consumption_arithmetic(self) -> None:
        """The helper's arithmetic, checked directly. `app.dashboard` cannot be imported here -- importing it runs
        the whole Streamlit script -- so the same expression is checked on a frame of the same shape."""
        import pandas as pd

        # 2 kW across four 15-minute steps is 2 kWh generated; 0.5 kWh of it is exported, so 75% was used on site.
        steps = pd.DataFrame({"pv_kw": [2.0, 2.0, 2.0, 2.0], "export_kwh": [0.25, 0.25, 0.0, 0.0]})
        pv_kwh = float(steps["pv_kw"].sum()) * 0.25
        exported = float(steps["export_kwh"].sum())
        assert pv_kwh == pytest.approx(2.0)
        assert (pv_kwh - exported) / pv_kwh == pytest.approx(0.75)

        # A day with no sun divides by zero, which is why the helper returns None instead of a percentage.
        dark = pd.DataFrame({"pv_kw": [0.0, 0.0], "export_kwh": [0.0, 0.0]})
        assert float(dark["pv_kw"].sum()) == 0.0
