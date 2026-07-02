"""Mentions store — a lightweight log of EVERY analysed item (not just flagged cases).

Flagged HIGH/MEDIUM items become case files (case_management.py) for the audit trail. But the
dashboard also needs the full picture: sentiment per platform, and how many times each account
has posted about a keyword. Persisting only cases would miss all the neutral/positive/low items.

So each analysed post is appended here as one compact JSON line with only the fields the UI
uses. De-duplicated by (platform, id). File: data/mentions.jsonl.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from .config import DATA_DIR
from .models import Post, RiskAssessment

log = logging.getLogger(__name__)

_PATH = DATA_DIR / "mentions.jsonl"


def _key(platform: str, mid: str) -> str:
    return f"{platform}::{mid}"


def load_mentions() -> list[dict[str, Any]]:
    """All mentions, newest first, de-duplicated by (platform, id) keeping the latest."""
    if not _PATH.exists():
        return []
    by_key: dict[str, dict] = {}
    for line in _PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        by_key[_key(rec.get("platform", ""), rec.get("id", ""))] = rec
    out = list(by_key.values())
    out.sort(key=lambda r: r.get("analysed_at", ""), reverse=True)
    return out


def record_mention(post: Post, assessment: RiskAssessment) -> dict[str, Any]:
    """Append a normalised mention record and return it."""
    meta = post.raw_meta or {}
    rec = {
        "id": post.message_id,
        "platform": post.channel,
        "provider": meta.get("provider"),
        "author": meta.get("author_name") or post.author_id,
        "author_url": meta.get("author_url"),
        "url": post.url,                     # permalink — click to open & verify
        "text": post.text,
        "keyword": meta.get("keyword"),
        "engagement": meta.get("engagement") or {},
        "sentiment": assessment.sentiment,   # positive | neutral | negative
        "risk_category": assessment.category,
        "severity": assessment.severity,
        "confidence": assessment.confidence,
        "rationale": assessment.rationale,
        "indicators": assessment.indicators,
        "timestamp": post.timestamp.isoformat(),
        "analysed_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with _PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError as exc:
        log.warning("Could not append mention: %s", exc)
    return rec


def author_activity(platform: str | None = None) -> list[dict[str, Any]]:
    """Per-account post counts about the monitored keyword, most active first.

    Answers: "how many times has this account posted about the keyword?" — with a
    sentiment split and the account's most recent post so it can be opened for verification.
    """
    agg: dict[tuple[str, str], dict[str, Any]] = {}
    for m in load_mentions():
        if platform and m.get("platform") != platform:
            continue
        author = (m.get("author") or "unknown").strip() or "unknown"
        gkey = (m.get("platform", ""), author)
        a = agg.setdefault(gkey, {
            "author": author,
            "platform": m.get("platform"),
            "author_url": m.get("author_url"),
            "posts": 0,
            "negative": 0, "neutral": 0, "positive": 0,
            "flagged": 0,
            "latest_url": None,
            "latest_at": "",
        })
        a["posts"] += 1
        a[m.get("sentiment", "neutral")] = a.get(m.get("sentiment", "neutral"), 0) + 1
        if m.get("severity") in ("HIGH", "MEDIUM"):
            a["flagged"] += 1
        if m.get("timestamp", "") >= a["latest_at"]:
            a["latest_at"] = m.get("timestamp", "")
            a["latest_url"] = m.get("url")
    out = list(agg.values())
    out.sort(key=lambda a: a["posts"], reverse=True)
    return out


def platform_sentiment() -> dict[str, dict[str, int]]:
    """Sentiment counts per platform: {platform: {positive, neutral, negative, total}}."""
    out: dict[str, dict[str, int]] = {}
    for m in load_mentions():
        p = m.get("platform", "unknown")
        d = out.setdefault(p, {"positive": 0, "neutral": 0, "negative": 0, "total": 0})
        d[m.get("sentiment", "neutral")] = d.get(m.get("sentiment", "neutral"), 0) + 1
        d["total"] += 1
    return out
