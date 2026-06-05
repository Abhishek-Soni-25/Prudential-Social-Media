"""n8n webhook connector — live Reddit + LinkedIn data.

An n8n agent scrapes Google search results for the target (Prudential Singapore) and
returns ~10 Reddit + ~10 LinkedIn records as:

    {"total_records": 20, "data": [
        {"source": "reddit"|"linkedin_post", "title", "url", "snippet",
         "sentiment", "category"}, ...]}

This connector maps those records onto `Post` objects (text = title + snippet) so our own
Gemini risk classifier — not n8n's coarse sentiment — makes the call. One connector instance
exists per channel (reddit, linkedin); a short module-level cache means both share a single
webhook fetch per polling cycle. New items are de-duplicated by URL across scans.
"""

from __future__ import annotations

import json
import logging
import random
import time
import urllib.request
from datetime import datetime, timezone

from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)

# Shared cache: { url: (fetched_monotonic, data_list) }
_CACHE: dict[str, tuple[float, list]] = {}
_CACHE_TTL = 90.0  # seconds — long enough for reddit+linkedin within one cycle


def _channel_of(source: str) -> str:
    s = (source or "").lower()
    if "linkedin" in s:
        return "linkedin"
    if "reddit" in s:
        return "reddit"
    return s


def _fetch(url: str, timeout: int = 60, retries: int = 1) -> list:
    cached = _CACHE.get(url)
    if cached and (time.monotonic() - cached[0]) < _CACHE_TTL:
        return cached[1]
    req = urllib.request.Request(url, headers={"User-Agent": "surveillance/0.1"})
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8")
            payload = json.loads(body)
            data = payload.get("data", []) if isinstance(payload, dict) else []
            _CACHE[url] = (time.monotonic(), data)
            return data
        except Exception as exc:  # IncompleteRead, URLError, timeout, JSON error
            last_exc = exc
            log.warning("n8n fetch attempt %d failed: %s", attempt + 1, exc)
    raise RuntimeError(f"n8n webhook unreachable after {retries + 1} attempts: {last_exc}")


class N8nConnector(BaseConnector):
    """Pulls the n8n webhook and yields records for its own channel only."""

    def __init__(self, channel: str, webhook_url: str, max_items: int = 25) -> None:
        self.channel = channel  # set before base builds its state path
        super().__init__(sources=[webhook_url], max_items=max_items)
        self._url = webhook_url

    def setup(self) -> None:
        if not self._url:
            raise ConnectorUnavailable("n8n webhook_url not configured (config.yaml -> n8n).")

    def poll(self) -> list[Post]:
        try:
            data = _fetch(self._url)
        except Exception as exc:
            raise ConnectorUnavailable(f"n8n webhook fetch failed: {exc}") from exc

        # All records for this channel, then draw `max_items` at random per scan.
        mine = [r for r in data if _channel_of(r.get("source", "")) == self.channel]
        if len(mine) > self.max_items:
            mine = random.sample(mine, self.max_items)

        out: list[Post] = []
        now = datetime.now(timezone.utc)
        for rec in mine:
            url = rec.get("url") or ""
            title = (rec.get("title") or "").strip()
            snippet = (rec.get("snippet") or "").strip()
            text = f"{title}\n{snippet}".strip()
            if not text:
                continue
            out.append(
                Post(
                    channel=self.channel,
                    source="Google Search" if self.channel == "linkedin" else "r/ (Google Search)",
                    message_id=str(abs(hash(url or title))),
                    author_id=_author_from_url(url, self.channel),
                    timestamp=now,
                    text=text,
                    url=url or None,
                    raw_meta={"n8n_sentiment": rec.get("sentiment"), "n8n_category": rec.get("category")},
                )
            )
        return out


def _author_from_url(url: str, channel: str) -> str:
    if channel == "linkedin" and "/posts/" in url:
        try:
            return url.split("/posts/", 1)[1].split("_", 1)[0]
        except IndexError:
            pass
    if channel == "reddit" and "/r/" in url:
        try:
            return "r/" + url.split("/r/", 1)[1].split("/", 1)[0]
        except IndexError:
            pass
    return channel
