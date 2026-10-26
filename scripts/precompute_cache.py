"""Pre-warm the dashboard's disk cache so every tab opens instantly, then stamp it with the current fingerprint.

    python scripts/precompute_cache.py                 # fill whatever is missing (safe to re-run)
    python scripts/precompute_cache.py --rebuild       # wipe the cache first: do this after changing code, tariffs or data
    python scripts/precompute_cache.py --every 7      # which replay samplings to precompute (default: 7 14 28, the dashboard's choices)

Takes a few minutes from empty. Set AVISHKAR_CACHE_DIR to build somewhere other than data/cache/.
"""

import argparse
import logging

from avishkar_ems import cache
from avishkar_ems.realdata import real_sites

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="delete cached results first")
    ap.add_argument("--every", type=int, nargs="+", default=[7, 14, 28], help="replay sampling(s), in days")
    args = ap.parse_args()

    out = cache.cache_dir()
    if args.rebuild and out.exists():
        for f in [*out.glob("*.pkl"), *out.glob("*.tmp"), out / cache.STAMP]:
            f.unlink(missing_ok=True)
        print(f"Cleared {out}")

    for key in real_sites():
        print(f"== {key}")
        p = cache.prepared(key)
        day = str(cache.default_day(p).date())
        steps = [("default-day plan", cache.cached_day_view, key, day, 0.5),
                 *((f"payback (every {n} days)", cache.cached_payback, key, n) for n in args.every),
                 ("battery advice", cache.cached_advice, key),
                 ("forecast quality", cache.cached_quality, key),
                 ("shiftable loads", cache.cached_flex, key),
                 ("fault monitor", cache.cached_monitor, key, day)]
        for label, fn, *fn_args in steps:
            print(f"   {label} ...", flush=True)
            fn(*fn_args)

    removed = cache.prune()
    if removed:
        print(f"Pruned {removed} old day views")
    cache.write_stamp()
    print(f"Cache ready in {out} (status: {cache.cache_status()})")


if __name__ == "__main__":
    main()
