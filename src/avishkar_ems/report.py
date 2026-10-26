"""Render the result-dependent text of the README from `results/*.csv`, and record where the results came from.

Every number that depends on a run of `examples/run_demo.py` or `examples/run_sensitivity.py` lives in the README between
two marker comments and is generated here, so the README cannot drift from the results again. Regenerate it with
`python scripts/update_readme.py`; `--check` exits non-zero when the README is out of date.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from avishkar_ems import cache
from avishkar_ems.realdata import real_sites

START = "<!-- results:start -->"
END = "<!-- results:end -->"
EMS, IDLE = "EMS", "Baseline: self-consume + export (battery idle)"
RULE, HIND, REPLAN = "Baseline: fixed-rule battery", "Reference: EMS with perfect foresight", "EMS + noon re-plan"
TIE_PCT = 0.15  # inside +/- this many percent the EMS and the fixed rule are called tied


def write_provenance(results_dir: Path, name: str, **extra) -> None:
    """Record, under `name`, when and with what environment and code a results file was produced."""
    path = Path(results_dir) / "provenance.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data[name] = cache.provenance(**extra)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _city(key: str) -> str:
    return key.split("-", 1)[1].title()


def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def _slash(values: list[float], fmt: str) -> str:
    return " / ".join(format(v, fmt) for v in values)


def _vs(delta_pct: float, city: str) -> str:
    if abs(delta_pct) < TIE_PCT:
        shown = "0.0%" if round(delta_pct, 1) == 0 else f"{delta_pct:+.1f}%"  # never print "-0.0%"
        return f"ties at {city} ({shown})"
    return f"{'wins by' if delta_pct > 0 else 'loses by'} {abs(delta_pct):.1f}% at {city}"


def render_results(results_dir: Path) -> str:
    d = Path(results_dir)
    prov_all = json.loads((d / "provenance.json").read_text(encoding="utf-8")) if (d / "provenance.json").exists() else {}
    if "run_demo" not in prov_all:
        raise ValueError("results/provenance.json has no run_demo entry: re-run examples/run_demo.py")
    prov = prov_all["run_demo"]
    if prov.get("quick"):
        raise ValueError("results/ came from a --quick run; re-run examples/run_demo.py without --quick")
    pay = pd.read_csv(d / "payback.csv")
    fq = pd.read_csv(d / "forecast_quality.csv")
    sens = pd.read_csv(d / "sensitivity.csv")
    sites = {k: v for k, v in real_sites().items() if k in set(pay["site"])}
    keys = list(sites)

    def col(scenario: str, field: str) -> list[float]:
        t = pay[pay["scenario"] == scenario].set_index("site")[field]
        return [float(t[k]) for k in keys]

    years = {s: col(s, "payback_years") for s in (EMS, IDLE, RULE, HIND)}
    ben = {s: col(s, "annual_benefit_inr") for s in (EMS, IDLE, RULE, REPLAN)}
    lines = ["Payback in years, lower is better (best of the first three in bold):", "",
             "| Site | EMS | Battery idle | Fixed-rule battery | Perfect foresight |", "|---|---|---|---|---|"]
    for i, k in enumerate(keys):
        site, kind = sites[k][0], k.split("-")[0]
        three = [years[s][i] for s in (EMS, IDLE, RULE)]
        cells = [f"**{v:.2f}**" if v == min(three) else f"{v:.2f}" for v in three] + [f"{years[HIND][i]:.2f}"]
        lines.append(f"| {site.dc_kwp:g} kWp {kind}, {_city(k)} | " + " | ".join(cells) + " |")
    lines.append("")

    subsidised = [i for i, k in enumerate(keys) if sites[k][0].subsidy_inr > 0]
    if subsidised:
        i = subsidised[0]
        after = col(EMS, "payback_years_after_subsidy")[i]
        others = _join([k.split("-")[0] for j, k in enumerate(keys) if j not in subsidised])
        lines += [f"With the PM Surya Ghar subsidy (Rs {sites[keys[i]][0].subsidy_inr:,.0f} for a {sites[keys[i]][0].dc_kwp:g} kW "
                  f"home, if you qualify) the {_city(keys[i])} EMS payback drops from {years[EMS][i]:.2f} to {after:.2f} years. "
                  f"The {others} are commercial, so no subsidy is applied.", ""]

    vs_idle = [(b / a - 1) * 100 for b, a in zip(ben[EMS], ben[IDLE], strict=True)]
    vs_rule = [(b / a - 1) * 100 for b, a in zip(ben[EMS], ben[RULE], strict=True)]
    if all(v >= 0 for v in vs_idle):
        idle_txt = f"Against a battery left idle the EMS earns {_join([f'{v:.1f}%' for v in vs_idle])} more a year."
    else:
        idle_txt = ("Against a battery left idle the EMS earns "
                    + _join([f"{v:+.1f}% at {_city(k)}" for v, k in zip(vs_idle, keys, strict=True)]) + " a year.")
    rule_txt = ("Against a fixed-rule battery it "
                + _join([_vs(v, _city(k)) for v, k in zip(vs_rule, keys, strict=True)]) + ".")
    verdict = (" So the honest summary is: the optimiser's edge over a sensible simple rule is small on these tariffs. "
               "Its clearer value is the reserve, the offers and the settlement." if max(abs(v) for v in vs_rule) < 3 else "")
    lines.append(f"- {idle_txt} {rule_txt}{verdict}")

    un = {s: col(s, "unserved_critical_kwh") for s in (EMS, IDLE, RULE)}
    same_home = max(un[EMS][0], un[IDLE][0], un[RULE][0]) - min(un[EMS][0], un[IDLE][0], un[RULE][0]) < 0.005
    lines.append(f"- Backup: critical load left without power during cuts was {_slash(un[EMS], '.2f')} kWh with the EMS, "
                 f"against {_slash(un[IDLE], '.2f')} with an idle battery and {_slash(un[RULE], '.2f')} with the fixed rule."
                 + (f" The {_city(keys[0])} figure is the same for all three because the meter is not recording during a cut "
                    "and the home has a small battery." if same_home else ""))

    rp = [(r / e - 1) * 100 for r, e in zip(ben[REPLAN], ben[EMS], strict=True)]
    lines.append(f"- The noon re-plan (`intraday.py`) changed yearly benefit by {min(rp):+.1f}% to {max(rp):+.1f}% versus the EMS"
                 + (", so it did not help once execution was reactive" if max(rp) <= 0.5 else "")
                 + ". It is kept as an option and is off in the headline numbers.")

    def cover(series: str) -> list[float]:
        t = fq[fq["series"] == series].set_index("site")["band80_coverage"]
        return [float(t[k]) * 100 for k in keys]

    gen, load = cover("pv"), cover("load")
    measured = [i for i, k in enumerate(keys) if sites[k][2]]
    rest = [i for i in range(len(keys)) if i not in measured]
    load_txt = (f"Load covered {load[measured[0]]:.0f}% at {_city(keys[measured[0]])} (measured), and "
                f"{' / '.join(f'{load[i]:.0f}%' for i in rest)} at the {_join([keys[i].split('-')[0] for i in rest])}"
                if measured and rest else f"Load covered {_slash(load, '.0f')}%")
    wide = (", where the near-repeating factory profile makes the bands too wide" if rest and all(load[i] > 85 for i in rest) else "")
    lines.append(f"- Forecast bands (80% target): generation covered {' / '.join(f'{v:.0f}%' for v in gen)}. {load_txt}{wide} "
                 "([results/forecast_quality.csv](results/forecast_quality.csv)).")

    def battery_gain(rate_pick) -> list[float]:
        out = []
        for k in keys:
            s = sens[sens["site"] == k]
            rate = rate_pick(s["export_rate"])
            at = s[s["export_rate"] == rate].set_index("battery_x")["ems_benefit_inr"]
            out.append((float(at[1.0]) / float(at[0.0]) - 1) * 100)
        return out

    base_gain, high_gain = battery_gain(min), battery_gain(max)
    shrink = [k for g, k in zip(high_gain, keys, strict=True) if g < 0]
    lines.append("- Sensitivity ([results/sensitivity.csv](results/sensitivity.csv)): a battery sized like ours adds "
                 + _join([f"{g:.1f}% at {_city(k)}" for g, k in zip(base_gain, keys, strict=True)])
                 + " compared with having none. With the export (net-metering) rate raised by Rs 2 the battery's gain becomes "
                 + _join([f"{g:+.1f}% at {_city(k)}" for g, k in zip(high_gain, keys, strict=True)])
                 + (f", so at {_city(shrink[0])} the battery is a backup purchase, not a savings one." if shrink else "."))

    p2p = prov.get("p2p", {})
    if p2p:
        txt = _join([f"{p2p[k]['delivered_kwh']:.1f} of {p2p[k]['committed_kwh']:.1f} kWh at {_city(k)}" for k in keys if k in p2p])
        small = max(v["committed_kwh"] for v in p2p.values()) < 200
        lines.append(f"- P2P volume across the sampled days, delivered of committed: {txt}"
                     + (" (small, because real load absorbs most of the surplus)." if small else "."))

    sampled = prov.get("sampled_days", {})
    days_txt = ", ".join(f"{_city(k)} {sampled[k]}" for k in keys if k in sampled)
    libs = prov["libraries"]
    lines += ["", f"_Generated {prov['generated_at']} by `examples/run_demo.py` and `examples/run_sensitivity.py`: one in every "
                  f"{prov['every_days']} held-out days, annualised ({days_txt} sampled days). Python {prov['python']}, "
                  f"numpy {libs.get('numpy')}, pandas {libs.get('pandas')}, pvlib {libs.get('pvlib')}; the full set is in "
                  "`requirements-lock.txt`. This block is generated: run `python scripts/update_readme.py`._"]
    return "\n".join(lines)


def update_readme(readme: Path, results_dir: Path, check: bool = False) -> bool:
    """Rewrite the block between the markers. Returns True if the README is (now) up to date; with `check`, never writes."""
    text = Path(readme).read_text(encoding="utf-8")
    if text.count(START) != 1 or text.count(END) != 1 or text.index(START) > text.index(END):
        raise ValueError(f"{readme} needs exactly one {START} ... {END} pair of markers")
    head, rest = text.split(START)
    old, tail = rest.split(END)
    new = f"\n{render_results(results_dir)}\n"
    if old == new:
        return True
    if check:
        return False
    Path(readme).write_text(head + START + new + END + tail, encoding="utf-8")
    return True
