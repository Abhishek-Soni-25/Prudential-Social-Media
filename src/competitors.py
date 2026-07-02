"""Competitor Share-of-Voice collection (PRD 6.6).

For each competitor keyword, run the configured Apify/Bright Data connectors, count the
mentions and score their sentiment with Groq (no risk mapping — SoV only). Results are
aggregated per competitor and stored so the dashboard reads them without re-scanning.

Prudential's own totals are read from the mentions store, so the benchmark is apples-to-apples.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .config import DATA_DIR
from .connectors import ApifyConnector, BrightDataConnector, ConnectorUnavailable
from .pipeline import ingest
from . import mentions as mentions_store

log = logging.getLogger(__name__)

_PATH = DATA_DIR / "competitors.json"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _build_connector(channel: str, keyword: str, cfg: dict, state_key: str):
    """One connector for a single competitor keyword on a single channel."""
    max_items = cfg.get("competitors", {}).get("max_items", 5)
    ch_cfg = cfg.get("channels", {}).get(channel, {})
    mode = ch_cfg.get("mode")
    if mode == "brightdata":
        bd = cfg.get("brightdata", {})
        return BrightDataConnector(
            channel=channel,
            dataset_id=bd.get("datasets", {}).get(ch_cfg.get("dataset", channel), ""),
            keywords=[keyword],
            extra_input=ch_cfg.get("extra_input", {}),
            max_items=max_items,
            poll_timeout=bd.get("poll_timeout_seconds", 300),
            state_key=state_key,
        )
    if mode == "apify":
        ap = cfg.get("apify", {})
        actor = ap.get("actors", {}).get(ch_cfg.get("actor", channel), {})
        return ApifyConnector(
            channel=channel,
            actor_id=actor.get("id", ""),
            keywords=[keyword],
            keyword_field=actor.get("keyword_field", "keywords"),
            keyword_as_list=actor.get("keyword_as_list", True),
            input_template=actor.get("input_template", {}),
            secret_inputs=actor.get("secret_inputs", {}),
            max_items=max_items,
            timeout=ap.get("run_timeout_seconds", 300),
            state_key=state_key,
        )
    return None


def _blank() -> dict[str, Any]:
    return {"total": 0, "positive": 0, "neutral": 0, "negative": 0, "by_platform": {}}


def run_competitor_scan(cfg: dict, classifier) -> dict[str, Any]:
    """Collect + sentiment-score competitor mentions, then persist and return the SoV table."""
    comp_cfg = cfg.get("competitors", {})
    channels = comp_cfg.get("channels", [])
    results: dict[str, Any] = {}

    for comp in comp_cfg.get("set", []):
        name, keyword = comp.get("name"), comp.get("keyword")
        if not name or not keyword:
            continue
        agg = _blank()
        for channel in channels:
            state_key = f"cmp_{_slug(name)}_{channel}"
            connector = _build_connector(channel, keyword, cfg, state_key)
            if connector is None:
                continue
            try:
                connector.setup()
                posts = connector.poll()
            except ConnectorUnavailable as exc:
                log.warning("Competitor %s/%s unavailable: %s", name, channel, exc)
                continue
            except Exception as exc:  # noqa: BLE001
                log.error("Competitor %s/%s poll error: %s", name, channel, exc)
                continue
            for post in posts:
                cleaned = ingest.clean_post(post)
                if cleaned is None:
                    continue
                sentiment = classifier.classify(cleaned).sentiment
                agg["total"] += 1
                agg[sentiment] = agg.get(sentiment, 0) + 1
                agg["by_platform"][channel] = agg["by_platform"].get(channel, 0) + 1
            log.info("Competitor %s/%s: %d items", name, channel, agg["by_platform"].get(channel, 0))
        results[name] = agg

    payload = {"prudential": _prudential_totals(), "competitors": results}
    try:
        _PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as exc:
        log.warning("Could not persist competitor SoV: %s", exc)
    return payload


def _prudential_totals() -> dict[str, Any]:
    agg = _blank()
    for m in mentions_store.load_mentions():
        agg["total"] += 1
        agg[m.get("sentiment", "neutral")] = agg.get(m.get("sentiment", "neutral"), 0) + 1
        p = m.get("platform", "?")
        agg["by_platform"][p] = agg["by_platform"].get(p, 0) + 1
    return agg


def load_competitor_sov() -> dict[str, Any]:
    if not _PATH.exists():
        return {"prudential": _prudential_totals(), "competitors": {}}
    try:
        data = json.loads(_PATH.read_text(encoding="utf-8"))
        data["prudential"] = _prudential_totals()  # keep Prudential fresh from the store
        return data
    except (json.JSONDecodeError, OSError):
        return {"prudential": _prudential_totals(), "competitors": {}}
