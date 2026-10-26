"""The committed OpenAPI document is the contract the TypeScript API is written against: it must not drift from the code."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from export_openapi import document  # noqa: E402


def test_the_committed_document_matches_the_code():
    committed = (ROOT / "openapi.json").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert committed == document(), "the engine's schemas changed: run `python scripts/export_openapi.py` in platform/engine and commit openapi.json"


def test_every_route_is_documented():
    import json

    doc = json.loads(document())
    for path, item in doc["paths"].items():
        for method, op in item.items():
            assert op.get("summary"), f"{method.upper()} {path} has no summary"
            assert op.get("tags"), f"{method.upper()} {path} has no tags"
