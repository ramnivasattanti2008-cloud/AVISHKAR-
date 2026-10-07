"""Regenerate the result-dependent block of README.md from results/*.csv.

    python scripts/update_readme.py            # rewrite the block between the results markers
    python scripts/update_readme.py --check    # exit 1 if the README does not match results/ (for CI)

Run examples/run_demo.py and examples/run_sensitivity.py first if the code or data changed.
"""

import argparse
import json
import pathlib
import sys

from avishkar_ems import cache
from avishkar_ems.report import update_readme

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="do not write; fail if the README is out of date")
    args = ap.parse_args()
    ok = update_readme(ROOT / "README.md", ROOT / "results", check=args.check)
    if args.check and not ok:
        print("README.md does not match results/*.csv: run python scripts/update_readme.py")
        return 1
    print("README.md results block is up to date" if ok else "README.md updated")
    prov = json.loads((ROOT / "results" / "provenance.json").read_text(encoding="utf-8")).get("run_demo", {})
    if prov.get("fingerprint") != cache.fingerprint():
        print("note: code, tariffs, data or libraries changed since results/ was generated; re-run examples/run_demo.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
