"""Telegram connector using Telethon (MTProto).

Reads recent messages from public channels/groups listed in config. You must already be
able to view these (public channels, or groups your account has joined). On first run
Telethon prompts interactively for the login code sent to your phone, then persists a
session file so subsequent runs are non-interactive.
"""

from __future__ import annotations

import asyncio
import logging

from ..config import env, STATE_DIR
from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)


class TelegramConnector(BaseConnector):
    channel = "telegram"

    def setup(self) -> None:
        api_id = env("TELEGRAM_API_ID")
        api_hash = env("TELEGRAM_API_HASH")
        phone = env("TELEGRAM_PHONE")
        if not (api_id and api_hash and phone):
            raise ConnectorUnavailable(
                "Telegram credentials missing. Set TELEGRAM_API_ID, TELEGRAM_API_HASH "
                "and TELEGRAM_PHONE in .env (get api_id/api_hash at https://my.telegram.org)."
            )
        try:
            from telethon.sync import TelegramClient
        except ImportError as exc:  # pragma: no cover
            raise ConnectorUnavailable("telethon not installed; pip install telethon") from exc

        self._phone = phone
        session_path = str(STATE_DIR / "telegram.session")
        # Telethon needs its own event loop; we drive it synchronously per poll.
        self._loop = asyncio.new_event_loop()
        self._client = TelegramClient(session_path, int(api_id), api_hash, loop=self._loop)
        self._loop.run_until_complete(self._client.start(phone=phone))

    def poll(self) -> list[Post]:
        return self._loop.run_until_complete(self._poll_async())

    async def _poll_async(self) -> list[Post]:
        posts: list[Post] = []
        for source in self.sources:
            try:
                posts.extend(await self._poll_source(source))
            except Exception as exc:
                log.error("Telegram poll failed for %s: %s", source, exc)
        return posts

    async def _poll_source(self, source: str) -> list[Post]:
        last_seen = self.get_cursor(source)
        min_id = int(last_seen) if last_seen and last_seen.isdigit() else 0
        out: list[Post] = []
        newest_id = min_id
        entity = await self._client.get_entity(source)
        async for msg in self._client.iter_messages(
            entity, limit=self.max_items, min_id=min_id
        ):
            if not msg.message:
                continue
            newest_id = max(newest_id, msg.id)
            out.append(
                Post(
                    channel=self.channel,
                    source=source,
                    message_id=str(msg.id),
                    author_id=str(msg.sender_id) if msg.sender_id else "unknown",
                    timestamp=msg.date,  # tz-aware UTC from Telethon
                    text=msg.message,
                    url=f"https://t.me/{source.lstrip('@')}/{msg.id}",
                    raw_meta={"views": getattr(msg, "views", None)},
                )
            )
        if newest_id > min_id:
            self.set_cursor(source, str(newest_id))
        return out

    def close(self) -> None:
        try:
            if getattr(self, "_client", None):
                self._loop.run_until_complete(self._client.disconnect())
        finally:
            if getattr(self, "_loop", None):
                self._loop.close()
