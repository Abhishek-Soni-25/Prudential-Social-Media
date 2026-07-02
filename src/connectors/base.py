"""Connector base class + per-source cursor persistence.

A cursor records the last-seen item id per source so each `poll()` returns only new
content. Cursors live in `data/state/<channel>.json`.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

from ..config import STATE_DIR
from ..models import Post

log = logging.getLogger(__name__)


class ConnectorUnavailable(RuntimeError):
    """Raised when a connector cannot run (missing creds or unsupported channel)."""


class BaseConnector(ABC):
    """Abstract base for all channel connectors."""

    channel: str = "base"

    def __init__(self, sources: list[str], max_items: int = 25,
                 state_key: str | None = None) -> None:
        self.sources = sources or []
        self.max_items = max_items
        # state_key isolates cursor storage so parallel keyword sets (e.g. competitor
        # collection) don't dedupe against each other or against the main scan.
        self._state_path = STATE_DIR / f"{state_key or self.channel}.json"
        self._cursors: dict[str, str] = self._load_state()

    # --- cursor helpers ------------------------------------------------------

    def _load_state(self) -> dict[str, str]:
        if self._state_path.exists():
            try:
                return json.loads(self._state_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError) as exc:
                log.warning("Could not read cursor state %s: %s", self._state_path, exc)
        return {}

    def _save_state(self) -> None:
        try:
            self._state_path.write_text(
                json.dumps(self._cursors, indent=2), encoding="utf-8"
            )
        except OSError as exc:
            log.warning("Could not persist cursor state %s: %s", self._state_path, exc)

    def get_cursor(self, source: str) -> str | None:
        return self._cursors.get(source)

    def set_cursor(self, source: str, value: str) -> None:
        self._cursors[source] = value
        self._save_state()

    # --- lifecycle -----------------------------------------------------------

    def setup(self) -> None:
        """Optional one-time init (auth/clients). Override as needed."""

    @abstractmethod
    def poll(self) -> list[Post]:
        """Return new `Post` objects across all configured sources."""

    def close(self) -> None:
        """Optional cleanup. Override as needed."""
