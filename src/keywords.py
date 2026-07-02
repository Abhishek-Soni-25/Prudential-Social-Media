"""User-managed keyword campaigns.

Custom keywords added from the Campaign page are stored here and merged into the target
keyword set used by every scan, on top of the base keywords in config.yaml.
"""

from __future__ import annotations

import json
import logging

from .config import DATA_DIR

log = logging.getLogger(__name__)

_PATH = DATA_DIR / "keywords.json"


def load_custom() -> list[str]:
    if not _PATH.exists():
        return []
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
        return [str(k).strip() for k in data if str(k).strip()]
    except (json.JSONDecodeError, OSError):
        return []


def save_custom(keywords: list[str]) -> list[str]:
    clean, seen = [], set()
    for k in keywords:
        k = str(k).strip()
        if k and k.lower() not in seen:
            seen.add(k.lower())
            clean.append(k)
    try:
        _PATH.write_text(json.dumps(clean, indent=2), encoding="utf-8")
    except OSError as exc:
        log.warning("Could not persist keywords: %s", exc)
    return clean


def merged(base: list[str]) -> list[str]:
    """Base config keywords plus custom ones, de-duplicated (case-insensitive)."""
    out, seen = [], set()
    for k in [*(base or []), *load_custom()]:
        if k and k.lower() not in seen:
            seen.add(k.lower())
            out.append(k)
    return out
