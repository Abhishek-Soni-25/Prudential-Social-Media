"""LinkedIn connector — Prudential-focused, ToS-GATED scraper.

⚠️  IMPORTANT — READ BEFORE ENABLING
The unofficial `linkedin-api` library authenticates with a real LinkedIn account and
automates it. This VIOLATES LinkedIn's User Agreement and can lead to account suspension
and legal action. The compliant alternative is the official LinkedIn API (limited to pages
you administer) or a licensed third-party data provider (e.g. Proxycurl, Bright Data).

This connector therefore runs ONLY when ALL of the following are true:
  1. The `linkedin` channel is set to `mode: live` in config.yaml, AND
  2. env `LINKEDIN_TOS_ACK=true` (explicit acknowledgement of the risk), AND
  3. env `LINKEDIN_USERNAME` / `LINKEDIN_PASSWORD` are set.
Otherwise it raises ConnectorUnavailable and the orchestrator skips it.

Sources (config):
  - "company:<public-id>"   e.g. company:prudential-singapore  -> company page posts
  - "search:<query>"        e.g. search:Prudential Singapore   -> matching posts

Because the underlying library is unofficial and its method surface shifts between
versions, the fetch calls are defensive and best-effort; adapt `_fetch_company` /
`_fetch_search` to your installed `linkedin-api` version if methods differ.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..config import env
from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)


class LinkedInConnector(BaseConnector):
    channel = "linkedin"

    def setup(self) -> None:
        ack = (env("LINKEDIN_TOS_ACK") or "").lower() in ("1", "true", "yes")
        user = env("LINKEDIN_USERNAME")
        pwd = env("LINKEDIN_PASSWORD")
        if not ack:
            raise ConnectorUnavailable(
                "LinkedIn scraping is ToS-gated. It violates LinkedIn's User Agreement. "
                "Set LINKEDIN_TOS_ACK=true in .env to acknowledge the risk, or prefer a "
                "licensed data provider. See docs/architecture.md §6."
            )
        if not (user and pwd):
            raise ConnectorUnavailable(
                "LINKEDIN_USERNAME / LINKEDIN_PASSWORD not set in .env."
            )
        try:
            from linkedin_api import Linkedin
        except ImportError as exc:
            raise ConnectorUnavailable(
                "linkedin-api not installed. `pip install linkedin-api` (ToS-risk library)."
            ) from exc
        log.warning(
            "LinkedIn scraper ENABLED via unofficial linkedin-api — this violates LinkedIn "
            "ToS and risks the account '%s'. Proceeding per LINKEDIN_TOS_ACK.", user,
        )
        self._api = Linkedin(user, pwd)

    def poll(self) -> list[Post]:
        posts: list[Post] = []
        for source in self.sources:
            try:
                if source.startswith("company:"):
                    posts.extend(self._fetch_company(source.split("company:", 1)[1].strip()))
                elif source.startswith("search:"):
                    posts.extend(self._fetch_search(source.split("search:", 1)[1].strip()))
                else:
                    log.warning("LinkedIn: unsupported source '%s' (use company:/search:)", source)
            except Exception as exc:
                log.error("LinkedIn poll failed for %s: %s", source, exc)
        return posts

    # --- best-effort adapters (version-dependent) ----------------------------

    def _fetch_company(self, public_id: str) -> list[Post]:
        updates = []
        if hasattr(self._api, "get_company_updates"):
            updates = self._api.get_company_updates(public_id, max_results=self.max_items)
        else:
            log.warning("linkedin-api has no get_company_updates; adapt _fetch_company().")
        return [p for p in (self._map_update(u, f"company:{public_id}") for u in updates) if p]

    def _fetch_search(self, query: str) -> list[Post]:
        results = []
        if hasattr(self._api, "search"):
            results = self._api.search(
                {"keywords": query}, limit=self.max_items
            ) or []
        else:
            log.warning("linkedin-api has no search; adapt _fetch_search().")
        return [p for p in (self._map_update(r, f"search:{query}") for r in results) if p]

    def _map_update(self, raw: dict, source: str) -> Post | None:
        if not isinstance(raw, dict):
            return None
        # Defensive field extraction across library versions.
        text = (
            raw.get("commentary")
            or raw.get("text")
            or (raw.get("value", {}) or {}).get("text")
            or ""
        )
        if isinstance(text, dict):
            text = text.get("text", "")
        if not text:
            return None
        mid = str(raw.get("urn") or raw.get("id") or raw.get("entityUrn") or abs(hash(text)))
        ts_ms = raw.get("createdTime") or raw.get("created") or 0
        try:
            ts = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc) if ts_ms else datetime.now(timezone.utc)
        except (ValueError, OverflowError, TypeError):
            ts = datetime.now(timezone.utc)
        return Post(
            channel=self.channel,
            source=source,
            message_id=mid,
            author_id=str(raw.get("author") or raw.get("actor") or "unknown"),
            timestamp=ts,
            text=str(text),
            url=raw.get("url"),
            raw_meta={"scraped": True},
        )
