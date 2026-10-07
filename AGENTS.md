# AGENTS.md

Guide for AI coding agents (Codex, Cursor, Copilot, Gemini and others). The full, maintained guide is
[CLAUDE.md](CLAUDE.md): commands, architecture, data/cache layout and gotchas. Do not re-derive the project by exploring.

**Read in this order:** [CLAUDE.md](CLAUDE.md) → [docs/WORKLOG.md](docs/WORKLOG.md) (what was done and what was NOT done,
newest entry last) → [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) (Python EMS) → for the new platform
[platform/STATUS.md](platform/STATUS.md), [platform/ARCHITECTURE.md](platform/ARCHITECTURE.md),
[platform/SPEC.md](platform/SPEC.md).

**Before you stop, append an entry to `docs/WORKLOG.md`** (what you did, evidence, what you did not do, what is next) and
update `platform/STATUS.md` if you touched the platform. Never mark something done without the command that proves it.

Rules that matter even if you read nothing else:

- `src/emhass/` is vendored upstream code. Do not edit it. Our code: `src/avishkar_ems/`, `app/`, `examples/`, `scripts/`, `platform/`.
- Data honesty is the product: never present simulated, estimated or demo data as live; label every value's status
  (`platform/ARCHITECTURE.md` D6, D7).
- Run `ruff check` with `--no-fix`. After changing code under `src/avishkar_ems`, tariffs or `data/real`, the cache and
  `results/` are stale: re-run `examples/run_demo.py`, `examples/run_sensitivity.py`, `scripts/precompute_cache.py --rebuild`,
  then `python scripts/update_readme.py`. Never hand-edit the README block between the `results` markers.
- Python tests: `python -m pytest tests/avishkar_ems -q` (about 4 minutes). Platform tests: `pnpm -C platform test`.
- Do not write files through shell heredocs (apostrophes and backslashes break or mangle them); use the Edit/Write tools.
