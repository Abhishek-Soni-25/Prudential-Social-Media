"""Media compliance analyzer.

Checks a marketing creative (image, or a frame extracted from a video / video link on the
client) against the Indian securities-market advertising rules (SEBI Mutual Fund Advertisement
Code + related NSE / BSE / NSDL / CDSL investor-communication norms). Uses a Groq vision model
to read the creative and judge each rule PASS / FAIL / UNCLEAR, then returns a structured
verdict for the UI.

The rule checklist lives in COMPLIANCE_CHECKS and is grounded in the SEBI advertisement code
(Sixth Schedule of the SEBI (Mutual Funds) Regulations, 1996 and the SEBI Master Circular for
Mutual Funds). Final sign-off always rests with a human compliance officer.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

from .config import env

log = logging.getLogger(__name__)

# The mandatory standard warning for mutual-fund creatives (SEBI advertisement code).
STANDARD_WARNING = (
    "Mutual Fund investments are subject to market risks, "
    "read all scheme related documents carefully."
)

# Compliance checklist. Each item: id, title, look_for (what the model should verify),
# source (regulator), conditional (only assessed if the trigger applies).
# Grounded in the SEBI (Mutual Funds) Regulations 1996 Sixth Schedule (Advertisement Code,
# clauses a-j), the SEBI Master Circular for Mutual Funds Chapter 13 (Advertisements), the
# Product-Labelling / Risk-o-meter circular (Oct 2020), the SEBI Advertisement Code for IA/RA
# (2023), and the NSE / BSE Codes of Advertisement. (No dedicated NSDL/CDSL ad code exists;
# depository communications follow the Investor Charter / cautionary-advisory norms.)
COMPLIANCE_CHECKS: list[dict[str, Any]] = [
    {"id": "standard_warning", "title": "Standard warning must be present and legible",
     "look_for": f"The exact 14-word warning '{STANDARD_WARNING}' must appear, legibly, with no words added or deleted. Flag the older '…read the offer document carefully' wording as non-compliant.",
     "source": "SEBI (MF) Regs 1996, Sixth Schedule cl. (i)"},
    {"id": "av_warning_duration", "title": "In video, the warning must run ≥5 seconds",
     "look_for": "For audio-visual/video creatives, the standard warning (on-screen and voice-over) must run for at least 5 seconds and be understandable.",
     "source": "Sixth Schedule cl. (j) / SEBI Cir. 04-Feb-2010", "conditional": "audio-visual / video creative"},
    {"id": "no_assured_returns", "title": "No assured / guaranteed returns",
     "look_for": "No slogan or statement implying assured, guaranteed or risk-free returns; nothing exaggerated or unwarranted.",
     "source": "Sixth Schedule cl. (d)"},
    {"id": "no_misleading", "title": "No false, misleading or deceptive content",
     "look_for": "No statements that are false, misleading, biased, deceptive, or based on assumptions/projections; nothing misleading by omission.",
     "source": "Sixth Schedule cl. (b), (c)"},
    {"id": "no_testimonials_rankings", "title": "No testimonials; rankings must state basis & date",
     "look_for": "No testimonials. Any ranking/award cited must state the ranking entity, the basis, and the date.",
     "source": "Sixth Schedule cl. (b)"},
    {"id": "no_celebrity", "title": "No celebrity endorsing a scheme / AMC",
     "look_for": "No celebrity in a scheme/AMC ad (industry-level AMFI awareness ads are the only exception, with SEBI approval).",
     "source": "Sixth Schedule cl. (e)"},
    {"id": "fair_comparison", "title": "No discrediting or unfair comparison with other schemes/AMCs",
     "look_for": "The creative must not discredit other ads or make unfair/incomplete comparisons with other schemes or AMCs.",
     "source": "Sixth Schedule cl. (h)"},
    {"id": "riskometer", "title": "The scheme's Risk-o-meter must be displayed",
     "look_for": "The scheme's six-level Risk-o-meter (Low → Very High) must be shown and match the scheme's labelling.",
     "source": "SEBI Product-Labelling circular, 05-Oct-2020"},
    {"id": "performance_format", "title": "Performance shown as CAGR + past-performance disclaimer",
     "look_for": "If returns/performance figures are shown: they must be CAGR (1/3/5 yr & since inception) with a point-to-point ₹10,000 return, and carry a 'past performance may or may not be sustained' disclaimer.",
     "source": "SEBI Master Circular for MFs, cl. 13.3", "conditional": "performance figures shown"},
    {"id": "no_future_dividend", "title": "No promise / indication of future dividend or IDCW",
     "look_for": "No promise or indication of future dividend/IDCW amounts. If past payout is shown, ₹/unit, face value and NAV-at-declaration must be disclosed.",
     "source": "SEBI Master Circular for MFs, cl. 13.2"},
    {"id": "no_indicative_portfolio", "title": "No indicative portfolio or indicative yield",
     "look_for": "No indicative portfolio or indicative yield stated anywhere in the creative.",
     "source": "SEBI Master Circular for MFs, cl. 13.6.1"},
    {"id": "no_superlatives", "title": "No unsubstantiated superlatives",
     "look_for": "No superlatives (best, No.1, top, safest, 'India's Top …') without a stated, verifiable basis.",
     "source": "Sixth Schedule cl. (b), (c)"},
    {"id": "nfo_disclosures", "title": "NFO creatives must show open/close dates & key details",
     "look_for": "For a New Fund Offer (NFO): scheme category, investment objective, NFO open & close dates, and where to get the SID must be shown.",
     "source": "SEBI Master Circular for MFs, Ch. 13 (NFO)", "conditional": "NFO creative"},
    {"id": "legible_disclaimers", "title": "Disclaimers and statutory text must be legible",
     "look_for": "Disclaimers, risk factors and statutory text must be legible (adequate font size and contrast; risk factors in equal font size for NFOs).",
     "source": "SEBI (MF) Regs / Master Circular"},
    {"id": "consistency", "title": "Claims consistent with scheme documents",
     "look_for": "Claims must be timely and consistent with the SID / SAI / KIM; nothing that misrepresents the nature of the scheme.",
     "source": "Sixth Schedule cl. (g)"},
    {"id": "intermediary_disclosure", "title": "Intermediary identity & SEBI registration disclosed",
     "look_for": "If issued by a distributor / RIA / broker, their name and SEBI registration number should be shown; IA/RA ads need the 'registration does not guarantee returns' disclaimer.",
     "source": "SEBI IA/RA Advertisement Code 2023; NSE / BSE Codes of Advertisement"},
]

_SYSTEM = """You are an automated advertising-compliance screener for Indian securities-market \
marketing creatives (mutual funds and securities). You screen a single creative (an image, or a \
representative frame from a video) against the SEBI Mutual Fund Advertisement Code and related \
NSE / BSE / NSDL / CDSL investor-communication norms.

You will be given a numbered checklist. For EACH check, look at the creative and decide:
- "PASS"    — the creative clearly satisfies the rule.
- "FAIL"    — the creative clearly violates the rule.
- "UNCLEAR" — cannot be determined from the creative, or the rule's trigger does not apply \
(e.g. no performance figures shown, so a performance disclaimer is not required) — say why.

Ground every judgement in what is actually visible. Do not invent text that is not present. \
Read small print and disclaimers carefully. For conditional rules, if the trigger is absent, \
return UNCLEAR with a short note that the trigger does not apply.

Respond with ONLY a JSON object of this exact shape:
{"issues_found": boolean,
 "summary": "2-3 sentence plain-English verdict",
 "checks": [{"id": "<check id>", "status": "PASS"|"FAIL"|"UNCLEAR", "detail": "short grounded note"}]}
Include one entry per check, using the given ids. issues_found is true if any check is FAIL or a \
material UNCLEAR. Do not add commentary outside the JSON."""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _keys() -> list[str]:
    keys: list[str] = []
    primary = env("GROQ_API_KEY")
    if primary:
        keys.append(primary.strip())
    for extra in (env("GROQ_API_KEYS") or "").split(","):
        if extra.strip() and extra.strip() not in keys:
            keys.append(extra.strip())
    idx = 2
    while True:
        k = env(f"GROQ_API_KEY_{idx}")
        if not k:
            break
        if k.strip() and k.strip() not in keys:
            keys.append(k.strip())
        idx += 1
    return keys


def _checklist_text() -> str:
    lines = []
    for i, c in enumerate(COMPLIANCE_CHECKS, 1):
        cond = f" (only if: {c['conditional']})" if c.get("conditional") else ""
        lines.append(f"{i}. [{c['id']}] {c['title']}{cond} — {c['look_for']} (Source: {c['source']})")
    return "\n".join(lines)


def analyze(images: list[str] | None, note: str | None, cfg: dict,
            transcript: str | None = None) -> dict[str, Any]:
    """Screen one or more frames (+ an optional voice-over transcript) and return a verdict."""
    comp_cfg = cfg.get("compliance", {})
    model = comp_cfg.get("vision_model", "meta-llama/llama-4-scout-17b-16e-instruct")
    max_tokens = comp_cfg.get("max_tokens", 1600)
    images = [i for i in (images or []) if i][:5]   # vision models cap at ~5 images

    keys = _keys()
    if not keys:
        raise RuntimeError("No Groq API key configured (GROQ_API_KEY).")
    try:
        from groq import Groq
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("groq not installed; pip install groq") from exc

    intro = "Screen this marketing creative against the checklist below."
    if len(images) > 1:
        intro = (f"Screen this video creative against the checklist below. You are given "
                 f"{len(images)} frames sampled across the video" +
                 (" and its voice-over transcript" if transcript else "") + ". Consider BOTH the "
                 "frames and the transcript (e.g. the standard warning may be spoken, not shown).")
    elif transcript:
        intro = ("Screen this video creative against the checklist below, using the frame and its "
                 "voice-over transcript together.")
    text = intro + "\n" + (f"Context: {note}\n" if note else "")
    if transcript:
        text += f"\nVOICE-OVER TRANSCRIPT:\n{transcript[:6000]}\n"
    text += "\nCHECKLIST:\n" + _checklist_text()

    user_content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    for img in images:
        user_content.append({"type": "image_url", "image_url": {"url": img}})

    last_exc: Exception | None = None
    for key in keys:
        try:
            client = Groq(api_key=key)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM},
                    {"role": "user", "content": user_content},
                ],
                temperature=0,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            out = _parse(resp.choices[0].message.content or "")
            if transcript:
                out["transcript"] = transcript
            out["frames_used"] = len(images)
            return out
        except Exception as exc:  # try next key on rate-limit/quota
            last_exc = exc
            s = str(exc).lower()
            if "429" in s or "rate" in s or "quota" in s or "per day" in s:
                continue
            raise
    raise RuntimeError(f"Compliance vision call failed: {last_exc}")


# ---------------------------------------------------------------------------------------------
# Video-link (YouTube) transcript + thumbnail, and audio transcription for uploaded videos.
# ---------------------------------------------------------------------------------------------

_YT_ID = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})")


def youtube_id(url: str) -> str | None:
    m = _YT_ID.search(url or "")
    return m.group(1) if m else None


def _youtube_transcript(vid: str) -> str:
    """Fetch a caption transcript, tolerant of both the 1.x and 0.6.x library APIs."""
    langs = ["en", "en-US", "en-GB", "hi"]
    try:
        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore
    except Exception as exc:  # pragma: no cover
        log.warning("youtube_transcript_api not installed: %s", exc)
        return ""
    # 1.x instance API: YouTubeTranscriptApi().fetch(vid) -> iterable of snippets with .text
    try:
        api = YouTubeTranscriptApi()
        fetched = api.fetch(vid, languages=langs)
        parts = [getattr(s, "text", None) or (s.get("text") if isinstance(s, dict) else "") for s in fetched]
        text = " ".join(p for p in parts if p).strip()
        if text:
            return text
    except Exception as exc:
        log.warning("YouTube transcript (fetch) unavailable for %s: %s", vid, exc)
    # 0.6.x classmethod API fallback
    try:
        segs = YouTubeTranscriptApi.get_transcript(vid, languages=langs)  # type: ignore[attr-defined]
        return " ".join(s.get("text", "") for s in segs).strip()
    except Exception:
        return ""


def fetch_youtube(url: str) -> dict[str, Any]:
    """Return {video_id, transcript, thumbnail_data_url} for a YouTube link (best effort)."""
    import urllib.request

    vid = youtube_id(url)
    if not vid:
        raise RuntimeError("Could not parse a YouTube video id from that link.")

    transcript = _youtube_transcript(vid)

    thumb_data = None
    for name in ("maxresdefault", "hqdefault", "mqdefault"):
        try:
            req = urllib.request.Request(f"https://img.youtube.com/vi/{vid}/{name}.jpg",
                                         headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            if len(data) > 1500:  # YouTube returns a tiny placeholder for missing sizes
                thumb_data = as_data_url(data, "image/jpeg")
                break
        except Exception:
            continue

    return {"video_id": vid, "transcript": transcript, "thumbnail": thumb_data}


def transcribe(file_bytes: bytes, filename: str, cfg: dict) -> str:
    """Transcribe an uploaded video/audio file's voice-over with Groq Whisper."""
    model = cfg.get("compliance", {}).get("transcribe_model", "whisper-large-v3-turbo")
    keys = _keys()
    if not keys:
        return ""
    from groq import Groq
    last_exc: Exception | None = None
    for key in keys:
        try:
            client = Groq(api_key=key)
            resp = client.audio.transcriptions.create(
                file=(filename or "video.mp4", file_bytes), model=model, response_format="text",
            )
            return (resp if isinstance(resp, str) else getattr(resp, "text", "")).strip()
        except Exception as exc:
            last_exc = exc
            s = str(exc).lower()
            if "429" in s or "rate" in s or "quota" in s or "per day" in s:
                continue
            log.warning("Transcription failed: %s", exc)
            return ""
    log.warning("Transcription failed on all keys: %s", last_exc)
    return ""


def _parse(raw: str) -> dict[str, Any]:
    match = _JSON_RE.search(raw)
    data = json.loads(match.group(0)) if match else {}
    by_id = {str(c.get("id")): c for c in data.get("checks", []) if isinstance(c, dict)}
    checks = []
    for c in COMPLIANCE_CHECKS:
        r = by_id.get(c["id"], {})
        status = str(r.get("status", "UNCLEAR")).upper()
        if status not in ("PASS", "FAIL", "UNCLEAR"):
            status = "UNCLEAR"
        checks.append({
            "id": c["id"], "title": c["title"], "source": c["source"],
            "status": status, "detail": str(r.get("detail", "")).strip(),
        })
    fails = [c for c in checks if c["status"] == "FAIL"]
    issues = bool(data.get("issues_found")) or len(fails) > 0
    return {
        "issues_found": issues,
        "summary": str(data.get("summary", "")).strip() or (
            "Automated screening complete." if not issues else "Potential compliance issues were found."),
        "checks": checks,
        "passed": sum(1 for c in checks if c["status"] == "PASS"),
        "failed": len(fails),
        "unclear": sum(1 for c in checks if c["status"] == "UNCLEAR"),
    }


def as_data_url(raw_bytes: bytes, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64,{base64.b64encode(raw_bytes).decode()}"
