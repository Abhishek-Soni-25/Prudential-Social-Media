"""Integrated case management.

For every HIGH/MEDIUM alert, builds a structured `CaseFile` (unique id, platform source,
timestamp, raw content, risk category, sentiment, confidence, urgency, RACM/KRI refs) and
persists it as JSON under data/cases/. Also handles retention purging.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta, timezone

from .config import CASES_DIR
from .models import CaseFile, Post, RiskAssessment, SentimentResult
from .pipeline.alerting import urgency_for

log = logging.getLogger(__name__)

_seq = 0


def _next_case_id(category: str) -> str:
    """Human-readable, time-ordered, collision-resistant id."""
    global _seq
    _seq += 1
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    return f"CASE-{category[:3]}-{stamp}-{_seq:03d}"


def build_case(
    post: Post,
    sentiment: SentimentResult,
    assessment: RiskAssessment,
    tier: str,
    racm_mapping: dict,
    hash_author: bool = True,
) -> CaseFile:
    mapping = racm_mapping.get(assessment.category, {})
    author_ref = post.author_pseudonym() if hash_author else post.author_id
    return CaseFile(
        case_id=_next_case_id(assessment.category),
        platform=post.channel,
        source=post.source,
        timestamp=post.timestamp.isoformat(),
        author_ref=author_ref,
        raw_content=post.text,
        risk_category=assessment.category,
        severity=assessment.severity,
        sentiment_polarity=sentiment.polarity,
        sentiment_score=sentiment.compound_score,
        confidence=assessment.confidence,
        rationale=assessment.rationale,
        indicators=assessment.indicators,
        mitigation_urgency=urgency_for(tier),
        racm_ref=mapping.get("racm_ref", "UNMAPPED"),
        kri_ref=mapping.get("kri_ref", "UNMAPPED"),
        url=post.url,
    )


def persist_case(case: CaseFile) -> str:
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    path = CASES_DIR / f"{case.case_id}.json"
    path.write_text(json.dumps(case.to_dict(), indent=2), encoding="utf-8")
    log.info("Case written: %s (%s/%s)", case.case_id, case.risk_category, case.severity)
    return str(path)


def purge_expired(retention_days: int) -> int:
    """Delete case files older than the retention window. Returns count purged."""
    if not retention_days or retention_days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    purged = 0
    for f in CASES_DIR.glob("CASE-*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            created = datetime.fromisoformat(data.get("created_at"))
            if created < cutoff:
                f.unlink()
                purged += 1
        except (OSError, ValueError, json.JSONDecodeError):
            continue
    if purged:
        log.info("Retention purge removed %d expired case(s).", purged)
    return purged
