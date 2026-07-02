"""Publish / outbox store.

Records replies and own-account posts composed from the Publish page. Actually delivering
them to a social platform requires that platform's write API + OAuth credentials, which are
not connected here — so items are recorded to the outbox with status 'queued'. Wire a real
publisher later and flip the status to 'sent'.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from .config import DATA_DIR

log = logging.getLogger(__name__)

_PATH = DATA_DIR / "outbox.jsonl"


def record(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    rec = {
        "kind": kind,                # "reply" | "post"
        "status": "queued",          # queued until a real platform publisher is connected
        "created_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    try:
        with _PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError as exc:
        log.warning("Could not persist outbox item: %s", exc)
    return rec


def load_outbox() -> list[dict[str, Any]]:
    if not _PATH.exists():
        return []
    out = []
    for line in _PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    out.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    return out
