"""Orchestrator / entry point.

Wires the pipeline together:
    poll -> ingest -> sentiment -> classify -> alert -> case -> escalate

Usage:
    python -m src.main --once       # one polling cycle then exit
    python -m src.main               # continuous loop
    python -m src.main --config path/to/config.yaml
"""

from __future__ import annotations

import argparse
import logging
import time

from .config import load_config
from datetime import datetime, timezone
from .connectors import (
    CONNECTOR_REGISTRY,
    ConnectorUnavailable,
    DemoConnector,
    N8nConnector,
    BrightDataConnector,
    ApifyConnector,
    YouTubeChannelConnector,
)
from .pipeline import ingest, sentiment as sentiment_mod, alerting, relevance
from .pipeline.risk_classifier import RiskClassifier
from . import case_management
from . import mentions as mentions_store
from . import media_enrich
from .escalation import Escalation

log = logging.getLogger("surveillance")


def _keywords_for(ch_cfg: dict, cfg: dict) -> list[str]:
    """Per-channel keywords, or the shared default keyword list, or the target aliases —
    always merged with user-added custom keywords from the Campaign page."""
    from . import keywords as kw_store
    base = (
        ch_cfg.get("keywords")
        or cfg.get("keywords")
        or cfg.get("target", {}).get("aliases", [])
    )
    return kw_store.merged(base)


def _parse_date(value, end_of_day: bool = False):
    """Parse a YYYY-MM-DD (or ISO) config value into a tz-aware UTC datetime, or None."""
    if not value:
        return None
    try:
        s = str(value).strip()
        dt = datetime.fromisoformat(s.replace("Z", "+00:00")) if ("T" in s or ":" in s) else datetime.strptime(s, "%Y-%m-%d")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if end_of_day and "T" not in s and ":" not in s:
            dt = dt.replace(hour=23, minute=59, second=59)
        return dt
    except (ValueError, TypeError):
        return None


def _within_window(ts, since, until) -> bool:
    """True if ``ts`` falls within [since, until]. Open-ended when a bound is None."""
    if ts is None:
        return True
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    if since and ts < since:
        return False
    if until and ts > until:
        return False
    return True


def build_connectors(cfg: dict):
    connectors = []
    max_items = cfg.get("max_items_per_poll", 25)
    for name, ch_cfg in cfg.get("channels", {}).items():
        if not ch_cfg.get("enabled"):
            continue
        mode = ch_cfg.get("mode", "live")
        if mode == "demo":
            connector = DemoConnector(
                channel=name, sources=ch_cfg.get("sources", []), max_items=max_items
            )
        elif mode == "n8n":
            connector = N8nConnector(
                channel=name,
                webhook_url=cfg.get("n8n", {}).get("webhook_url", ""),
                max_items=max_items,
            )
        elif mode == "brightdata":
            bd = cfg.get("brightdata", {})
            dataset_key = ch_cfg.get("dataset", name)
            connector = BrightDataConnector(
                channel=name,
                dataset_id=bd.get("datasets", {}).get(dataset_key, ""),
                keywords=_keywords_for(ch_cfg, cfg),
                keyword_field=ch_cfg.get("keyword_field", "keyword"),
                extra_input=ch_cfg.get("extra_input", {}),
                max_items=max_items,
                poll_timeout=bd.get("poll_timeout_seconds", 180),
            )
        elif mode == "apify":
            ap = cfg.get("apify", {})
            actor_key = ch_cfg.get("actor", name)
            actor_cfg = ap.get("actors", {}).get(actor_key, {})
            first_party = ch_cfg.get("first_party", False)
            # First-party channels pass an explicit input (e.g. the channel URL) and must
            # NOT be mixed with the user's campaign keywords.
            kw = ch_cfg.get("keywords", []) if first_party else _keywords_for(ch_cfg, cfg)
            connector = ApifyConnector(
                channel=name,
                actor_id=actor_cfg.get("id", ""),
                keywords=kw,
                keyword_field=actor_cfg.get("keyword_field", "keywords"),
                keyword_as_list=actor_cfg.get("keyword_as_list", True),
                input_template=actor_cfg.get("input_template", {}),
                secret_inputs=actor_cfg.get("secret_inputs", {}),
                max_items=max_items,
                timeout=ap.get("run_timeout_seconds", 300),
                first_party=first_party,
            )
        elif mode == "youtube_channel":
            connector = YouTubeChannelConnector(
                channel=name,
                handle=ch_cfg.get("handle", ""),
                max_items=max_items,
            )
        else:
            cls = CONNECTOR_REGISTRY.get(name)
            if not cls:
                log.warning("Unknown channel '%s' in config; skipping.", name)
                continue
            connector = cls(sources=ch_cfg.get("sources", []), max_items=max_items)
        try:
            connector.setup()
            connectors.append(connector)
            log.info(
                "Connector ready: %s [%s] (%d source(s))",
                name, mode, len(connector.sources),
            )
        except ConnectorUnavailable as exc:
            log.warning("Connector '%s' unavailable: %s", name, exc)
    return connectors


def run_cycle(connectors, classifier, escalation, cfg) -> dict:
    thresholds = cfg.get("thresholds", {})
    racm_mapping = cfg.get("racm_mapping", {})
    hash_author = cfg.get("privacy", {}).get("hash_author_ids", True)
    target = cfg.get("target", {})

    # Collection window (e.g. the last 3 months). Items outside it are dropped so the
    # knowledge base only holds the requested period. Also caps how many videos/reels
    # are transcribed per scan (the most expensive step).
    coll = cfg.get("collection", {})
    since = _parse_date(coll.get("since"))
    until = _parse_date(coll.get("until"), end_of_day=True)
    video_budget = {"left": int(coll.get("max_video_transcriptions", 40))}

    stats = {"ingested": 0, "filtered": 0, "analyzed": 0,
             "HIGH": 0, "MEDIUM": 0, "LOW": 0, "NONE": 0}

    for connector in connectors:
        try:
            posts = connector.poll()
        except Exception as exc:
            log.error("Poll error on %s: %s", connector.channel, exc)
            continue

        for post in posts:
            cleaned = ingest.clean_post(post)
            if cleaned is None:
                continue

            # Keep only content inside the configured collection window.
            if not _within_window(cleaned.timestamp, since, until):
                stats["filtered"] += 1
                continue
            stats["ingested"] += 1

            # Narrow to content about the monitored target before spending tokens.
            if not relevance.is_relevant(cleaned, target):
                stats["filtered"] += 1
                continue

            # Video / reel channels: fold a transcript of the spoken content into the
            # text so the sentiment/risk pass scores the clip, not just its caption.
            try:
                media_enrich.enrich_post(cleaned, cfg, video_budget)
            except Exception as exc:  # noqa: BLE001 — enrichment must never break a scan
                log.info("media enrichment skipped for %s: %s", cleaned.channel, exc)

            sent = sentiment_mod.analyze(cleaned.text)

            # Always analyze; the LLM is the real decision-maker. (The VADER score is
            # carried for context and could gate cost in a higher-volume deployment.)
            assessment = classifier.classify(cleaned)
            stats["analyzed"] += 1

            # Log every analysed item (powers per-platform sentiment + per-account counts).
            mentions_store.record_mention(cleaned, assessment)

            tier = alerting.decide_alert(assessment, thresholds)
            stats[tier] = stats.get(tier, 0) + 1

            if tier in ("HIGH", "MEDIUM"):
                case = case_management.build_case(
                    cleaned, sent, assessment, tier, racm_mapping, hash_author
                )
                case_management.persist_case(case)
                escalation.handle(case, tier)
            elif tier == "LOW":
                log.info(
                    "LOW: %s/%s %s (%.0f%%) - %s",
                    cleaned.channel, cleaned.source, assessment.category,
                    assessment.confidence * 100, assessment.rationale[:80],
                )
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Social media surveillance pipeline")
    parser.add_argument("--once", action="store_true", help="Run a single cycle then exit")
    parser.add_argument("--config", default=None, help="Path to config.yaml")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    cfg = load_config(args.config)

    # Retention purge on startup (privacy/compliance).
    case_management.purge_expired(cfg.get("privacy", {}).get("retention_days", 0))

    connectors = build_connectors(cfg)
    if not connectors:
        log.error("No connectors are enabled/available. Check config.yaml and .env.")
        return

    analysis_cfg = cfg.get("analysis", {})
    classifier = RiskClassifier(
        model=analysis_cfg.get("model"),
        models=analysis_cfg.get("models"),
        max_tokens=analysis_cfg.get("max_tokens", 1024),
        requests_per_minute=analysis_cfg.get("requests_per_minute", 5),
        max_retries=analysis_cfg.get("max_retries", 3),
        target_name=cfg.get("target", {}).get("name", "the organization"),
    )
    escalation = Escalation(cfg.get("escalation", {}))

    interval = cfg.get("poll_interval_seconds", 120)
    try:
        while True:
            log.info("--- polling cycle start ---")
            stats = run_cycle(connectors, classifier, escalation, cfg)
            log.info(
                "Cycle done: ingested=%(ingested)d filtered=%(filtered)d "
                "analyzed=%(analyzed)d HIGH=%(HIGH)d MEDIUM=%(MEDIUM)d "
                "LOW=%(LOW)d NONE=%(NONE)d", stats
            )
            if args.once:
                break
            time.sleep(interval)
    except KeyboardInterrupt:
        log.info("Interrupted; shutting down.")
    finally:
        for c in connectors:
            try:
                c.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
