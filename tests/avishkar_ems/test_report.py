import json

import pandas as pd
import pytest

from avishkar_ems import report

SCEN = ["EMS", "EMS + noon re-plan", "Baseline: self-consume + export (battery idle)", "Baseline: fixed-rule battery",
        "Reference: EMS with perfect foresight"]


def _write_results(d, ems_benefit, rule_benefit, idle_benefit=90_000.0, quick=False):
    """Three sites; benefit per scenario is set so the EMS wins, ties or loses against the fixed rule."""
    rows = []
    for site, (e, r) in zip(("home-mathura", "shop-pune", "clinic-jaipur"), zip(ems_benefit, rule_benefit, strict=True), strict=True):
        for scen, benefit in zip(SCEN, (e, e * 1.001, idle_benefit, r, e * 1.02), strict=True):
            rows.append({"scenario": scen, "site": site, "annual_benefit_inr": benefit, "payback_years": 1_000_000 / benefit,
                         "payback_years_after_subsidy": 900_000 / benefit, "unserved_critical_kwh": 0.0})
    pd.DataFrame(rows).to_csv(d / "payback.csv", index=False)
    pd.DataFrame([{"series": s, "site": k, "mae_kw_daytime": 0.1, "mean_kw_daytime": 1.0, "band80_coverage": c}
                  for s, c in (("pv", 0.85), ("load", 0.9)) for k in ("home-mathura", "shop-pune", "clinic-jaipur")]
                 ).to_csv(d / "forecast_quality.csv", index=False)
    sens = []
    for site in ("home-mathura", "shop-pune", "clinic-jaipur"):
        for bat, gain in ((0.0, 1.0), (1.0, 1.10)):
            for exp, hi in ((3.0, 1.0), (5.0, 0.95)):
                sens.append({"site": site, "battery_x": bat, "export_rate": exp, "ems_benefit_inr": 100_000 * (gain if bat else 1.0) * hi,
                             "idle_benefit_inr": 100_000.0, "ems_unserved_kwh": 0.0})
    pd.DataFrame(sens).to_csv(d / "sensitivity.csv", index=False)
    stats = {"offers": 3, "committed_kwh": 10.0, "delivered_kwh": 9.0, "shortfall_kwh": 1.0}
    prov = {"generated_at": "2026-01-01 00:00 UTC", "python": "3.12.0", "libraries": {"numpy": "2.2.6", "pandas": "2.3.3", "pvlib": "0.16.1"},
            "fingerprint": "abc", "every_days": 7, "quick": quick,
            "sampled_days": {"home-mathura": 33, "shop-pune": 52, "clinic-jaipur": 52},
            "p2p": dict.fromkeys(("home-mathura", "shop-pune", "clinic-jaipur"), stats)}
    (d / "provenance.json").write_text(json.dumps({"run_demo": prov, "run_sensitivity": prov}))


def test_table_bolds_the_best_of_the_three_policies_and_phrases_ties_wins_and_losses(tmp_path):
    # EMS vs fixed rule: Mathura ties (+0.05%), Pune wins (+2%), Jaipur loses (-1%)
    _write_results(tmp_path, ems_benefit=(100_050, 102_000, 99_000), rule_benefit=(100_000, 100_000, 100_000))
    text = report.render_results(tmp_path)
    assert "| 3 kWp home, Mathura |" in text and "| 15 kWp shop, Pune |" in text
    pune = next(line for line in text.splitlines() if line.startswith("| 15 kWp shop, Pune"))
    assert "**" in pune.split("|")[2]  # EMS is the lowest payback at Pune, so its cell is bold
    jaipur = next(line for line in text.splitlines() if line.startswith("| 30 kWp clinic, Jaipur"))
    assert "**" in jaipur.split("|")[4]  # the fixed rule is lowest at Jaipur
    assert "ties at Mathura" in text and "wins by 2.0% at Pune" in text and "loses by 1.0% at Jaipur" in text
    assert "11.2%, 13.3% and 10.0% more a year" in text  # EMS vs the idle battery, to one decimal


def test_subsidy_sensitivity_and_provenance_are_derived_from_the_files(tmp_path):
    _write_results(tmp_path, (100_000, 100_000, 100_000), (100_000, 100_000, 100_000))
    text = report.render_results(tmp_path)
    assert "drops from 10.00 to 9.00 years" in text  # payback_years vs after-subsidy at the home
    assert "adds 10.0% at Mathura" in text  # battery_x 1.0 vs 0.0 at the base export rate
    assert "Generated 2026-01-01 00:00 UTC" in text and "every 7" in text and "Python 3.12.0" in text
    assert "33" in text and "52" in text  # sampled days per site


def test_quick_runs_are_refused_because_they_are_not_the_headline_numbers(tmp_path):
    _write_results(tmp_path, (100_000,) * 3, (100_000,) * 3, quick=True)
    with pytest.raises(ValueError, match="--quick"):
        report.render_results(tmp_path)


def test_update_readme_replaces_only_the_marked_block_and_check_detects_drift(tmp_path):
    _write_results(tmp_path, (100_000,) * 3, (100_000,) * 3)
    readme = tmp_path / "README.md"
    readme.write_text(f"intro\n{report.START}\nold numbers\n{report.END}\noutro\n")
    assert report.update_readme(readme, tmp_path, check=True) is False  # stale
    assert report.update_readme(readme, tmp_path) is True  # rewritten
    text = readme.read_text()
    assert text.startswith("intro\n") and text.endswith("outro\n") and "old numbers" not in text
    assert report.update_readme(readme, tmp_path, check=True) is True  # now in sync
    readme.write_text("no markers here")
    with pytest.raises(ValueError, match="markers"):
        report.update_readme(readme, tmp_path)
