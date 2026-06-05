"""Target relevance filter.

Every channel is narrowed to content about the monitored organization (e.g. Prudential
Singapore). A post is relevant if:
  - its text mentions any configured alias (case-insensitive), OR
  - it originates from an official handle / first-party source, OR
  - it arrived from a search query that already targeted the org (source starts "search:"
    or "company:").

This keeps generic channel feeds (a subreddit, a Telegram channel) focused on the target
without each connector needing its own filtering logic.
"""

from __future__ import annotations

from ..models import Post


def is_relevant(post: Post, target: dict) -> bool:
    if not target or not target.get("require_relevance", False):
        return True

    aliases = [a.lower() for a in target.get("aliases", []) if a]
    handles = [h.lower().lstrip("@") for h in target.get("official_handles", []) if h]

    # Search/company sources are already scoped to the target by the platform query.
    src = (post.source or "").lower()
    if src.startswith("search:") or src.startswith("company:") or src.startswith("demo:"):
        return True

    # First-party content.
    author = (post.author_id or "").lower().lstrip("@")
    if author in handles or any(h in src for h in handles):
        return True

    # Alias mention in the content itself.
    text = (post.text or "").lower()
    return any(a in text for a in aliases)
