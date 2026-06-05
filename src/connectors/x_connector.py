"""X (Twitter) connector using API v2 via tweepy.

Uses recent search (``search:<query>``) or a user timeline (``@handle``). NOTE: recent
search and filtered streams require a **paid** X API tier — the free tier cannot read
arbitrary public posts. The code is real; enabling it requires a working bearer token
with the appropriate access level.
"""

from __future__ import annotations

import logging

from ..config import env
from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)


class XConnector(BaseConnector):
    channel = "x"

    def setup(self) -> None:
        bearer = env("X_BEARER_TOKEN")
        if not bearer:
            raise ConnectorUnavailable(
                "X_BEARER_TOKEN missing. Set it in .env. Note: recent search requires a "
                "paid X API tier."
            )
        try:
            import tweepy
        except ImportError as exc:  # pragma: no cover
            raise ConnectorUnavailable("tweepy not installed; pip install tweepy") from exc

        self._client = tweepy.Client(bearer_token=bearer, wait_on_rate_limit=True)

    def poll(self) -> list[Post]:
        posts: list[Post] = []
        for source in self.sources:
            try:
                posts.extend(self._poll_source(source))
            except Exception as exc:
                log.error("X poll failed for %s: %s", source, exc)
        return posts

    def _poll_source(self, source: str) -> list[Post]:
        last_seen = self.get_cursor(source)
        kwargs = dict(
            max_results=min(self.max_items, 100),
            tweet_fields=["created_at", "author_id", "lang"],
        )
        if last_seen:
            kwargs["since_id"] = last_seen

        if source.startswith("search:"):
            query = source.split("search:", 1)[1].strip()
            resp = self._client.search_recent_tweets(query=query, **kwargs)
        else:
            user = self._client.get_user(username=source.lstrip("@"))
            if not user.data:
                raise ConnectorUnavailable(f"X user not found: {source}")
            resp = self._client.get_users_tweets(id=user.data.id, **kwargs)

        tweets = resp.data or []
        out: list[Post] = []
        newest_id: str | None = None
        for tw in tweets:
            if newest_id is None:
                newest_id = str(tw.id)
            out.append(
                Post(
                    channel=self.channel,
                    source=source,
                    message_id=str(tw.id),
                    author_id=str(tw.author_id),
                    timestamp=tw.created_at,  # tz-aware
                    text=tw.text,
                    url=f"https://x.com/i/web/status/{tw.id}",
                    raw_meta={"lang": getattr(tw, "lang", None)},
                )
            )
        if newest_id:
            self.set_cursor(source, newest_id)
        return out
