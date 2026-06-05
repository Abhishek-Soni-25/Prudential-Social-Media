"""Step 3 — AI risk classification (the analytical core).

Sends each post to the Groq API (default model: llama-3.3-70b-versatile) for
context/sarcasm/intent-aware risk judgement against the taxonomy in docs/risk-taxonomy.md.
The model is asked to return strict JSON, validated into a `RiskAssessment`.
"""

from __future__ import annotations

import json
import logging
import re
import time

from ..config import env
from ..models import Post, RiskAssessment, RISK_CATEGORIES, SEVERITIES

log = logging.getLogger(__name__)

# Parse a retry hint from a provider error: "try again in 7.5s" / "retry after 7s".
_RETRY_DELAY_RE = re.compile(r"(?:try again in|retry[- ]?after|in)\s*(\d+(?:\.\d+)?)\s*s",
                             re.IGNORECASE)

# --- The taxonomy contract (kept in sync with docs/risk-taxonomy.md) ---------

SYSTEM_PROMPT = """\
You are a financial-services surveillance risk classifier for {ORG}. You analyze a single \
piece of public or authorized social-media/communications content and judge whether it \
indicates a risk to {ORG}, against a fixed taxonomy. The content has already been screened \
as relevant to {ORG}.

CATEGORIES:
- REPUTATIONAL: public backlash, boycott coordination, executive defamation, negative viral \
brand trends, and abusive / harassing / defamatory content directed at {ORG} or its staff. \
Negative sentiment about {ORG} that does not fit another category belongs here, with severity \
scaled to intensity (abusive/defamatory/viral = HIGH or MEDIUM; mild criticism = LOW).
- COMPLIANCE_CONDUCT: insiders sharing unauthorized info, policy violations, unethical \
behavior, misrepresentation to clients, harassment.
- MARKET_ABUSE: suspicious trading discussion, insider-information leakage, market \
manipulation, pump-and-dump coordination, leaked financial metrics ahead of disclosure.
- CYBER_OPERATIONAL: data-leak mentions, credential/key exposure, system vulnerabilities, \
coordinated cyberattack planning, leaked internal infrastructure, exploited outages.
- NONE: no actionable risk.

SEVERITY:
- HIGH: high-confidence MARKET_ABUSE, CYBER_OPERATIONAL (cyber), or severe \
COMPLIANCE_CONDUCT. Immediate action.
- MEDIUM: significant negative-sentiment spikes, sustained operational critique, or \
moderate conduct concerns. Priority review.
- LOW: general negative sentiment with no actionable compliance/operational threat.
- NONE: not a risk.

JUDGEMENT RULES:
- Weigh context, sarcasm, humor, and intent. Jokes, hypotheticals, news commentary, and \
satire are usually NOT risks — lower your confidence for ambiguous content to minimize \
false positives.
- Only assign HIGH when the evidence in the text genuinely supports immediate action.
- Ground your rationale in specific wording from the content. Do not invent facts.

OUTPUT: respond with ONLY a JSON object matching this schema:
{"is_risk": boolean, "category": one of [REPUTATIONAL, COMPLIANCE_CONDUCT, MARKET_ABUSE, \
CYBER_OPERATIONAL, NONE], "severity": one of [HIGH, MEDIUM, LOW, NONE], \
"confidence": number between 0 and 1, "rationale": "short, grounded explanation", \
"indicators": ["matched signal", ...]}
If is_risk is false, category and severity must both be "NONE"."""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


class RiskClassifier:
    def __init__(
        self,
        model: str | None = None,
        models: list[str] | None = None,
        max_tokens: int = 1024,
        requests_per_minute: int = 25,
        max_retries: int = 3,
        target_name: str = "the organization",
    ) -> None:
        # {ORG} substituted via str.replace (NOT .format) — the prompt has literal JSON braces.
        self._system_prompt = SYSTEM_PROMPT.replace("{ORG}", target_name)
        # Ordered fallback chain: if a model's quota is hit, roll over to the next.
        chain = list(models) if models else []
        if model and model not in chain:
            chain.insert(0, model)
        self.models = chain or ["llama-3.3-70b-versatile"]
        self.max_tokens = max_tokens
        self._min_interval = 60.0 / requests_per_minute if requests_per_minute else 0.0
        self._max_retries = max_retries
        self._last_call = 0.0
        self._exhausted: set[str] = set()
        api_key = env("GROQ_API_KEY", required=True)
        try:
            from groq import Groq
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("groq not installed; pip install groq") from exc
        self._client = Groq(api_key=api_key)

    @property
    def active_model(self) -> str | None:
        for m in self.models:
            if m not in self._exhausted:
                return m
        return None

    def classify(self, post: Post) -> RiskAssessment:
        user_content = (
            f"CHANNEL: {post.channel}\n"
            f"SOURCE: {post.source}\n"
            f"TIMESTAMP: {post.timestamp.isoformat()}\n"
            f"CONTENT:\n{post.text}"
        )
        try:
            raw = self._call_with_retry(user_content)
            return self._parse(raw)
        except Exception as exc:
            log.error(
                "Risk classification failed for %s/%s: %s",
                post.channel, post.message_id, exc,
            )
            return RiskAssessment(
                is_risk=False, category="NONE", severity="NONE",
                confidence=0.0, rationale=f"classifier error: {exc}", indicators=[],
            )

    def _throttle(self) -> None:
        if self._min_interval <= 0:
            return
        wait = self._min_interval - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)

    def _call_with_retry(self, user_content: str) -> str:
        messages = [
            {"role": "system", "content": self._system_prompt},
            {"role": "user", "content": user_content},
        ]
        attempt = 0
        while True:
            model = self.active_model
            if model is None:
                raise RuntimeError(
                    f"All configured models exhausted: {', '.join(self.models)}."
                )
            self._throttle()
            try:
                resp = self._client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=0,
                    max_tokens=self.max_tokens,
                    response_format={"type": "json_object"},
                )
                self._last_call = time.monotonic()
                return resp.choices[0].message.content or ""
            except Exception as exc:
                self._last_call = time.monotonic()
                if self._is_daily_quota(exc):
                    self._exhausted.add(model)
                    nxt = self.active_model
                    if nxt:
                        log.warning("Model '%s' daily quota hit; falling back to '%s'.", model, nxt)
                        attempt = 0
                        continue
                    log.error("All models exhausted (last: '%s').", model)
                    raise
                if self._is_rate_limit(exc) and attempt < self._max_retries:
                    delay = self._retry_delay(exc, attempt)
                    log.warning(
                        "Groq rate-limited on '%s' (attempt %d/%d); retrying in %.1fs",
                        model, attempt + 1, self._max_retries, delay,
                    )
                    time.sleep(delay)
                    attempt += 1
                    continue
                raise

    @staticmethod
    def _is_rate_limit(exc: Exception) -> bool:
        s = str(exc).lower()
        return "429" in s or "rate limit" in s or "rate_limit" in s or "ratelimit" in s

    @staticmethod
    def _is_daily_quota(exc: Exception) -> bool:
        s = str(exc).lower()
        return "per day" in s or "rpd" in s or "tokens per day" in s or "tpd" in s

    @staticmethod
    def _retry_delay(exc: Exception, attempt: int) -> float:
        match = _RETRY_DELAY_RE.search(str(exc))
        if match:
            return float(match.group(1)) + 1.0
        return min(2.0 ** attempt, 60.0)

    def _parse(self, raw: str) -> RiskAssessment:
        match = _JSON_RE.search(raw)
        if not match:
            raise ValueError(f"No JSON object in model response: {raw[:200]!r}")
        data = json.loads(match.group(0))

        category = str(data.get("category", "NONE")).upper()
        severity = str(data.get("severity", "NONE")).upper()
        if category not in RISK_CATEGORIES:
            category = "NONE"
        if severity not in SEVERITIES:
            severity = "NONE"
        is_risk = bool(data.get("is_risk", False)) and category != "NONE"
        if not is_risk:
            category, severity = "NONE", "NONE"

        confidence = float(data.get("confidence", 0.0))
        confidence = max(0.0, min(1.0, confidence))

        return RiskAssessment(
            is_risk=is_risk,
            category=category,
            severity=severity,
            confidence=round(confidence, 3),
            rationale=str(data.get("rationale", "")).strip(),
            indicators=[str(i) for i in data.get("indicators", [])][:10],
        )
