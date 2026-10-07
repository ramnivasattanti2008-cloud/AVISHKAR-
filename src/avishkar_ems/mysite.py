"""Analyse your own site from a meter series: payback with and without smart control, and battery size advice.

Shared by `examples/analyze_my_site.py` (command line) and the dashboard's "Upload Your Meter" tab. Weather is a real
typical year from PVGIS laid over your dates; outages are only used if you pass them (the meter file has none).
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from avishkar_ems.advisor import BATTERY_INR_PER_KWH, advise_text, battery_advice
from avishkar_ems.payback import evaluate, train_models
from avishkar_ems.realdata import cached_weather_years, real_site_frame, real_sites
from avishkar_ems.site import SiteSpec
from avishkar_ems.subsidy import pm_surya_ghar
from avishkar_ems.tariffs import Tariff, load_tariff, tod_from_base

MIN_DAYS = 150


class AnalysisError(ValueError):
    """The input cannot be analysed (too little data, no days left to replay): the message is meant for the user."""
IDLE = "Baseline: self-consume + export (battery idle)"


@dataclass
class SiteReport:
    site: SiteSpec
    days: int  # days of meter data
    test_days: int  # held-out days replayed
    avg_kwh_day: float
    table: pd.DataFrame  # payback table, as in payback.Evaluation.payback_table
    advice: pd.DataFrame  # advisor.battery_advice
    battery_inr_per_kwh: float
    backup_hours: float
    months_covered: int


def build_tariff(*, tariff_file: str | None = None, base_rate: float = 7.0, tod: bool = False,
                 commercial: bool = False, export_rate: float = 3.0) -> Tariff:
    """A tariff from a JSON file, a Time-of-Day tariff built from a base rate, or a flat rate."""
    if tariff_file:
        return load_tariff(tariff_file)
    if tod:
        return tod_from_base(base_rate, commercial, export_rate=export_rate)
    return Tariff(((0.0, 24.0, base_rate),), export_rate, 0.6, 5.0, f"flat_{base_rate:g}")


def bundled_weather(lat: float, lon: float, tilt: float, azimuth: float) -> tuple[str, int] | None:
    """(site id, a year) of the bundled demo-site weather file matching this place and angles, usable offline."""
    here = (round(lat, 2), round(lon, 2), round(tilt), round(azimuth))
    for key, (spec, _, _) in real_sites().items():
        if (round(spec.lat, 2), round(spec.lon, 2), round(spec.tilt), round(spec.azimuth)) == here:
            years = cached_weather_years(spec)
            if years:
                return key, (years[0] + years[1]) // 2
    return None


def analyse(load: pd.Series, *, lat: float, lon: float, kwp: float, cost: float, tariff: Tariff,
            battery_kwh: float = 0.0, tilt: float = 15.0, azimuth: float = 180.0, critical_kw: float = 0.3,
            backup_hours: float = 4.0, commercial: bool = False, subsidy: bool = False,
            battery_inr_per_kwh: float = BATTERY_INR_PER_KWH, every_days: int = 14,
            advice_sizes: tuple[float, ...] = (0.0, 2.5, 5.0, 10.0), site_id: str | None = None,
            weather_year: int | None = None) -> SiteReport:
    """Train on the first 60% of the meter series, replay the rest, and report payback and battery advice.

    Weather is a real PVGIS year laid over your dates. When the place and angles match a bundled demo site that
    site's weather is used (works offline); otherwise it is downloaded once per place (needs internet) as `site_id`
    "my-site" and cached. Pass `site_id` and `weather_year` to override."""
    bundled = bundled_weather(lat, lon, tilt, azimuth)
    site_id = site_id or (bundled[0] if bundled else "my-site")
    weather_year = weather_year or (bundled[1] if bundled else 2023)
    days = (load.index[-1] - load.index[0]).days + 1
    if days < MIN_DAYS:
        raise AnalysisError(f"Only {days} days of data. Please provide at least about {MIN_DAYS} days (a year is better).")
    site = SiteSpec(site_id, lat, lon, kwp, kwp, tilt, azimuth, max(battery_kwh, 0.01), max(battery_kwh / 2, 0.01),
                    critical_kw, backup_hours, cost, tariff=tariff,
                    subsidy_inr=pm_surya_ghar(kwp, residential=not commercial) if subsidy else 0.0)
    df = real_site_frame(site, load_kw=load, weather_year=weather_year)
    cut = df.index[int(len(df) * 0.6) // 96 * 96]
    pv_m, ld_m = train_models(site, df[df.index < cut])
    first = cut.tz_localize(None).normalize() + pd.Timedelta(days=2)
    last = df.index[-1].tz_localize(None).normalize() - pd.Timedelta(days=3)
    test_days = list(pd.date_range(first, last, freq=f"{every_days}D"))
    if not test_days:
        raise AnalysisError("Not enough data left after training to replay any days. Provide a longer meter file.")
    ev = evaluate(site, df, pv_m, ld_m, test_days, with_hindsight=False, with_replan=False)
    adv = battery_advice(site, df, pv_m, ld_m, test_days[::2], sizes_kwh=advice_sizes,
                         battery_inr_per_kwh=battery_inr_per_kwh)
    return SiteReport(site, days, len(test_days), float(load.mean() * 24), ev.payback_table(), adv,
                      battery_inr_per_kwh, backup_hours, ev.months_covered())


def markdown_table(df: pd.DataFrame) -> str:
    """A GitHub-style table without the optional `tabulate` dependency that DataFrame.to_markdown needs."""
    def cell(v) -> str:
        if isinstance(v, float):
            if v != v:
                return "-"
            return f"{v:,.0f}" if abs(v) >= 1000 else f"{v:.2f}".rstrip("0").rstrip(".")
        return str(v)

    head = [df.index.name or "", *map(str, df.columns)]
    lines = ["| " + " | ".join(head) + " |", "| " + " | ".join("---" for _ in head) + " |"]
    for idx, row in zip(df.index, df.itertuples(index=False), strict=True):
        lines.append("| " + " | ".join([cell(idx), *map(cell, row)]) + " |")
    return "\n".join(lines)


def report_markdown(r: SiteReport, lang: str = "en") -> str:
    ems, idle = r.table.loc["EMS"], r.table.loc[IDLE]
    s = r.site
    lines = [f"# Your site report ({r.days} days of meter data, {r.test_days} test days)", "",
             f"- Average use: {r.avg_kwh_day:.1f} kWh a day. Solar: {s.dc_kwp:g} kWp. Battery: {s.battery_kwh:g} kWh. "
             f"Tariff: {s.tariff.name}.",
             f"- With smart control the site earns about Rs {ems['annual_benefit_inr']:,.0f} a year; with the battery left idle, "
             f"Rs {idle['annual_benefit_inr']:,.0f}.",
             f"- Payback: {ems['payback_years']:.1f} years"
             + (f" ({ems['payback_years_after_subsidy']:.1f} after the subsidy)." if s.subsidy_inr else "."),
             f"- Power cuts: critical load left unserved on the test days was {ems['unserved_critical_kwh']:.2f} kWh with "
             f"smart control and {idle['unserved_critical_kwh']:.2f} kWh with an idle battery.",
             "", f"## Battery size advice (battery price is an assumption: Rs {r.battery_inr_per_kwh:.0f} per kWh)", "",
             markdown_table(r.advice), "", advise_text(r.advice, r.backup_hours, lang), "",
             f"_Weather is a real typical year laid over your dates. Outages are not in your file, so none were assumed. "
             f"The replay covers {r.months_covered} of 12 calendar months. Check every rate against your bill._"]
    return "\n".join(lines)
