"""FastAPI backend that serves the React surveillance dashboard.

Endpoints:
    GET  /api/health          liveness
    GET  /api/stats           dashboard aggregates (counts by severity/category/channel)
    GET  /api/cases           list case files (newest first), optional filters
    GET  /api/cases/{id}      single case file
    GET  /api/channels        configured channels + mode (live/demo)
    GET  /api/scan/status     current/last scan status + active LLM model
    POST /api/scan            trigger a single polling cycle in the background

Run:  uvicorn src.api:app --reload --port 8000
"""

from __future__ import annotations

import json
import logging
import random
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import load_config, CASES_DIR, PROJECT_ROOT
from .connectors import CONNECTOR_REGISTRY, ConnectorUnavailable, DemoConnector
from .connectors.n8n_connector import _fetch as _n8n_fetch, _channel_of, _author_from_url
from .models import Post
from .pipeline.risk_classifier import RiskClassifier
from .escalation import Escalation
from . import main as pipeline_main

_URGENCY = {"HIGH": "Immediate", "MEDIUM": "Priority", "LOW": "Routine", "NONE": "None"}
_SENT_SCORE = {"negative": -0.6, "positive": 0.6, "neutral": 0.05, "mixed": -0.1}

log = logging.getLogger("surveillance.api")

app = FastAPI(title="Social Media Surveillance API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev convenience; lock down for production
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Lazy singletons -----------------------------------------------------------

# Loaded at import so every endpoint has config even under TestClient (which skips
# the startup event unless used as a context manager). Refreshed again on startup.
_cfg: dict[str, Any] = load_config()
_classifier: Optional[RiskClassifier] = None
_scan_lock = threading.Lock()
_scan_state: dict[str, Any] = {
    "running": False,
    "last_run": None,
    "last_stats": None,
    "error": None,
}


@app.on_event("startup")
def _startup() -> None:
    global _cfg
    logging.basicConfig(level=logging.INFO)
    _cfg = load_config()


def _get_classifier() -> RiskClassifier:
    global _classifier
    if _classifier is None:
        a = _cfg.get("analysis", {})
        _classifier = RiskClassifier(
            model=a.get("model"),
            models=a.get("models"),
            max_tokens=a.get("max_tokens", 1024),
            requests_per_minute=a.get("requests_per_minute", 5),
            max_retries=a.get("max_retries", 3),
            target_name=_cfg.get("target", {}).get("name", "the organization"),
        )
    return _classifier


_live_classifier: Optional[RiskClassifier] = None


def _get_live_classifier() -> RiskClassifier:
    """Un-throttled classifier for the on-demand /api/live endpoint (only ~6 items per
    call, fired concurrently so the dashboard responds quickly)."""
    global _live_classifier
    if _live_classifier is None:
        a = _cfg.get("analysis", {})
        _live_classifier = RiskClassifier(
            model=a.get("model"),
            models=a.get("models"),
            max_tokens=384,                 # JSON answer is tiny — keep token use low
            requests_per_minute=0,          # concurrency is capped at the call site instead
            max_retries=a.get("max_retries", 4),
            target_name=_cfg.get("target", {}).get("name", "the organization"),
        )
    return _live_classifier


# --- Case-file access ----------------------------------------------------------

def _load_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for f in CASES_DIR.glob("CASE-*.json"):
        try:
            cases.append(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    cases.sort(key=lambda c: c.get("created_at", ""), reverse=True)
    # De-duplicate by source URL (keep the newest) so re-scanning the same live
    # Reddit/LinkedIn post doesn't show as multiple cases.
    deduped: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for c in cases:
        url = c.get("url")
        if url:
            if url in seen_urls:
                continue
            seen_urls.add(url)
        deduped.append(c)
    return deduped


# --- Routes --------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    cases = _load_cases()
    by_sev: dict[str, int] = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
    by_cat: dict[str, int] = {}
    by_channel: dict[str, int] = {}
    for c in cases:
        by_sev[c.get("severity", "LOW")] = by_sev.get(c.get("severity", "LOW"), 0) + 1
        by_cat[c["risk_category"]] = by_cat.get(c["risk_category"], 0) + 1
        by_channel[c["platform"]] = by_channel.get(c["platform"], 0) + 1
    return {
        "total_cases": len(cases),
        "by_severity": by_sev,
        "by_category": by_cat,
        "by_channel": by_channel,
        "latest": cases[0]["created_at"] if cases else None,
    }


@app.get("/api/cases")
def list_cases(
    severity: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
) -> list[dict[str, Any]]:
    cases = _load_cases()
    if severity:
        cases = [c for c in cases if c.get("severity") == severity.upper()]
    if category:
        cases = [c for c in cases if c.get("risk_category") == category.upper()]
    if channel:
        cases = [c for c in cases if c.get("platform") == channel.lower()]
    return cases


@app.get("/api/cases/{case_id}")
def get_case(case_id: str) -> dict[str, Any]:
    path = CASES_DIR / f"{case_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="case not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/channels")
def channels() -> list[dict[str, Any]]:
    out = []
    for name, ch in _cfg.get("channels", {}).items():
        out.append({
            "name": name,
            "enabled": ch.get("enabled", False),
            "mode": ch.get("mode", "live"),
            "sources": ch.get("sources", []),
        })
    return out


@app.get("/api/live")
def live(per_channel: int = 3) -> dict[str, Any]:
    """Fetch the n8n webhook, draw `per_channel` Reddit + LinkedIn items at random, and
    classify each with Gemini (concurrently). Returns ALL drawn items (risk or not) for
    direct display — nothing is stored. Falls back to the n8n-provided sentiment if the
    classifier errors (e.g. quota)."""
    url = _cfg.get("n8n", {}).get("webhook_url", "")
    try:
        data = _n8n_fetch(url)
    except Exception as exc:  # noqa: BLE001
        return {"items": [], "error": f"n8n webhook unreachable: {exc}"}

    racm = _cfg.get("racm_mapping", {})
    now = datetime.now(timezone.utc)
    picks: list[tuple[str, dict]] = []
    for ch in ("reddit", "linkedin"):
        mine = [r for r in data if _channel_of(r.get("source", "")) == ch]
        random.shuffle(mine)
        picks.extend((ch, rec) for rec in mine[:per_channel])

    # Build the classifier defensively: if it can't be created (e.g. GROQ_API_KEY not
    # set on the server), don't 500 — fall back to the n8n-provided sentiment.
    try:
        clf = _get_live_classifier()
    except Exception as exc:  # noqa: BLE001
        log.warning("live classifier unavailable, using sentiment fallback: %s", exc)
        clf = None

    def analyze(pair: tuple[str, dict]) -> dict[str, Any]:
        ch, rec = pair
        title = (rec.get("title") or "").strip()
        snippet = (rec.get("snippet") or "").strip()
        text = f"{title}\n{snippet}".strip()
        url_v = rec.get("url") or ""
        n8n_sent = str(rec.get("sentiment") or "Neutral")
        post = Post(
            channel=ch,
            source="Google Search" if ch == "linkedin" else "Reddit (Google Search)",
            message_id=str(abs(hash(url_v or title))),
            author_id=_author_from_url(url_v, ch),
            timestamp=now,
            text=text,
            url=url_v or None,
        )
        a = clf.classify(post) if clf is not None else None
        if a is None or a.rationale.startswith("classifier error"):
            # Fallback: derive risk from the n8n-provided sentiment when the LLM is
            # unavailable (e.g. quota). Never leave an item un-categorised.
            if n8n_sent.lower().startswith("neg"):
                cat, sev, conf = "REPUTATIONAL", "MEDIUM", 0.6
                rationale = "Negative sentiment about Prudential Singapore (sentiment-based)."
            else:
                cat, sev, conf = "GENERAL", "NONE", 0.7
                rationale = "General mention of Prudential Singapore; analysed, no specific risk indicator."
            inds = []
        else:
            cat, sev, conf, rationale, inds = (
                a.category, a.severity, a.confidence, a.rationale, a.indicators
            )
            # A genuine no-risk result is still categorised GENERAL (not blank).
            if cat == "NONE" or not a.is_risk:
                cat, sev = "GENERAL", "NONE"
                conf = conf or 0.7
                rationale = rationale or "Analysed; no specific risk indicator for Prudential Singapore."
        m = racm.get(cat, {})
        return {
            "case_id": f"LIVE-{cat[:3]}-{ch}-{random.randint(10000, 99999)}",
            "platform": ch,
            "source": post.source,
            "timestamp": now.isoformat(),
            "author_ref": post.author_id,
            "raw_content": text,
            "risk_category": cat,
            "severity": sev,
            "sentiment_polarity": n8n_sent,
            "sentiment_score": _SENT_SCORE.get(n8n_sent.lower(), 0.0),
            "confidence": conf,
            "rationale": rationale,
            "indicators": inds,
            "mitigation_urgency": _URGENCY.get(sev, "None"),
            "racm_ref": m.get("racm_ref", "-"),
            "kri_ref": m.get("kri_ref", "-"),
            "url": url_v or None,
            "created_at": now.isoformat(),
        }

    if not picks:
        return {"items": []}
    # Cap concurrency to avoid bursting past Groq's free-tier rate limit (429s).
    with ThreadPoolExecutor(max_workers=3) as ex:
        items = list(ex.map(analyze, picks))
    return {"items": items}


@app.get("/api/scan/status")
def scan_status() -> dict[str, Any]:
    model = None
    if _classifier is not None:
        model = _classifier.active_model
    return {**_scan_state, "active_model": model, "models": _cfg.get("analysis", {}).get("models")}


@app.post("/api/scan")
def scan() -> dict[str, Any]:
    if _scan_state["running"]:
        return {"started": False, "reason": "a scan is already running"}

    def _run() -> None:
        with _scan_lock:
            _scan_state["running"] = True
            _scan_state["error"] = None
            try:
                connectors = pipeline_main.build_connectors(_cfg)
                if not connectors:
                    _scan_state["error"] = "no connectors available"
                    return
                classifier = _get_classifier()
                escalation = Escalation(_cfg.get("escalation", {}))
                stats = pipeline_main.run_cycle(connectors, classifier, escalation, _cfg)
                for c in connectors:
                    try:
                        c.close()
                    except Exception:
                        pass
                _scan_state["last_stats"] = stats
                _scan_state["last_run"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:  # noqa: BLE001
                _scan_state["error"] = str(exc)
                log.exception("scan failed")
            finally:
                _scan_state["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


# --- Serve the built React frontend (single-container deploy on Cloud Run) ----------
# Mounted LAST so it never shadows the /api/* routes above. Only active when the
# production build exists (i.e. in the container); local dev uses the Vite dev server.
_FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
    log.info("Serving frontend from %s", _FRONTEND_DIST)
