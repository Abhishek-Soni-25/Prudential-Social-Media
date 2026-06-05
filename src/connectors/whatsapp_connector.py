"""WhatsApp connector — deliberate stub.

WhatsApp messages are **end-to-end encrypted**; no API can read third-party chats. There
is no legitimate way to surveil arbitrary WhatsApp conversations, and this project will not
attempt it.

Legitimate internal monitoring options for a regulated firm:
  1. WhatsApp Business API — for the firm's **own** consented business numbers only.
  2. A consented compliance-archiving vendor (e.g. Smarsh, Theta Lake) capturing employees'
     business WhatsApp under explicit policy/consent.

Both surface as an authorized archive feed. Set WHATSAPP_ARCHIVE_ENDPOINT /
WHATSAPP_ARCHIVE_TOKEN and implement `_poll_archive()` to map records onto `Post` objects;
the rest of the pipeline then works unchanged.
"""

from __future__ import annotations

import logging

from ..config import env
from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)


class WhatsAppConnector(BaseConnector):
    channel = "whatsapp"

    def setup(self) -> None:
        self._endpoint = env("WHATSAPP_ARCHIVE_ENDPOINT")
        self._token = env("WHATSAPP_ARCHIVE_TOKEN")
        if not (self._endpoint and self._token):
            raise ConnectorUnavailable(
                "WhatsApp is end-to-end encrypted and has no surveillance API. Configure an "
                "authorized compliance-archive feed via WHATSAPP_ARCHIVE_ENDPOINT / "
                "WHATSAPP_ARCHIVE_TOKEN to enable this connector. See docs/architecture.md §6."
            )

    def poll(self) -> list[Post]:
        return self._poll_archive()

    def _poll_archive(self) -> list[Post]:
        raise ConnectorUnavailable(
            "WhatsApp archive feed endpoint configured but adapter not implemented. "
            "Map your vendor's records to Post objects in _poll_archive()."
        )
