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
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import load_config, CASES_DIR, DATA_DIR, PROJECT_ROOT
from .connectors import CONNECTOR_REGISTRY, ConnectorUnavailable, DemoConnector
from .connectors.n8n_connector import _fetch as _n8n_fetch, _channel_of, _author_from_url
from .models import Post
from . import mentions as mentions_store
from . import competitors as competitors_store
from . import keywords as keywords_store
from . import publish as publish_store
from . import compliance as compliance_mod
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


@app.get("/api/mentions")
def mentions(
    platform: Optional[str] = Query(None),
    sentiment: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
) -> list[dict[str, Any]]:
    """Every analysed item (newest first) — the primary feed. Each carries its permalink
    (`url`) so it can be opened for verification, the account handle, and Groq sentiment."""
    items = mentions_store.load_mentions()
    if platform:
        items = [m for m in items if m.get("platform") == platform.lower()]
    if sentiment:
        items = [m for m in items if m.get("sentiment") == sentiment.lower()]
    if severity:
        items = [m for m in items if m.get("severity") == severity.upper()]
    return items


@app.get("/api/authors")
def authors(platform: Optional[str] = Query(None)) -> list[dict[str, Any]]:
    """Per-account activity: how many times each account posted about the keyword, with a
    sentiment split and a link to their latest post for verification."""
    return mentions_store.author_activity(platform)


@app.get("/api/sentiment")
def sentiment_by_platform() -> dict[str, dict[str, int]]:
    """Sentiment breakdown (positive / neutral / negative) per platform."""
    return mentions_store.platform_sentiment()


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


@app.get("/api/competitors")
def competitors() -> dict[str, Any]:
    """Stored competitor Share-of-Voice (Prudential vs the competitor set)."""
    return competitors_store.load_competitor_sov()


@app.post("/api/scan/competitors")
def scan_competitors() -> dict[str, Any]:
    """Trigger a competitor Share-of-Voice collection in the background."""
    if _scan_state["running"]:
        return {"started": False, "reason": "a scan is already running"}

    def _run() -> None:
        with _scan_lock:
            _scan_state["running"] = True
            _scan_state["error"] = None
            try:
                competitors_store.run_competitor_scan(_cfg, _get_classifier())
                _scan_state["last_run"] = datetime.now(timezone.utc).isoformat()
            except Exception as exc:  # noqa: BLE001
                _scan_state["error"] = str(exc)
                log.exception("competitor scan failed")
            finally:
                _scan_state["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


@app.get("/api/keywords")
def get_keywords() -> dict[str, Any]:
    return {"base": _cfg.get("keywords", []), "custom": keywords_store.load_custom()}


@app.post("/api/keywords")
def set_keywords(body: dict[str, Any]) -> dict[str, Any]:
    saved = keywords_store.save_custom(body.get("custom", []))
    return {"base": _cfg.get("keywords", []), "custom": saved}


@app.post("/api/publish/reply")
def publish_reply(body: dict[str, Any]) -> dict[str, Any]:
    return publish_store.record("reply", body)


@app.post("/api/publish/post")
def publish_post(body: dict[str, Any]) -> dict[str, Any]:
    return publish_store.record("post", body)


@app.get("/api/publish/outbox")
def publish_outbox() -> list[dict[str, Any]]:
    return publish_store.load_outbox()


# --- Media Compliance (FSG-03) ------------------------------------------------------
# This backend performs RAW EXTRACTION only. The rule engine, matcher and decision
# logic live in TypeScript under lib/compliance/ and consume the extraction dict.
# It also serves the rule-set overlay and maintains the append-only FSG-03 Safeguard 4
# audit register.

_COMPLIANCE_DIR = DATA_DIR / "compliance"
_RULESET_ACTIVE = _COMPLIANCE_DIR / "ruleset-active.json"
_RULESET_DEFAULT = PROJECT_ROOT / "config" / "rules" / "prudential-sg-v1.json"
_AUDIT_LOG = _COMPLIANCE_DIR / "audit.jsonl"


def _compliance_dir() -> None:
    _COMPLIANCE_DIR.mkdir(parents=True, exist_ok=True)


@app.post("/api/compliance/extract")
def compliance_extract(body: dict[str, Any]) -> dict[str, Any]:
    """Image mode: OCR the supplied images and return a normalised extraction asset."""
    images = body.get("images") or ([body["image"]] if body.get("image") else [])
    if not images:
        raise HTTPException(status_code=400, detail="Provide at least one image (data URL).")
    try:
        return compliance_mod.build_extraction(
            assetId=body.get("assetId"),
            adviserId=body.get("adviserId"),
            channel=body.get("channel"),
            images=images,
            transcript=None,
            captionText=body.get("captionText"),
            frames=images,
            metadata=body.get("metadata"),
            cfg=_cfg,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("compliance extract failed")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {exc}")


@app.post("/api/compliance/extract/video")
async def compliance_extract_video(
    file: UploadFile = File(...),
    frames: str = Form("[]"),
    captionText: str = Form(""),
    adviserId: str = Form(""),
    channel: str = Form(""),
    metadata: str = Form("{}"),
) -> dict[str, Any]:
    """Video mode: transcribe the file, OCR the frames, union into one extraction asset."""
    try:
        frame_list = json.loads(frames) if frames else []
        if not isinstance(frame_list, list):
            frame_list = []
    except json.JSONDecodeError:
        frame_list = []
    try:
        meta = json.loads(metadata) if metadata else {}
        if not isinstance(meta, dict):
            meta = {}
    except json.JSONDecodeError:
        meta = {}
    meta.setdefault("isVideo", True)
    try:
        data = await file.read()
        transcript = compliance_mod.transcribe(data, file.filename or "video.mp4", _cfg)
        return compliance_mod.build_extraction(
            assetId=meta.get("assetId"),
            adviserId=adviserId,
            channel=channel,
            images=frame_list,
            transcript=transcript,
            captionText=captionText,
            frames=frame_list,
            metadata=meta,
            cfg=_cfg,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("compliance video extract failed")
        raise HTTPException(status_code=500, detail=f"Video extraction failed: {exc}")


@app.post("/api/compliance/extract/link")
def compliance_extract_link(body: dict[str, Any]) -> dict[str, Any]:
    """Link mode: pull a YouTube caption transcript + thumbnail into an extraction asset."""
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Provide a video URL.")
    metadata = dict(body.get("metadata") or {})
    metadata.setdefault("sourceUrl", url)
    metadata.setdefault("isVideo", True)
    try:
        yt = compliance_mod.fetch_youtube(url)
    except Exception as exc:  # noqa: BLE001 — a failed fetch is a 'failed' extraction, not a 500
        log.warning("compliance link fetch failed: %s", exc)
        yt = {}
    thumb = yt.get("thumbnail")
    transcript = yt.get("transcript") or ""
    link_failed = not thumb and not transcript
    frames = [thumb] if thumb else []
    try:
        return compliance_mod.build_extraction(
            assetId=body.get("assetId"),
            adviserId=body.get("adviserId"),
            channel=body.get("channel"),
            images=frames,
            transcript=transcript,
            captionText=body.get("captionText"),
            frames=frames,
            metadata=metadata,
            cfg=_cfg,
            link_failed=link_failed,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("compliance link extract failed")
        raise HTTPException(status_code=500, detail=f"Link extraction failed: {exc}")


@app.get("/api/compliance/ruleset")
def compliance_get_ruleset() -> dict[str, Any]:
    """Return the active rule set: the overlay if present, else the shipped default."""
    path = _RULESET_ACTIVE if _RULESET_ACTIVE.exists() else _RULESET_DEFAULT
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:  # noqa: BLE001
        log.exception("failed to read rule set")
        raise HTTPException(status_code=500, detail=f"Could not read rule set: {exc}")


@app.put("/api/compliance/ruleset")
def compliance_put_ruleset(body: dict[str, Any]) -> dict[str, Any]:
    """Persist a full rule set to the overlay and append a ruleset_change audit entry."""
    if not isinstance(body, dict) or not body.get("version"):
        raise HTTPException(status_code=400, detail="Rule set must include a 'version'.")
    actor = body.get("_actor") or "compliance-officer"
    ruleset = {k: v for k, v in body.items() if k != "_actor"}
    _compliance_dir()
    with _RULESET_ACTIVE.open("w", encoding="utf-8") as fh:
        json.dump(ruleset, fh, ensure_ascii=False, indent=2)
    _append_audit({
        "type": "ruleset_change",
        "version": ruleset.get("version"),
        "at": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
    })
    return ruleset


@app.post("/api/compliance/audit")
def compliance_audit_append(body: dict[str, Any]) -> dict[str, Any]:
    """Append one audit record (client has already pseudonymised PII) to the register."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Audit record must be a JSON object.")
    record = dict(body)
    record["receivedAt"] = datetime.now(timezone.utc).isoformat()
    if not record.get("id"):
        record["id"] = "aud_" + uuid.uuid4().hex[:16]
    _append_audit(record)
    return {"ok": True, "id": record["id"]}


@app.get("/api/compliance/audit")
def compliance_audit_list(limit: Optional[int] = Query(None, ge=1)) -> list[dict[str, Any]]:
    """Return audit records, newest first, optionally capped by ?limit=."""
    records = _read_audit()
    records.reverse()  # newest first
    if limit:
        records = records[:limit]
    return records


@app.get("/api/compliance/audit.csv")
def compliance_audit_csv() -> Response:
    """Return the audit register as a CSV attachment (FSG-03 Safeguard 4 export)."""
    import csv
    import io

    columns = [
        "id", "assetHash", "adviserId", "channel", "submittedAt", "extractionStatus",
        "computedOutcome", "finalDisposition", "ruleSetVersion", "hits", "notEvaluated",
        "override",
    ]
    json_cols = {"hits", "notEvaluated", "override"}
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    for rec in _read_audit():
        row = []
        for col in columns:
            val = rec.get(col)
            if val is None:
                row.append("")
            elif col in json_cols or isinstance(val, (dict, list)):
                row.append(json.dumps(val, ensure_ascii=False))
            else:
                row.append(str(val))
        writer.writerow(row)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="compliance-audit.csv"'},
    )


def _append_audit(record: dict[str, Any]) -> None:
    """Append-only write of one JSON record; never rewrites existing lines."""
    _compliance_dir()
    with _AUDIT_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def _read_audit() -> list[dict[str, Any]]:
    """Parse the audit.jsonl register (oldest first). Skips malformed lines."""
    if not _AUDIT_LOG.exists():
        return []
    out: list[dict[str, Any]] = []
    with _AUDIT_LOG.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                log.warning("skipping malformed audit line")
    return out


# --- Serve the built React frontend (single-container deploy on Cloud Run) ----------
# Mounted LAST so it never shadows the /api/* routes above. Only active when the
# production build exists (i.e. in the container); local dev uses the Vite dev server.
_FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
    log.info("Serving frontend from %s", _FRONTEND_DIST)
