"""Reddit / online-forum connector using the official Reddit API (PRAW).

Reads new submissions from configured subreddits, or search results when a source is
given as ``search:<query>``. Public content only — no logged-in scraping.
"""

from __future__ import annotations

import logging

from ..config import env
from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)


class RedditConnector(BaseConnector):
    channel = "reddit"

    def setup(self) -> None:
        client_id = env("REDDIT_CLIENT_ID")
        client_secret = env("REDDIT_CLIENT_SECRET")
        user_agent = env("REDDIT_USER_AGENT")
        if not (client_id and client_secret and user_agent):
            raise ConnectorUnavailable(
                "Reddit credentials missing. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, "
                "and REDDIT_USER_AGENT in .env."
            )
        try:
            import praw  # imported lazily so the package isn't required when disabled
        except ImportError as exc:  # pragma: no cover
            raise ConnectorUnavailable("praw not installed; pip install praw") from exc

        self._reddit = praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent=user_agent,
            check_for_async=False,
        )
        self._reddit.read_only = True

    def poll(self) -> list[Post]:
        posts: list[Post] = []
        for source in self.sources:
            try:
                posts.extend(self._poll_source(source))
            except Exception as exc:  # one bad source shouldn't kill the cycle
                log.error("Reddit poll failed for %s: %s", source, exc)
        return posts

    def _poll_source(self, source: str) -> list[Post]:
        if source.startswith("search:"):
            query = source.split("search:", 1)[1].strip()
            submissions = self._reddit.subreddit("all").search(
                query, sort="new", limit=self.max_items
            )
            label = source
        else:
            submissions = self._reddit.subreddit(source).new(limit=self.max_items)
            label = source

        last_seen = self.get_cursor(label)
        out: list[Post] = []
        newest: str | None = None
        for sub in submissions:
            if newest is None:
                newest = sub.id  # listings are newest-first
            if last_seen and sub.id == last_seen:
                break
            body = sub.selftext or ""
            text = f"{sub.title}\n\n{body}".strip()
            if not text:
                continue
            out.append(
                Post(
                    channel=self.channel,
                    source=label,
                    message_id=sub.id,
                    author_id=str(sub.author) if sub.author else "[deleted]",
                    timestamp=_utc(sub.created_utc),
                    text=text,
                    url=f"https://reddit.com{sub.permalink}",
                    raw_meta={"subreddit": str(sub.subreddit), "score": sub.score},
                )
            )
        if newest:
            self.set_cursor(label, newest)
        return out


def _utc(epoch: float):
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch, tz=timezone.utc)
