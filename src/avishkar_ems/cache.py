"""Disk cache for the heavy per-site computations behind the dashboard.

Training the forecast models and replaying a held-out year takes minutes, so each result is pickled once under
`cache_dir()` (default `data/cache/`, override with the AVISHKAR_CACHE_DIR environment variable). File names are the
cache keys. `scripts/precompute_cache.py` fills the cache ahead of time and stamps it with `fingerprint()`; the
dashboard compares that stamp with the current code, tariffs, data and library versions and warns when they differ,
because a stale pickle looks exactly like a fresh one.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import pickle
import platform
from collections.abc import Callable
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import TypeVar

import pandas as pd

from avishkar_ems.advisor import battery_advice
from avishkar_ems.demo import Prepared, day_view, forecast_quality, prepare, run_payback
from avishkar_ems.flex import summarise
from avishkar_ems.monitor import daily_summary, deviation_flags
from avishkar_ems.payback import Totals

T = TypeVar("T")

ROOT = Path(__file__).resolve().parents[2]
STAMP = "FINGERPRINT"
DEFAULT_DAY_OFFSET = 50  # the dashboard opens this many days into each site's held-out period
FAULT_FACTOR = 0.6  # the dashboard's "inject a string fault" switch scales that day's PV output by this
_LIBS = ("numpy", "pandas", "scikit-learn", "pvlib", "highspy", "cvxpy", "skforecast")
# Modules that turn results into text or extra views and never feed numbers back into a cached or published result.
# Anything not listed here is assumed to compute results, so editing it marks the cache and results/ stale.
_PRESENTATION_ONLY = frozenset({"report.py", "mysite.py", "lifetime.py", "explain.py", "summary.py"})


def cache_dir() -> Path:
    return Path(os.environ.get("AVISHKAR_CACHE_DIR") or ROOT / "data" / "cache")


def disk_cached(name: str, compute: Callable[[], T]) -> T:
    """Return the pickle `<name>.pkl` if it loads, otherwise compute, store (atomically) and return the value."""
    f = cache_dir() / f"{name}.pkl"
    if f.exists():
        try:
            with f.open("rb") as fp:
                return pickle.load(fp)
        except (OSError, EOFError, pickle.UnpicklingError, AttributeError, ImportError):
            pass  # corrupt, or written by code whose classes have since moved: recompute and overwrite
    value = compute()
    try:
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_name(f.name + ".tmp")
        with tmp.open("wb") as fp:
            pickle.dump(value, fp)
        tmp.replace(f)  # readers in other sessions never see a half-written file
    except OSError:
        pass  # read-only checkout: still return the value
    return value


def prune(max_day_views: int = 300) -> int:
    """Delete the oldest `day_view_*` pickles beyond `max_day_views` (every date and charge a user tries adds one)."""
    files = sorted(cache_dir().glob("day_view_*.pkl"), key=lambda f: f.stat().st_mtime, reverse=True)
    for f in files[max_day_views:]:
        f.unlink(missing_ok=True)
    return max(0, len(files) - max_day_views)


# ---- the cached artefacts; file names are kept stable so an existing cache stays valid


def prepared(key: str) -> Prepared:
    return disk_cached(f"prepared_{key}", lambda: prepare(key))


def default_day(p: Prepared) -> pd.Timestamp:
    return (p.test_start + pd.Timedelta(days=DEFAULT_DAY_OFFSET)).normalize()


def cached_day_view(key: str, day: str, soc_init: float):
    return disk_cached(f"day_view_{key}_{day}_{soc_init}",
                       lambda: day_view(prepared(key), day, soc_init=soc_init))


@dataclass
class PaybackView:
    """What the dashboard needs from a replay: the table plus how far to trust it."""

    table: pd.DataFrame
    ems: Totals
    trades: list
    days: int  # sampled days replayed
    months_covered: int  # calendar months those days fall in
    non_optimal: pd.DataFrame  # days where the solver did not report an optimal plan


def cached_payback(key: str, every_days: int) -> PaybackView:
    """Replay that samples one day in every `every_days`, annualised."""
    def compute():
        ev = run_payback(prepared(key), every_days=every_days)
        return PaybackView(ev.payback_table(), ev.ems, ev.trades, ev.ems.days, ev.months_covered(), ev.non_optimal_days())
    return disk_cached(f"payback_{key}_{every_days}", compute)


def cached_advice(key: str):
    def compute():
        p = prepared(key)
        days = pd.date_range(p.test_start, p.test_end)[::28]
        return battery_advice(p.site, p.df, p.pv_model, p.load_model, days)
    return disk_cached(f"advice_{key}", compute)


def cached_quality(key: str):
    return disk_cached(f"fq_{key}", lambda: forecast_quality(prepared(key)))


def cached_flex(key: str):
    def compute():
        p = prepared(key)
        return summarise(p.df["load_kw"], p.df["import_rate"], p.site.tariff.export_rate)
    return disk_cached(f"flex_{key}", compute)


def cached_monitor(key: str, day: str) -> dict[str, tuple]:
    """{'clean': ..., 'fault': ...}, each (window, flags, daily summary) around `day`; 'fault' scales that day's PV."""
    def compute():
        df = prepared(key).df
        d0 = pd.Timestamp(day).tz_localize(df.index.tz)
        win = df[(df.index >= d0 - pd.Timedelta(days=3)) & (df.index < d0 + pd.Timedelta(days=4))].copy()
        out = {}
        for name, factor in (("clean", 1.0), ("fault", FAULT_FACTOR)):
            w = win.copy()
            today = (w.index >= d0) & (w.index < d0 + pd.Timedelta(days=1))
            w.loc[today, "pv_kw"] = w.loc[today, "pv_kw"] * factor
            flags = deviation_flags(w)
            out[name] = (w, flags, daily_summary(w, flags))
        return out
    return disk_cached(f"mon_{key}_{day}", compute)


# ---- staleness


def library_versions() -> dict[str, str]:
    """Versions of the libraries whose changes can move the numbers (see `_LIBS`)."""
    out = {}
    for lib in _LIBS:
        try:
            out[lib] = metadata.version(lib)
        except metadata.PackageNotFoundError:
            out[lib] = "missing"
    return out


def provenance(**extra) -> dict:
    """Where a set of results came from: when, with what interpreter and libraries, and from which code and data."""
    return {"generated_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC"), "python": platform.python_version(),
            "libraries": library_versions(), "fingerprint": fingerprint(), **extra}


def fingerprint(root: Path = ROOT) -> str:
    """Hash of everything the cached results depend on: our code, tariffs, bundled data and key library versions."""
    h = hashlib.sha256()
    for lib, version in library_versions().items():
        h.update(f"{lib}=={version}\n".encode())
    files = [*(root / "src" / "avishkar_ems").glob("*.py"), *(root / "data" / "tariffs").glob("*.json"),
             *(root / "data" / "real").glob("*.csv")]
    for f in sorted(files):
        if f.name.startswith("uploaded_") or f.name in _PRESENTATION_ONLY:
            continue  # scratch uploads, and modules that format results but cannot change them
        h.update(f.name.encode())
        h.update(f.read_bytes().replace(b"\r\n", b"\n"))  # same code, different checkout line endings
    return h.hexdigest()[:16]


def write_stamp(root: Path = ROOT) -> None:
    cache_dir().mkdir(parents=True, exist_ok=True)
    (cache_dir() / STAMP).write_text(fingerprint(root))


def cache_status(root: Path = ROOT) -> str:
    """'empty' (nothing cached, so everything is computed live), 'fresh', 'stale' (code, data or libraries changed
    since the stamp) or 'unstamped' (results cached by hand or by an older version, so they cannot be checked)."""
    stamp = cache_dir() / STAMP
    if not stamp.exists():
        return "unstamped" if any(cache_dir().glob("*.pkl")) else "empty"
    return "fresh" if stamp.read_text().strip() == fingerprint(root) else "stale"
