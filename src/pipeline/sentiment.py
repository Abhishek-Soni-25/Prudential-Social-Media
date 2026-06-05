"""Step 2a — fast local sentiment pre-pass (VADER).

This is a cheap, network-free first-order signal used for triage and to enrich case
files. The nuanced, context/sarcasm-aware judgement happens in the LLM risk classifier
(Step 2b/3); VADER alone is intentionally NOT used to make risk decisions.
"""

from __future__ import annotations

from ..models import SentimentResult

try:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

    _analyzer = SentimentIntensityAnalyzer()
except ImportError:  # pragma: no cover
    _analyzer = None


def analyze(text: str) -> SentimentResult:
    if _analyzer is None:
        # Degrade gracefully if vader isn't installed.
        return SentimentResult(polarity="Neutral", compound_score=0.0)

    scores = _analyzer.polarity_scores(text)
    compound = scores["compound"]
    pos, neg = scores["pos"], scores["neg"]

    if compound >= 0.05 and pos > neg:
        polarity = "Positive"
    elif compound <= -0.05 and neg > pos:
        polarity = "Negative"
    elif pos > 0.2 and neg > 0.2:
        polarity = "Mixed"
    else:
        polarity = "Neutral"

    return SentimentResult(polarity=polarity, compound_score=round(compound, 4))
