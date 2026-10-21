#!/usr/bin/env python3
"""OpenAPI 3.1.0 specification generator for EMHASS web server.

Constructs the machine-readable OpenAPI contract from declared parameter definitions
and web server route maps, verifying that no live routes are left undocumented.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
OPENAPI_JSON_PATH = REPO_ROOT / "src" / "emhass" / "static" / "openapi.json"

# Curated API paths and their allowed HTTP methods
CURATED: dict[str, set[str]] = {
    "/get-config": {"GET"},
    "/get-config/defaults": {"GET"},
    "/get-json": {"POST"},
    "/set-config": {"POST"},
    "/action/{action_name}": {"POST"},
    "/api/v1/last-run": {"GET"},
    "/api/v1/plan": {"GET"},
    "/healthz": {"GET"},
}

# Routes that are HTML views, static assets, or non-API endpoints to be excluded
SKIP: set[str] = {
    "/",
    "/index",
    "/template",
    "/configuration",
    "/static/{filename}",
}


def _normalise_path(path: str) -> str:
    """Convert Flask/Quart route patterns (e.g. <action_name>, <int:id>, <path:file>) to OpenAPI {param} style."""
    return re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", path)


def _input_to_schema(input_type: str, p: dict[str, Any]) -> dict[str, Any]:
    """Convert a parameter definition dictionary into an OpenAPI 3.1 schema object."""
    default_val = p.get("default_value")

    if input_type == "select":
        s: dict[str, Any] = {
            "type": "string",
            "enum": list(p.get("select_options", [])),
        }
        if default_val is not None:
            s["default"] = default_val
        return s

    elif input_type == "int":
        s = {"type": "integer"}
        if default_val is not None:
            s["default"] = default_val
        return s

    elif input_type == "float":
        s = {"type": "number"}
        if default_val is not None:
            s["default"] = default_val
        return s

    elif input_type == "array.float":
        item_schema: dict[str, Any] = {"type": "number"}
        if default_val is not None:
            item_schema["default"] = default_val
        s = {
            "type": "array",
            "items": item_schema,
        }
        if "unit" in p and p["unit"] is not None:
            s["x-unit"] = p["unit"]
        return s

    elif input_type == "array.array.float":
        return {
            "type": "array",
            "items": {
                "type": "array",
                "items": {"type": "number"},
            },
        }

    elif input_type == "object":
        return {"type": "object"}

    elif input_type == "array.time":
        return {
            "type": "array",
            "items": {"type": "string"},
        }

    else:
        # Unknown input type
        sys.exit(1)


def build_config_component(defs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Flatten all configuration sections into a unified OpenAPI component schema."""
    properties: dict[str, Any] = {}
    for section_name, section_props in defs.items():
        if not isinstance(section_props, dict):
            continue
        for prop_name, prop_def in section_props.items():
            if prop_name in properties:
                sys.exit(1)
            inp = prop_def.get("input", "object") if isinstance(prop_def, dict) else "object"
            properties[prop_name] = _input_to_schema(inp, prop_def if isinstance(prop_def, dict) else {})

    return {
        "type": "object",
        "properties": properties,
    }


def assert_no_undocumented(
    routes: set[tuple[str, str]],
    curated: dict[str, set[str]],
    skip: set[str],
) -> None:
    """Ensure every live route belongs either to the curated API contract or the skiplist."""
    undocumented = []
    for path, method in routes:
        if path in skip:
            continue
        if path in curated and method in curated[path]:
            continue
        undocumented.append((path, method))

    if undocumented:
        sys.exit(1)


def discovered_routes() -> set[tuple[str, str]]:
    """Inspect the live Quart web server url_map to discover active route/method pairs."""
    from emhass.web_server import app

    routes: set[tuple[str, str]] = set()
    for rule in app.url_map.iter_rules():
        norm_path = _normalise_path(rule.rule)
        for method in rule.methods:
            if method not in ("HEAD", "OPTIONS"):
                routes.add((norm_path, method))
    return routes


def _load_json(p: Path) -> dict[str, Any]:
    """Load JSON file and strip meta $schema and $id fields."""
    content = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(content, dict):
        content.pop("$schema", None)
        content.pop("$id", None)
    return content


def build_spec(routes: set[tuple[str, str]] | None = None) -> dict[str, Any]:
    """Build the complete OpenAPI 3.1.0 specification dictionary."""
    from emhass.command_line import EMHASS_SCHEMA_VERSION

    if OPENAPI_JSON_PATH.exists():
        spec = json.loads(OPENAPI_JSON_PATH.read_text(encoding="utf-8"))
    else:
        spec = {
            "openapi": "3.1.0",
            "info": {
                "title": "EMHASS API",
                "version": str(EMHASS_SCHEMA_VERSION),
                "description": "Machine-readable contract for the EMHASS JSON API.",
            },
            "paths": {},
            "components": {"schemas": {}},
        }

    spec["openapi"] = "3.1.0"
    spec["info"]["title"] = "EMHASS API"
    spec["info"]["version"] = str(EMHASS_SCHEMA_VERSION)

    # Ensure action endpoint requirements
    if "/action/{action_name}" in spec.get("paths", {}):
        action_post = spec["paths"]["/action/{action_name}"].get("post", {})
        action_post["externalDocs"] = {
            "description": "Output schema and documentation for optimization action results",
            "url": "https://github.com/davidusb-geek/emhass/blob/master/docs/plan_output_schema.md",
        }
        action_post["requestBody"] = {
            "required": False,
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "additionalProperties": True,
                    }
                }
            },
        }

    # Filter paths if explicit routes set is provided
    if routes is not None:
        live_paths = {p for p, _ in routes}
        spec["paths"] = {p: v for p, v in spec.get("paths", {}).items() if p in live_paths}

    return spec


def generate() -> dict[str, Any]:
    """Generate and write the openapi.json file, returning the spec object."""
    spec = build_spec()
    OPENAPI_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    OPENAPI_JSON_PATH.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    return spec


if __name__ == "__main__":
    generate()
    print(f"Generated OpenAPI spec at: {OPENAPI_JSON_PATH}")
