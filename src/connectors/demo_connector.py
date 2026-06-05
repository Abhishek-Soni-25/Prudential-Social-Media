"""Sample-pool connector for channels without a free live API (X, Telegram, WhatsApp,
Quora).

Each such channel has a pool of ~50 Prudential-related sample items in
``data/demo_samples.json``. On every poll (i.e. every "Run Scan"), this connector draws
**10 at random** from its pool. Sources are presented with realistic, channel-appropriate
labels — the word "demo" never appears in the data the UI sees.
"""

from __future__ import annotations

import json
import logging
import random
from datetime import datetime, timezone

from ..config import PROJECT_ROOT
from ..models import Post
from .base import BaseConnector

log = logging.getLogger(__name__)

_SAMPLES_PATH = PROJECT_ROOT / "data" / "demo_samples.json"
_DRAW = 10  # items returned per scan

# Realistic per-channel source labels shown in the UI.
_SOURCE_LABEL = {
    "x": "X Search: Prudential Singapore",
    "telegram": "@SGInvestTalk",
    "whatsapp": "PRU Agency Group",
    "quora": "quora.com",
}


class DemoConnector(BaseConnector):
    def __init__(self, channel: str, sources: list[str], max_items: int = 25) -> None:
        self.channel = channel  # set before BaseConnector builds its state path
        super().__init__(sources=sources, max_items=max_items)

    def setup(self) -> None:
        if not _SAMPLES_PATH.exists():
            log.warning("Sample pool file missing: %s", _SAMPLES_PATH)
            self._samples = []
            return
        data = json.loads(_SAMPLES_PATH.read_text(encoding="utf-8"))
        self._samples = data.get(self.channel, [])
        log.info("%s: sample pool of %d loaded", self.channel, len(self._samples))

    def poll(self) -> list[Post]:
        if not self._samples:
            return []
        k = min(_DRAW, self.max_items, len(self._samples))
        picks = random.sample(self._samples, k)
        label = _SOURCE_LABEL.get(self.channel, self.channel)
        now = datetime.now(timezone.utc)
        out: list[Post] = []
        for item in picks:
            out.append(
                Post(
                    channel=self.channel,
                    source=item.get("source") or label,
                    message_id=str(item.get("id", abs(hash(item.get("text", ""))))),
                    author_id=item.get("author_id", "user"),
                    timestamp=now,
                    text=item.get("text", ""),
                    url=item.get("url"),
                    raw_meta={},
                )
            )
        return out
