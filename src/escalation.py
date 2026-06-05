"""Escalation routing.

Routes HIGH (immediate) and MEDIUM (priority) case summaries to configured recipients.
The prototype ships a LogEscalator that records routed summaries; the interface allows
swapping in email/Slack/ServiceNow integrations without touching the pipeline.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from .models import CaseFile

log = logging.getLogger(__name__)


def case_summary(case: CaseFile) -> str:
    return (
        f"[{case.severity}] {case.case_id} | {case.risk_category} "
        f"({case.confidence:.0%} conf) | {case.platform}:{case.source}\n"
        f"  Urgency: {case.mitigation_urgency} | RACM: {case.racm_ref} | KRI: {case.kri_ref}\n"
        f"  Rationale: {case.rationale}\n"
        f"  Indicators: {', '.join(case.indicators) or '-'}\n"
        f"  Link: {case.url or 'n/a'}"
    )


class BaseEscalator(ABC):
    @abstractmethod
    def route(self, case: CaseFile, recipients: list[str]) -> None: ...


class LogEscalator(BaseEscalator):
    """Default escalator: emits the routed summary to the log/stdout."""

    def route(self, case: CaseFile, recipients: list[str]) -> None:
        to = ", ".join(recipients) if recipients else "(no recipients configured)"
        log.warning("ESCALATION -> %s\n%s", to, case_summary(case))


class Escalation:
    def __init__(self, escalation_cfg: dict, escalator: BaseEscalator | None = None) -> None:
        self._cfg = escalation_cfg or {}
        self._escalator = escalator or LogEscalator()

    def handle(self, case: CaseFile, tier: str) -> None:
        if tier == "HIGH":
            self._escalator.route(case, self._cfg.get("high", []))
        elif tier == "MEDIUM":
            self._escalator.route(case, self._cfg.get("medium", []))
        # LOW is log-only; no routing.
