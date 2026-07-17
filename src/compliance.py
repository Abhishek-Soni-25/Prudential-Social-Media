"""Media compliance extraction.

Raw extraction layer for the Media Compliance module. This backend does NOT judge
compliance — the rule engine, matcher and decision logic live in TypeScript under
``lib/compliance/`` and run against the normalised asset produced here.

Responsibilities of this module:
  * OCR / scene-read one or more image or video frames with a Groq vision model
    (``extract_text``) — verbatim visible text plus a few coarse visual signals, no
    interpretation.
  * Transcribe an uploaded video's voice-over with Groq Whisper (``transcribe``).
  * Pull a caption transcript + thumbnail for a YouTube link (``fetch_youtube``).
  * Assemble the normalised asset the TS engine expects (``build_extraction``) and
    compute a conservative ``extractionStatus`` (complete / partial / failed).

Rule content for Prudential Assurance Singapore / MAS FSG-03 lives in
``config/rules/prudential-sg-v1.json`` (and the runtime overlay
``data/compliance/ruleset-active.json``); it is served by the API, not embedded here.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from typing import Any

from .config import env

log = logging.getLogger(__name__)

# Vision OCR / scene-reading system prompt. This engine reads text; it never judges.
_OCR_SYSTEM = (
    "You are an OCR and scene-reading engine. Return ONLY the text visible in the "
    "image(s), verbatim, plus a short list of any obvious visual entities (logos, chat "
    "UI, faces, charts). Do not interpret, judge, or add commentary."
)

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


def _extract_json(raw: str) -> dict[str, Any]:
    """Best-effort JSON extraction from a model response. Empty dict if unusable."""
    match = _JSON_RE.search(raw or "")
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, ValueError):
        return {}


def extract_text(images: list[str] | None, cfg: dict) -> dict[str, Any]:
    """OCR / scene-read one or more image frames with the Groq vision model.

    Returns a dict:
        {"imageText": [{"text": str, "frame": int, "confidence": float}, ...],
         "signals": {"messaging_ui": bool, "face": bool, "chart": bool}}
    It does NOT judge compliance. If the model returns nothing usable, ``imageText`` is
    empty so the caller can mark the extraction status ``partial``.
    """
    comp_cfg = cfg.get("compliance", {})
    model = comp_cfg.get("vision_model", "meta-llama/llama-4-scout-17b-16e-instruct")
    max_tokens = comp_cfg.get("max_tokens", 1600)
    images = [i for i in (images or []) if i][:5]  # vision models cap at ~5 images

    empty = {"imageText": [], "signals": {"messaging_ui": False, "face": False, "chart": False}}
    if not images:
        return empty

    keys = _keys()
    if not keys:
        raise RuntimeError("No Groq API key configured (GROQ_API_KEY).")
    try:
        from groq import Groq
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("groq not installed; pip install groq") from exc

    instruction = (
        f"Read the {len(images)} image(s) below. Return ONLY the visible text, verbatim, "
        "and coarse visual signals. Respond with ONLY a JSON object of this exact shape:\n"
        '{"imageText": [{"text": "<one line of visible text>", "frame": <0-based index of '
        'the image the line came from>, "confidence": <0..1>}], '
        '"signals": {"messaging_ui": <true if a chat/messaging app UI is visible>, '
        '"face": <true if a human face is visible>, "chart": <true if a chart/graph is '
        "visible>}}\n"
        "One imageText entry per distinct line of text. Do not interpret or judge."
    )
    user_content: list[dict[str, Any]] = [{"type": "text", "text": instruction}]
    for img in images:
        user_content.append({"type": "image_url", "image_url": {"url": img}})

    last_exc: Exception | None = None
    for key in keys:
        try:
            client = Groq(api_key=key)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _OCR_SYSTEM},
                    {"role": "user", "content": user_content},
                ],
                temperature=0,
                max_tokens=max_tokens,
                response_format={"type": "json_object"},
            )
            return _parse_ocr(resp.choices[0].message.content or "", len(images))
        except Exception as exc:  # try next key on rate-limit/quota
            last_exc = exc
            s = str(exc).lower()
            if "429" in s or "rate" in s or "quota" in s or "per day" in s:
                continue
            raise
    raise RuntimeError(f"Vision OCR call failed: {last_exc}")


def _parse_ocr(raw: str, n_images: int) -> dict[str, Any]:
    """Defensively parse the vision model's OCR JSON into the extract_text shape."""
    data = _extract_json(raw)
    image_text: list[dict[str, Any]] = []
    for item in data.get("imageText", []) or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        frame = item.get("frame")
        try:
            frame = int(frame)
            if frame < 0 or frame >= max(n_images, 1):
                frame = 0
        except (TypeError, ValueError):
            frame = 0
        conf = item.get("confidence")
        try:
            conf = float(conf)
            conf = min(1.0, max(0.0, conf))
        except (TypeError, ValueError):
            conf = None
        image_text.append({"text": text, "frame": frame, "bbox": None, "confidence": conf})

    sig = data.get("signals") if isinstance(data.get("signals"), dict) else {}
    signals = {
        "messaging_ui": bool(sig.get("messaging_ui")),
        "face": bool(sig.get("face")),
        "chart": bool(sig.get("chart")),
    }
    return {"imageText": image_text, "signals": signals}


def build_extraction(
    assetId: str | None,
    adviserId: str | None,
    channel: str | None,
    images: list[str] | None,
    transcript: str | None,
    captionText: str | None,
    frames: list[str] | None,
    metadata: dict | None,
    cfg: dict,
    link_failed: bool = False,
) -> dict[str, Any]:
    """Assemble the normalised asset the TS rule engine expects.

    ``images`` are the frames to OCR (image mode: the images themselves; video/link
    mode: sampled frames / thumbnail). ``frames`` is what gets echoed back as the
    asset's frame list; if not given it defaults to ``images``.

    extractionStatus is computed conservatively:
      * 'failed'  — link_failed, OR frames/images were requested but none decoded AND
                    there is no transcript.
      * 'partial' — OCR came back empty / low-confidence, a video had no audio track
                    (empty transcript), or the decoded frame count is short.
      * 'complete'— otherwise.
    When unsure, 'partial'. Never silently pass.
    """
    images = [i for i in (images or []) if i]
    frames = [f for f in (frames if frames is not None else images) if f]
    transcript = (transcript or "").strip()
    captionText = (captionText or "").strip()
    metadata = dict(metadata or {})

    # OCR the frames (unless there are none).
    ocr: dict[str, Any] = {"imageText": [], "signals": {}}
    ocr_attempted = bool(images)
    ocr_failed = False
    if images:
        try:
            ocr = extract_text(images, cfg)
        except Exception as exc:  # noqa: BLE001 — extraction must degrade, not crash
            log.warning("extract_text failed during build_extraction: %s", exc)
            ocr_failed = True

    image_text = ocr.get("imageText", []) or []
    signals = ocr.get("signals", {}) or {}

    if assetId is None:
        assetId = _asset_id(images, frames, transcript, captionText, metadata)

    # ---- extractionStatus (conservative) ----
    requested = ocr_attempted or (frames is not None and len(frames) > 0)
    decoded_none = ocr_attempted and len(images) == 0  # frames requested but none decoded

    status = "complete"
    if link_failed or (requested and not images and not transcript):
        status = "failed"
    else:
        low_conf = image_text and all(
            (c is not None and c < 0.5) for c in
            [t.get("confidence") for t in image_text]
        )
        expected_frames = metadata.get("expectedFrames")
        short_frames = False
        if isinstance(expected_frames, int) and expected_frames > 0:
            short_frames = len(images) < expected_frames

        if ocr_failed:
            status = "partial"
        elif ocr_attempted and not image_text:
            status = "partial"  # OCR came back empty
        elif low_conf:
            status = "partial"  # OCR low-confidence
        elif metadata.get("hasAudio") is False or (
            metadata.get("isVideo") and not transcript
        ):
            status = "partial"  # video with no audio track / empty transcript
        elif short_frames:
            status = "partial"  # frames list shorter than expected
        elif decoded_none:
            status = "partial"

    return {
        "assetId": assetId,
        "adviserId": adviserId or "",
        "channel": channel or "",
        "imageText": image_text,
        "transcript": transcript,
        "captionText": captionText,
        "frames": frames,
        "extractionStatus": status,
        "metadata": metadata,
        "signals": signals,
    }


def _asset_id(
    images: list[str], frames: list[str], transcript: str, captionText: str,
    metadata: dict,
) -> str:
    """Deterministic asset id from content + client-supplied submittedAt (no clock call)."""
    seed = ""
    if images:
        seed = images[0]
    elif frames:
        seed = frames[0]
    elif transcript:
        seed = transcript
    elif captionText:
        seed = captionText
    submitted = str(metadata.get("submittedAt") or metadata.get("date") or "")
    digest = hashlib.sha256((seed + "|" + submitted).encode("utf-8")).hexdigest()
    return "asset_" + digest[:16]


# ---------------------------------------------------------------------------------------------
# Video-link (YouTube) transcript + thumbnail, and audio transcription for uploaded videos.
# ---------------------------------------------------------------------------------------------

_YT_ID = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})")


def youtube_id(url: str) -> str | None:
    m = _YT_ID.search(url or "")
    return m.group(1) if m else None


def _yt_proxy() -> str | None:
    """Residential proxy URL for reaching YouTube from a blocked (datacenter) IP.

    YouTube serves captions to residential IPs but blocks datacenter IPs (e.g.
    Cloud Run). Without a proxy, a video link screened locally returns a transcript
    but the same link screened in production returns an empty transcript and routes
    to manual review — the two environments disagree. Set YT_PROXY_URL to a
    residential proxy (e.g. a Bright Data zone: http://user:pass@host:port) so
    production fetches the same captions a local machine does. Falls back to the
    standard HTTPS_PROXY / HTTP_PROXY variables.
    """
    return (env("YT_PROXY_URL") or env("HTTPS_PROXY") or env("HTTP_PROXY") or "").strip() or None


def _youtube_transcript(vid: str) -> str:
    """Fetch a caption transcript, tolerant of both the 1.x and 0.6.x library APIs.

    Routes through YT_PROXY_URL when set, so it works the same from a datacenter IP
    (production) as from a residential IP (local). See _yt_proxy().
    """
    langs = ["en", "en-US", "en-GB", "hi"]
    try:
        from youtube_transcript_api import YouTubeTranscriptApi  # type: ignore
    except Exception as exc:  # pragma: no cover
        log.warning("youtube_transcript_api not installed: %s", exc)
        return ""

    proxy = _yt_proxy()
    proxy_config = None
    if proxy:
        try:
            from youtube_transcript_api.proxies import GenericProxyConfig  # type: ignore
            proxy_config = GenericProxyConfig(http_url=proxy, https_url=proxy)
        except Exception as exc:  # pragma: no cover — older lib without proxy support
            log.warning("YouTube proxy config unavailable, continuing direct: %s", exc)

    # 1.x instance API: YouTubeTranscriptApi(proxy_config=...).fetch(vid)
    try:
        try:
            api = YouTubeTranscriptApi(proxy_config=proxy_config)
        except TypeError:  # library without the proxy_config kwarg
            api = YouTubeTranscriptApi()
        fetched = api.fetch(vid, languages=langs)
        parts = [getattr(s, "text", None) or (s.get("text") if isinstance(s, dict) else "") for s in fetched]
        text = " ".join(p for p in parts if p).strip()
        if text:
            return text
    except Exception as exc:
        log.warning("YouTube transcript (fetch) unavailable for %s: %s", vid, exc)
    # 0.6.x classmethod API fallback (honours proxies kwarg / HTTPS_PROXY env)
    try:
        kwargs: dict[str, Any] = {"languages": langs}
        if proxy:
            kwargs["proxies"] = {"http": proxy, "https": proxy}
        segs = YouTubeTranscriptApi.get_transcript(vid, **kwargs)  # type: ignore[attr-defined]
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

    # Route the thumbnail fetch through the same proxy when one is configured.
    proxy = _yt_proxy()
    opener = (
        urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
        if proxy
        else urllib.request.build_opener()
    )

    thumb_data = None
    for name in ("maxresdefault", "hqdefault", "mqdefault"):
        try:
            req = urllib.request.Request(f"https://img.youtube.com/vi/{vid}/{name}.jpg",
                                         headers={"User-Agent": "Mozilla/5.0"})
            with opener.open(req, timeout=15) as resp:
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


def as_data_url(raw_bytes: bytes, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64,{base64.b64encode(raw_bytes).decode()}"
