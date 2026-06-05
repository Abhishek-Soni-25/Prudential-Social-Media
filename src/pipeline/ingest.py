"""Step 1 — Ingestion & parsing.

Cleans raw content (noise, control chars, system-log lines) while preserving the
timestamp, author id, and platform metadata already captured on the `Post`.
"""

from __future__ import annotations

import re

from ..models import Post

# Lines that look like system/log noise rather than human content.
_SYSTEM_LINE = re.compile(
    r"^\s*(\[?\d{4}-\d{2}-\d{2}.*\]?\s*(INFO|DEBUG|WARN|ERROR|TRACE)\b|"
    r"<system>|/system|joined the group|left the group|"
    r"changed the group|pinned a message)",
    re.IGNORECASE,
)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_WS = re.compile(r"[ \t]+")
_MULTINL = re.compile(r"\n{3,}")


def _fix_mojibake(text: str) -> str:
    """Repair common double-encoded UTF-8 (e.g. 'â€"' -> '—') seen in scraped feeds."""
    if any(m in text for m in ("Ã", "â€", "Â")):
        try:
            return text.encode("latin-1", "ignore").decode("utf-8", "ignore")
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass
    return text


def clean_text(text: str) -> str:
    text = _fix_mojibake(text)
    lines = []
    for line in text.splitlines():
        if _SYSTEM_LINE.match(line):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = _CONTROL.sub("", cleaned)
    cleaned = _WS.sub(" ", cleaned)
    cleaned = _MULTINL.sub("\n\n", cleaned)
    return cleaned.strip()


def clean_post(post: Post) -> Post | None:
    """Clean a post's text in place. Returns None if nothing meaningful remains."""
    post.text = clean_text(post.text)
    if len(post.text) < 3:
        return None
    return post
