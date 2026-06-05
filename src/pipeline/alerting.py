"""Step 4 — Real-time alerting & thresholds.

Maps a `RiskAssessment` to an alert tier using config-driven minimum-confidence gates.
The classifier proposes a severity; alerting confirms or downgrades it based on confidence
so low-confidence high-severity guesses don't trigger immediate escalation.
"""

from __future__ import annotations

from ..models import RiskAssessment

# Alert tiers
HIGH = "HIGH"
MEDIUM = "MEDIUM"
LOW = "LOW"
NONE = "NONE"

URGENCY = {HIGH: "Immediate", MEDIUM: "Priority", LOW: "Routine", NONE: "None"}


def decide_alert(assessment: RiskAssessment, thresholds: dict) -> str:
    """Return the alert tier (HIGH | MEDIUM | LOW | NONE)."""
    if not assessment.is_risk:
        return NONE

    hi = thresholds.get("high_min_confidence", 0.70)
    md = thresholds.get("medium_min_confidence", 0.55)
    lo = thresholds.get("low_min_confidence", 0.40)

    sev = assessment.severity
    conf = assessment.confidence

    if sev == HIGH and conf >= hi:
        return HIGH
    # A HIGH-severity but lower-confidence hit is still worth a priority review.
    if sev == HIGH and conf >= md:
        return MEDIUM
    if sev == MEDIUM and conf >= md:
        return MEDIUM
    if conf >= lo:
        return LOW
    return NONE


def urgency_for(tier: str) -> str:
    return URGENCY.get(tier, "None")
