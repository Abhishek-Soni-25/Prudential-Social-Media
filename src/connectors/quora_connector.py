"""Quora connector — deliberate stub.

Quora has no public monitoring API, gates most content behind login, and actively blocks
automated scraping (its ToS prohibit it). A reliable, compliant Quora scraper is not
practical, so this connector does not attempt one.

Legitimate options for monitoring Quora mentions of the target:
  1. A licensed social-listening / web-data provider that includes Quora (e.g. Brandwatch,
     Talkwalker, Bright Data) — exposed here as an authorized feed endpoint.
  2. Manual analyst review fed into the case system.

Run this channel in `mode: demo` for the prototype. To wire a licensed feed, set
QUORA_FEED_ENDPOINT / QUORA_FEED_TOKEN and implement `_poll_feed()` to map records onto
`Post` objects; the rest of the pipeline then works unchanged.
"""

from __future__ import annotations

import logging

from ..config import env
from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)


class QuoraConnector(BaseConnector):
    channel = "quora"

    def setup(self) -> None:
        self._endpoint = env("QUORA_FEED_ENDPOINT")
        self._token = env("QUORA_FEED_TOKEN")
        if not (self._endpoint and self._token):
            raise ConnectorUnavailable(
                "Quora has no API and blocks scraping. Configure a licensed social-listening "
                "feed via QUORA_FEED_ENDPOINT / QUORA_FEED_TOKEN, or run quora in mode: demo."
            )

    def poll(self) -> list[Post]:
        return self._poll_feed()

    def _poll_feed(self) -> list[Post]:
        raise ConnectorUnavailable(
            "Quora feed endpoint configured but adapter not implemented. Map your provider's "
            "records to Post objects in _poll_feed()."
        )
