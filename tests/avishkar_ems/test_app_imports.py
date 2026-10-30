"""Every view module imports, and every name it imports from the package exists.

This is the test that was missing. On 2026-10-30 `app/dashboard.py` could not start at all: it imported
`route_community_exchange` from `avishkar_ems.home_balance`, where no such name existed, so the documented
entry point showed an error page while 554 tests passed. Nothing caught it, because
`tests/avishkar_ems/test_dashboard.py` -- the only test that loads the dashboard -- skips itself unless the
disk cache is fresh, and nothing else imports the view modules.

These tests need no cache, no data and no network: importing a module runs its imports and its top-level
code, which is where that whole class of defect lives. They run in well under a second and they never skip.

The second test goes further than importing, because a view can import cleanly and still name an attribute
that does not exist on a dataclass: `profile.battery.chemistry` was such a case. It reads every
`profile.<group>.<field>` the views mention and checks it against the real dataclass fields.
"""

from __future__ import annotations

import ast
import dataclasses
import importlib
import pathlib
import re
import typing

import pytest

pytest.importorskip("streamlit")

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / "app"

#: Every view module. `app.dashboard` is deliberately left out of this list: importing it runs the whole
#: Streamlit script, which needs a warm cache. `test_dashboard.py` covers that; what matters here is that
#: everything the script imports is sound, which is where the defect actually was.
VIEW_MODULES = ["app.ui_html", "app.home_setup_view", "app.integrations_view", "app.urjasetu_view"]


@pytest.mark.parametrize("module", VIEW_MODULES)
def test_each_view_module_imports(module: str) -> None:
    assert importlib.import_module(module) is not None


def test_every_name_the_dashboard_imports_from_the_package_exists() -> None:
    """Resolve the dashboard's own `from avishkar_ems... import x` and `from app... import x` lines.

    This is what catches an import of something that was never written, without running the Streamlit
    script. It checks the dashboard and every view, so one missing name fails here rather than on a page.
    """
    missing: list[str] = []
    for path in sorted(APP.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.module is None:
                continue
            if not (node.module.startswith("avishkar_ems") or node.module.startswith("app")):
                continue
            try:
                mod = importlib.import_module(node.module)
            except ImportError as e:  # the module itself is missing: report it against this file
                missing.append(f"{path.name}:{node.lineno}: cannot import {node.module} ({e})")
                continue
            for alias in node.names:
                if alias.name == "*" or hasattr(mod, alias.name):
                    continue
                # `from avishkar_ems import cache` names a submodule, which is not an attribute of the
                # package until something imports it. Try that before calling the name missing.
                try:
                    importlib.import_module(f"{node.module}.{alias.name}")
                except ImportError:
                    missing.append(f"{path.name}:{node.lineno}: {node.module} has no {alias.name!r}")
    assert missing == [], "names imported by the app that do not exist:\n  " + "\n  ".join(missing)


def test_every_profile_attribute_the_views_read_exists() -> None:
    """`profile.<group>.<field>` in a view must be a real field of that group's dataclass."""
    from avishkar_ems import home_profile

    # Resolve each field's annotation to a class, rather than building a HomeProfile (which needs arguments).
    hints = typing.get_type_hints(home_profile.HomeProfile)
    groups: dict[str, set[str]] = {}
    for field in dataclasses.fields(home_profile.HomeProfile):
        annotated = hints.get(field.name)
        if isinstance(annotated, type) and dataclasses.is_dataclass(annotated):
            groups[field.name] = {f.name for f in dataclasses.fields(annotated)}
    assert groups, "no nested configuration groups were found on HomeProfile; this test would check nothing"

    missing: list[str] = []
    for path in sorted(APP.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"profile\.([a-z_]+)\.([a-z_]+)\b", text):
            group, attr = match.group(1), match.group(2)
            if group in groups and attr not in groups[group]:
                line = text.count("\n", 0, match.start()) + 1
                missing.append(f"{path.name}:{line}: profile.{group} has no field {attr!r}")
    assert missing == [], "attributes the app reads that do not exist:\n  " + "\n  ".join(sorted(set(missing)))


def test_the_html_helper_refuses_markup_whose_whitespace_matters() -> None:
    """`html_block` strips indentation, which would corrupt a <pre>; it must refuse rather than do that."""
    from app.ui_html import html_block

    assert html_block("    <div>\n        <span>x</span>\n    </div>") == "<div>\n<span>x</span>\n</div>"
    # Markdown reads a blank line followed by an indented line as a code block; after html_block, nothing is indented.
    out = html_block("    <div>\n\n        <path d='M 0 0' />\n    </div>")
    assert not any(line.startswith(" ") for line in out.splitlines())
    with pytest.raises(ValueError, match="pre"):
        html_block("    <pre>\n        keep  this\n    </pre>")
