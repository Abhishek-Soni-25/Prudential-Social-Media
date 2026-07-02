"""Apify connector — keyword-search Actors for LinkedIn, Instagram, Telegram and Quora.

An Apify *Actor* is a hosted scraper that takes a JSON input (including the search term) and
writes results to a dataset. We use the synchronous run endpoint, which starts the Actor,
waits for it to finish, and returns the dataset items in one call:

    POST https://api.apify.com/v2/acts/<actor_id>/run-sync-get-dataset-items?token=<token>
         body = <actor input JSON>
    -> [ {record}, {record}, ... ]

Every actor has its own input schema and its own output fields, so this module keeps a small
per-platform NORMALIZER that maps each actor's raw record onto the fields our platform
actually uses — nothing more:

    permalink (click-to-open), author handle + profile url (per-account counts),
    text (for Groq sentiment/risk), timestamp, and light engagement (likes/comments/views).

Actor ids and input templates live in config.yaml -> apify.actors (see docs/data-providers.md).
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from ..config import env
from ..models import Post
from .base import BaseConnector, ConnectorUnavailable

log = logging.getLogger(__name__)

_BASE = "https://api.apify.com/v2"


class ApifyConnector(BaseConnector):
    """Generic Apify Actor connector, normalised per channel.

    Config (config.yaml -> channels.<name> + apify.actors.<actor>):
        mode: apify
        actor: linkedin        # key into apify.actors
    """

    def __init__(
        self,
        channel: str,
        actor_id: str,
        keywords: list[str],
        keyword_field: str = "keywords",
        keyword_as_list: bool = True,
        input_template: dict | None = None,
        secret_inputs: dict[str, str] | None = None,
        max_items: int = 25,
        timeout: int = 300,
        state_key: str | None = None,
    ) -> None:
        self.channel = channel  # set before base builds its state path
        super().__init__(sources=keywords, max_items=max_items, state_key=state_key)
        self._actor_id = actor_id
        self._keyword_field = keyword_field
        self._keyword_as_list = keyword_as_list
        self._input_template = input_template or {}
        # secret_inputs: {actor_input_field: ENV_VAR_NAME} injected at run time from .env.
        self._secret_inputs = secret_inputs or {}
        self._timeout = timeout
        self._token: str | None = None

    def setup(self) -> None:
        self._token = env("APIFY_TOKEN")
        if not self._token:
            raise ConnectorUnavailable("Apify token missing. Set APIFY_TOKEN in .env.")
        if not self._actor_id:
            raise ConnectorUnavailable(
                f"No actor id configured for Apify channel '{self.channel}'."
            )
        if not self.sources:
            raise ConnectorUnavailable(
                f"No keywords configured for Apify channel '{self.channel}'."
            )

    def _http(self, method: str, url: str, body: dict | None = None) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "ignore")[:300]
            raise RuntimeError(f"HTTP {exc.code} {url.split('?')[0]}: {detail}") from exc

    def _run(self, actor_input: dict) -> list[dict]:
        # Async pattern: start the run, poll its status, then fetch the dataset. This avoids
        # holding a single connection open for the entire (possibly multi-minute) actor run.
        actor_path = self._actor_id.replace("/", "~")
        start = self._http(
            "POST", f"{_BASE}/acts/{actor_path}/runs?token={self._token}", actor_input
        )
        run = start.get("data", {}) if isinstance(start, dict) else {}
        run_id = run.get("id")
        dataset_id = run.get("defaultDatasetId")
        if not run_id or not dataset_id:
            raise RuntimeError(f"Apify run did not start cleanly: {start}")

        deadline = time.monotonic() + self._timeout
        status = run.get("status")
        while status in ("READY", "RUNNING", None) and time.monotonic() < deadline:
            time.sleep(5)
            info = self._http("GET", f"{_BASE}/actor-runs/{run_id}?token={self._token}")
            status = info.get("data", {}).get("status")
        if status != "SUCCEEDED":
            log.warning("Apify actor %s finished with status=%s", self._actor_id, status)

        items = self._http(
            "GET",
            f"{_BASE}/datasets/{dataset_id}/items?token={self._token}&clean=true",
        )
        return items if isinstance(items, list) else items.get("items", [])

    def _base_input(self) -> dict:
        actor_input = dict(self._input_template)
        for field, env_name in self._secret_inputs.items():
            val = env(env_name)
            if val:
                actor_input[field] = _maybe_json(val)
        return actor_input

    def poll(self) -> list[Post]:
        # Quora takes a single searchQuery string; the others take a keywords array.
        runs: list[dict] = []
        if self._keyword_as_list:
            actor_input = self._base_input()
            actor_input[self._keyword_field] = self.sources
            runs.append(actor_input)
        else:
            for kw in self.sources:
                actor_input = self._base_input()
                actor_input[self._keyword_field] = kw
                runs.append(actor_input)

        records: list[dict] = []
        for actor_input in runs:
            try:
                records.extend(self._run(actor_input))
            except Exception as exc:
                raise ConnectorUnavailable(f"Apify actor run failed: {exc}") from exc

        seen = self.get_cursor("ids")
        seen_ids: set[str] = set(json.loads(seen)) if seen else set()
        normalize = _NORMALIZERS.get(self.channel, _normalize_generic)

        out: list[Post] = []
        for rec in records:
            fields = normalize(rec)
            if not fields or not fields.get("text"):
                continue
            rid = str(fields.get("id") or fields.get("url") or fields["text"][:64])
            if rid in seen_ids:
                continue
            seen_ids.add(rid)
            out.append(_to_post(self.channel, rid, fields))
            if len(out) >= self.max_items:
                break

        self.set_cursor("ids", json.dumps(list(seen_ids)[-3000:]))
        return out


# --- per-platform normalizers: map raw actor record -> only the fields we use ------------

def _normalize_instagram(r: dict) -> dict:
    caption = (r.get("caption") or "").strip()
    tags = " ".join(f"#{h}" for h in (r.get("hashtags") or []))
    return {
        "id": r.get("post_url") or r.get("username"),
        "text": (caption + ("\n" + tags if tags else "")).strip(),
        "url": r.get("post_url"),
        "author": r.get("username"),
        "author_url": r.get("profile_url"),
        "timestamp": r.get("pub_date") or r.get("scraped_at"),
        "keyword": r.get("search_keyword"),
        "engagement": {"likes": r.get("like_count"), "comments": r.get("comment_count")},
    }


def _normalize_telegram(r: dict) -> dict:
    return {
        "id": r.get("id"),
        "text": (r.get("text") or "").strip(),
        "url": r.get("source_url"),          # t.me/s/<channel> page (keyword mode)
        "author": r.get("source_name"),
        "author_url": r.get("source_url"),
        "timestamp": r.get("date"),
        "keyword": r.get("search_keyword"),
        "engagement": {"views": r.get("view_count")},
    }


def _normalize_quora(r: dict) -> dict:
    # We only care about answer records (they carry the opinionated text).
    if r.get("type") and r.get("type") != "answer":
        return {}
    title = (r.get("questionTitle") or "").strip()
    body = (r.get("text") or "").strip()
    return {
        "id": r.get("answerId") or r.get("questionUrl"),
        "text": (title + "\n" + body).strip() if title else body,
        "url": r.get("questionUrl") or r.get("url"),
        "author": r.get("authorName"),
        "author_url": r.get("authorUrl"),
        "timestamp": r.get("createdAt"),
        "keyword": None,
        "engagement": {"upvotes": r.get("upvotes")},
    }


def _normalize_linkedin(r: dict) -> dict:
    # harvestapi/linkedin-post-search — full post content, author and engagement (no cookies).
    text = (r.get("commentary") or r.get("content") or r.get("text") or "").strip()
    url = r.get("linkedinUrl") or r.get("url") or r.get("post_url")
    author = r.get("author") if isinstance(r.get("author"), dict) else {}
    posted = r.get("postedAt") if isinstance(r.get("postedAt"), dict) else {}
    eng = r.get("engagement") if isinstance(r.get("engagement"), dict) else {}
    if not text and not url:
        return {}
    return {
        "id": r.get("id") or url,
        "text": text or url,          # fall back to url so the item stays clickable
        "url": url,
        "author": author.get("name") or author.get("publicIdentifier") or r.get("authorName"),
        "author_url": author.get("linkedinUrl") or r.get("authorUrl"),
        "timestamp": posted.get("date") or r.get("postedAt") or r.get("postedDate"),
        "keyword": None,
        "engagement": {
            "likes": eng.get("likes") or eng.get("reactions"),
            "comments": eng.get("comments"),
            "shares": eng.get("shares"),
        },
    }


def _normalize_generic(r: dict) -> dict:
    text = _first(r, ("text", "content", "caption", "message", "body", "title"))
    url = _first(r, ("url", "post_url", "link", "permalink"))
    return {
        "id": _first(r, ("id", "post_id")) or url,
        "text": (text or "").strip(),
        "url": url,
        "author": _first(r, ("author", "username", "authorName", "ownerUsername")),
        "author_url": _first(r, ("author_url", "profile_url", "authorUrl")),
        "timestamp": _first(r, ("timestamp", "date", "createdAt", "pub_date")),
        "keyword": _first(r, ("search_keyword", "keyword")),
        "engagement": {},
    }


_NORMALIZERS = {
    "instagram": _normalize_instagram,
    "telegram": _normalize_telegram,
    "quora": _normalize_quora,
    "linkedin": _normalize_linkedin,
}


# --- helpers -----------------------------------------------------------------------------

def _to_post(channel: str, rid: str, f: dict) -> Post:
    engagement = {k: v for k, v in (f.get("engagement") or {}).items() if v is not None}
    return Post(
        channel=channel,
        source="Apify",
        message_id=rid,
        author_id=str(f.get("author") or channel),
        timestamp=_parse_ts(f.get("timestamp")),
        text=f["text"],
        url=f.get("url") or None,
        raw_meta={
            "provider": "apify",
            "author_name": f.get("author"),
            "author_url": f.get("author_url"),
            "keyword": f.get("keyword"),
            "engagement": engagement,
        },
    )


def _first(rec: dict, keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = rec.get(k)
        if v:
            return str(v)
    return None


def _maybe_json(val: str):
    val = val.strip()
    if val.startswith("[") or val.startswith("{"):
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            pass
    return val


def _parse_ts(value) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return datetime.now(timezone.utc)
