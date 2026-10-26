"""Write the engine's OpenAPI document to openapi.json (sorted, so a diff means a real change).

    python scripts/export_openapi.py          # from platform/engine
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from avishkar_engine.app import create_app  # noqa: E402


def document() -> str:
    app = create_app(insecure_dev=True)
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    (ROOT / "openapi.json").write_text(document(), encoding="utf-8", newline="\n")
    print("wrote openapi.json")
