"""Shared data models passed between pipeline stages.

These keep the pipeline channel-agnostic: every connector normalizes its platform
payload into a `Post`, and everything downstream operates on these structures.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional


# --- Controlled vocabularies -------------------------------------------------

RISK_CATEGORIES = (
    "REPUTATIONAL",
    "COMPLIANCE_CONDUCT",
    "MARKET_ABUSE",
    "CYBER_OPERATIONAL",
    "NONE",
)
SEVERITIES = ("HIGH", "MEDIUM", "LOW", "NONE")
POLARITIES = ("Positive", "Neutral", "Negative", "Mixed")


# --- Ingested content --------------------------------------------------------

@dataclass
class Post:
    """A single normalized item of content from any channel."""

    channel: str            # telegram | reddit | x | linkedin | whatsapp
    source: str             # the specific channel/subreddit/query it came from
    message_id: str         # platform-unique id (used for de-duplication / cursors)
    author_id: str          # platform author identifier (pseudonymized downstream)
    timestamp: datetime     # tz-aware UTC time the content was created
    text: str               # cleaned text content
    url: Optional[str] = None
    raw_meta: dict[str, Any] = field(default_factory=dict)

    def author_pseudonym(self) -> str:
        """Stable SHA-256 pseudonym for the author (PII minimization)."""
        digest = hashlib.sha256(f"{self.channel}:{self.author_id}".encode()).hexdigest()
        return digest[:16]


# --- Analysis results --------------------------------------------------------

@dataclass
class SentimentResult:
    polarity: str           # one of POLARITIES
    compound_score: float   # VADER compound, -1.0 .. +1.0


@dataclass
class RiskAssessment:
    is_risk: bool
    category: str           # one of RISK_CATEGORIES
    severity: str           # one of SEVERITIES
    confidence: float       # 0.0 .. 1.0
    rationale: str
    indicators: list[str] = field(default_factory=list)


# --- Case file ---------------------------------------------------------------

@dataclass
class CaseFile:
    case_id: str
    platform: str
    source: str
    timestamp: str          # ISO-8601 of the originating content
    author_ref: str         # pseudonym or raw id depending on privacy config
    raw_content: str
    risk_category: str
    severity: str
    sentiment_polarity: str
    sentiment_score: float
    confidence: float
    rationale: str
    indicators: list[str]
    mitigation_urgency: str  # Immediate | Priority | Routine
    racm_ref: str
    kri_ref: str
    url: Optional[str] = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
