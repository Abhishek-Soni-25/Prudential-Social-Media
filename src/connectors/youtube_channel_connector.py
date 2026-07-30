"""YouTube channel connector — first-party videos from a specific channel.

Unlike the keyword-discovery datasets, this connector monitors ONE channel's own uploads
(e.g. Prudential Singapore's official channel, @PrudentialSingapore). It:

  1. resolves the @handle to a channelId from the channel page,
  2. reads the channel's public RSS feed (last ~15 uploads with titles + publish dates),
  3. emits a Post per video (marked as first-party so it passes the relevance filter).

The spoken content is transcribed downstream by ``media_enrich`` (via youtube-transcript-api),
so each video's sentiment reflects what was actually said, not just the title. No API key or
paid provider is required — the channel page and RSS feed are public.
"""

from __future__ import annotations

import logging
import re
import urllib.request
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (compatible; PrudentialSurveillance/1.0)"
_CHANNEL_ID = re.compile(r'"(?:channelId|externalId)":"(UC[0-9A-Za-z_-]{22})"')
_ATOM = "{http://www.w3.org/2005/Atom}"
_YT = "{http://www.youtube.com/xml/schemas/2015}"


class YouTubeChannelConnector(BaseConnector):
    """Monitor a single YouTube channel's uploads (config: mode: youtube_channel)."""

    def __init__(self, channel: str, handle: str, max_items: int = 25,
                 state_key: str | None = None) -> None:
        self.channel = channel
        super().__init__(sources=[handle], max_items=max_items, state_key=state_key)
        self._handle = (handle or "").strip()
        self._channel_id: str | None = None

    def setup(self) -> None:
        if not self._handle:
            raise ConnectorUnavailable("No YouTube handle configured (channels.*.handle).")
        self._channel_id = self._resolve_channel_id(self._handle)
        if not self._channel_id:
            raise ConnectorUnavailable(f"Could not resolve YouTube channel id for {self._handle}.")

    def _get(self, url: str, limit: int = 4_000_000) -> str:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read(limit).decode("utf-8", "ignore")

    def _resolve_channel_id(self, handle: str) -> str | None:
        h = handle if handle.startswith("@") else "@" + handle
        for url in (f"https://www.youtube.com/{h}", f"https://www.youtube.com/{h}/videos"):
            try:
                m = _CHANNEL_ID.search(self._get(url))
                if m:
                    return m.group(1)
            except Exception as exc:  # noqa: BLE001
                log.info("youtube channel resolve failed (%s): %s", url, exc)
        return None

    def poll(self) -> list[Post]:
        feed = f"https://www.youtube.com/feeds/videos.xml?channel_id={self._channel_id}"
        try:
            xml = self._get(feed)
            root = ET.fromstring(xml)
        except Exception as exc:  # noqa: BLE001
            raise ConnectorUnavailable(f"YouTube RSS fetch failed: {exc}") from exc

        seen = self.get_cursor("ids")
        import json
        seen_ids = set(json.loads(seen)) if seen else set()

        out: list[Post] = []
        for entry in root.findall(f"{_ATOM}entry"):
            vid = (entry.findtext(f"{_YT}videoId") or "").strip()
            title = (entry.findtext(f"{_ATOM}title") or "").strip()
            published = (entry.findtext(f"{_ATOM}published") or "").strip()
            link_el = entry.find(f"{_ATOM}link")
            url = link_el.get("href") if link_el is not None else (f"https://www.youtube.com/watch?v={vid}" if vid else None)
            if not vid or vid in seen_ids:
                continue
            seen_ids.add(vid)
            out.append(Post(
                channel=self.channel,
                source=f"company:{self._handle.lstrip('@')}",   # first-party -> always relevant
                message_id=vid,
                author_id=self._handle.lstrip("@"),
                timestamp=_parse_ts(published),
                text=title,                                      # transcript folded in by media_enrich
                url=url,
                raw_meta={
                    "provider": "youtube_channel",
                    "author_name": self._handle,
                    "author_url": f"https://www.youtube.com/{self._handle}",
                    "keyword": None,
                    "engagement": {},
                    "is_video": True,
                },
            ))
            if len(out) >= self.max_items:
                break

        self.set_cursor("ids", json.dumps(list(seen_ids)[-2000:]))
        return out


def _parse_ts(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)
