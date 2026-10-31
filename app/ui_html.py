"""Handing a block of HTML to Streamlit without Markdown mangling it.

`st.markdown(..., unsafe_allow_html=True)` still runs the string through a Markdown parser first, and
Markdown has a rule older than any of this: a blank line followed by a line indented four spaces or more
starts a *code block*. Our HTML is written indented, to be readable inside the function that builds it, and
it has blank lines between sections. So Markdown took everything after the first such blank line as code and
printed it as text. Readers saw `<!-- Active Animated Flow Lines -->` and raw `<path d="...">` where the
power-flow map should have been, on the dashboard's own front page, in 36 blocks across the four views.

`html_block` removes the indentation from every line and leaves everything else alone. With no line indented,
no code block can form, and any Markdown in the same string (`**bold**`, a list) still works, which is why
this is done rather than switching to `st.html`: several of these blocks mix Markdown with HTML, and `st.html`
would render the Markdown as literal text instead.

Indentation inside the markup carries no meaning here: HTML collapses whitespace, and none of these blocks
contains a `<pre>` or a `<textarea>`, where it would.
"""

from __future__ import annotations

import re

#: A `<pre>` or `<textarea>` is the one place where leading whitespace in HTML is significant. No block in the
#: app has one; if one is ever added, this catches it rather than letting the markup be quietly reflowed.
_WHITESPACE_SIGNIFICANT = re.compile(r"<\s*(pre|textarea)\b", re.IGNORECASE)


def html_block(markup: str) -> str:
    """Return `markup` with the leading whitespace stripped from each line.

    Raises ValueError if the markup contains an element whose whitespace matters, because stripping it there
    would change what the reader sees.
    """
    if _WHITESPACE_SIGNIFICANT.search(markup):
        raise ValueError(
            "html_block() would strip the indentation inside a <pre> or <textarea>, where it is significant. "
            "Render that block with st.html() instead, which does no Markdown parsing at all."
        )
    return "\n".join(line.lstrip() for line in markup.splitlines())
