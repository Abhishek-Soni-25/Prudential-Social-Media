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


def normalize_image(src: str | None, max_dim: int = 1600, quality: int = 85) -> str | None:
    """Re-encode ANY still image into a clean JPEG data URL the vision model accepts.

    The Groq vision endpoint only accepts a handful of formats (JPEG/PNG/WEBP/GIF) and
    rejects oversized payloads. Uploads in the wild are anything but — HEIC from an
    iPhone, BMP/TIFF from a scanner, a 12 MP PNG screenshot, a CMYK JPEG. Feeding those
    straight to the API is exactly why "only some images parse": the odd ones 4xx and
    the extraction degrades to manual review.

    So we decode with Pillow (which reads far more formats than the API), flatten
    transparency onto white, convert to RGB, downscale the long edge to ``max_dim`` and
    re-encode as JPEG. Every creative then reaches the model as the same, small,
    guaranteed-accepted shape — which also makes the OCR result far more consistent from
    one machine/network to the next.

    Best-effort: if Pillow is unavailable or the bytes won't decode, return ``src``
    unchanged so an already-valid JPEG still goes through.
    """
    if not src:
        return src
    # Only data URLs carry raw bytes we can transcode; pass through anything else (e.g. a
    # remote https thumbnail) untouched.
    if not src.startswith("data:"):
        return src
    try:
        header, _, b64 = src.partition(",")
        if not b64:
            return src
        raw = base64.b64decode(b64, validate=False)
    except Exception:  # noqa: BLE001
        return src
    try:
        import io

        from PIL import Image  # Pillow

        # Opt-in HEIC/AVIF support (iPhone photos) when pillow-heif is installed.
        try:  # pragma: no cover - depends on optional dep
            import pillow_heif  # type: ignore

            pillow_heif.register_heif_opener()
        except Exception:  # noqa: BLE001
            pass

        img = Image.open(io.BytesIO(raw))
        img.load()
        # Flatten alpha / palette onto a white background so JPEG (no alpha) is faithful.
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            rgba = img.convert("RGBA")
            bg.paste(rgba, mask=rgba.split()[-1])
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        # Downscale the long edge; never upscale.
        w, h = img.size
        if max(w, h) > max_dim:
            if w >= h:
                img = img.resize((max_dim, max(1, round(h * max_dim / w))))
            else:
                img = img.resize((max(1, round(w * max_dim / h)), max_dim))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality)
        return as_data_url(out.getvalue(), "image/jpeg")
    except Exception as exc:  # noqa: BLE001 - normalization is best-effort
        log.warning("image normalization skipped (%s); passing original through", exc)
        return src


def extract_text(images: list[str] | None, cfg: dict) -> dict[str, Any]:
    """OCR / scene-read image frames with the Groq vision model, batching every frame.

    Returns a dict:
        {"imageText": [{"text": str, "frame": int, "confidence": float}, ...],
         "signals": {"messaging_ui": bool, "face": bool, "chart": bool}}

    Every frame is normalised to a clean JPEG (see ``normalize_image``) and OCR'd — long
    clips are processed in batches of ``frame_ocr_batch`` so a video is read frame by
    frame rather than capped at the model's ~5-image-per-call limit. ``frame`` in each
    entry is the GLOBAL index into the input list, so hits map back to the right frame.
    It does NOT judge compliance. Raises only when EVERY batch failed to reach the model.
    """
    comp_cfg = cfg.get("compliance", {})
    # Env var wins so the model can be changed in production (e.g. Cloud Run) without a
    # rebuild if Groq decommissions it. Falls back to config.yaml, then a safe default.
    model = env("COMPLIANCE_VISION_MODEL") or comp_cfg.get("vision_model", "qwen/qwen3.6-27b")
    max_tokens = comp_cfg.get("max_tokens", 1600)
    batch_size = max(1, min(3, int(comp_cfg.get("frame_ocr_batch", 3))))  # qwen vision caps 3 imgs/call
    frame_cap = max(1, int(comp_cfg.get("frame_ocr_max", 12)))

    # Normalise every frame up-front so the model always gets an accepted JPEG, then cap.
    images = [n for n in (normalize_image(i) for i in (images or []) if i) if n][:frame_cap]

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

    def _instruction(n: int) -> str:
        return (
            f"Read the {n} image(s) below. Return ONLY the visible text, verbatim, "
            "and coarse visual signals. Respond with ONLY a JSON object of this exact shape:\n"
            '{"imageText": [{"text": "<one line of visible text>", "frame": <0-based index of '
            'the image the line came from>, "confidence": <0..1>}], '
            '"signals": {"messaging_ui": <true if a chat/messaging app UI is visible>, '
            '"face": <true if a human face is visible>, "chart": <true if a chart/graph is '
            "visible>}}\n"
            "One imageText entry per distinct line of text. Do not interpret or judge."
        )

    def _call(client: Any, imgs: list[str], strict: bool = True) -> dict[str, Any]:
        content: list[dict[str, Any]] = [{"type": "text", "text": _instruction(len(imgs))}]
        for img in imgs:
            content.append({"type": "image_url", "image_url": {"url": img}})
        kwargs: dict[str, Any] = dict(
            model=model,
            messages=[{"role": "system", "content": _OCR_SYSTEM}, {"role": "user", "content": content}],
            temperature=0,
            max_tokens=max_tokens,
        )
        # Strict json_object mode makes Groq reject a response whose JSON doesn't validate
        # (400 json_validate_failed) — which happens intermittently. When it does we retry
        # WITHOUT the strict format and parse the text loosely (_parse_ocr tolerates prose
        # around the JSON), so a flaky serialisation no longer wipes out the OCR.
        if strict:
            kwargs["response_format"] = {"type": "json_object"}
        resp = client.chat.completions.create(**kwargs)
        return _parse_ocr(resp.choices[0].message.content or "", len(imgs))

    def _ocr_batch(imgs: list[str]) -> dict[str, Any]:
        """OCR one batch (≤3 imgs): rotate keys on rate-limit, halve on 413, recover on
        the model's occasional invalid-JSON 400 by retrying in non-strict mode."""
        last_exc: Exception | None = None
        for key in keys:
            client = Groq(api_key=key)
            attempt = list(imgs)
            while attempt:
                try:
                    return _call(client, attempt)
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    s = str(exc).lower()
                    # The model emitted un-validatable JSON. Retry once in non-strict mode
                    # (parse loosely); if that also fails, fall through to the next key.
                    if "json_validate" in s or "failed to validate json" in s or "json_object" in s:
                        try:
                            return _call(client, attempt, strict=False)
                        except Exception as exc2:  # noqa: BLE001
                            last_exc = exc2
                            break  # next key
                    too_large = (
                        "413" in s or "too large" in s or "tokens per minute" in s
                        or "request_too_large" in s or "too many images" in s or "supports up to" in s
                    )
                    if too_large and len(attempt) > 1:
                        attempt = attempt[: max(1, len(attempt) // 2)]  # halve and retry
                        continue
                    if "429" in s or "rate" in s or "quota" in s or "per day" in s:
                        break  # try the next key
                    raise
        raise RuntimeError(f"Vision OCR call failed: {last_exc}")

    # Process every frame in batches; merge, remapping each batch's local frame index to
    # the global one. A single batch failing does not sink the whole extraction.
    merged_text: list[dict[str, Any]] = []
    signals = {"messaging_ui": False, "face": False, "chart": False}
    batch_errors: list[str] = []
    for start in range(0, len(images), batch_size):
        batch = images[start : start + batch_size]
        try:
            res = _ocr_batch(batch)
        except Exception as exc:  # noqa: BLE001
            batch_errors.append(f"{type(exc).__name__}: {exc}")
            continue
        for item in res.get("imageText", []) or []:
            local = item.get("frame") or 0
            try:
                local = int(local)
            except (TypeError, ValueError):
                local = 0
            item["frame"] = start + max(0, min(local, len(batch) - 1))
            merged_text.append(item)
        for k in signals:
            signals[k] = signals[k] or bool(res.get("signals", {}).get(k))

    # Only surface a hard failure if NOTHING came back across every batch — a partial
    # read (some batches succeeded) is still a usable extraction.
    if not merged_text and batch_errors and len(batch_errors) == (len(images) + batch_size - 1) // batch_size:
        raise RuntimeError(f"Vision OCR call failed: {batch_errors[-1]}")

    return {"imageText": merged_text, "signals": signals}


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
    ocr_error: str | None = None
    if images:
        try:
            ocr = extract_text(images, cfg)
        except Exception as exc:  # noqa: BLE001 — extraction must degrade, not crash
            # Surface the reason: a dead/misconfigured vision model must not look like a
            # generic "partial". log.exception keeps the stack; the reason is also returned
            # in metadata so the UI and audit log show WHY, not just that it failed.
            log.exception("extract_text failed during build_extraction")
            ocr_failed = True
            ocr_error = f"{type(exc).__name__}: {exc}"

    image_text = ocr.get("imageText", []) or []
    signals = ocr.get("signals", {}) or {}

    if assetId is None:
        assetId = _asset_id(images, frames, transcript, captionText, metadata)

    # ---- extractionStatus ----
    # An extraction is trustworthy ('complete') as long as we actually READ the creative
    # and got at least one usable signal: visible text, a voice-over transcript, or a
    # caption. A still with no text, or a video that is music-only, is a COMPLETE read
    # that simply found nothing to flag — not an "incomplete extraction". Only two things
    # degrade the status, so genuine dead-ends still reach a human instead of auto-passing:
    #   * 'failed'  — we were asked to read frames but NONE decoded and there is no
    #                 transcript and no caption: nothing was read at all (corrupt file,
    #                 dead link). This is the only path that blocks on emptiness.
    #   * 'partial' — the vision model itself errored (network blocked / model down) AND
    #                 that left us with no text, no transcript and no caption, so we can't
    #                 vouch for the read. If OCR errored but a transcript or caption still
    #                 gives us content, we keep 'complete' and just note the error.
    requested = ocr_attempted or (frames is not None and len(frames) > 0)
    has_any_content = bool(image_text) or bool(transcript) or bool(captionText)

    if ocr_failed and ocr_error:
        metadata["extractionError"] = ocr_error  # visible reason for the reviewer/audit log

    if link_failed:
        status = "failed"
    elif requested and not images and not transcript and not captionText:
        status = "failed"  # frames expected, none decoded, nothing else read
    elif ocr_failed and not has_any_content:
        status = "partial"  # model unreachable and no other signal to fall back on
    else:
        status = "complete"

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


def _extract_audio(file_bytes: bytes, filename: str) -> tuple[bytes, str] | None:
    """Transcode a video/audio upload to a small mono 16 kHz MP3 with ffmpeg.

    Whisper only needs the audio, so shipping the whole 15-20 MB video is slow and can
    trip the API's file-size limit. Pulling a compact MP3 first (a 40 s clip is well
    under 1 MB) makes transcription fast and reliable. Returns ``None`` when ffmpeg is
    absent or the file genuinely has no audio track, so the caller degrades gracefully
    (a music-/silence-only video is a valid, complete extraction — just no transcript).
    """
    import os
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("ffmpeg"):
        return None
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, os.path.basename(filename or "video.mp4"))
        out = os.path.join(td, "audio.mp3")
        with open(src, "wb") as fh:
            fh.write(file_bytes)
        cmd = [
            "ffmpeg", "-y", "-i", src,
            "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", out,
        ]
        try:
            subprocess.run(cmd, capture_output=True, timeout=180)
        except Exception as exc:  # noqa: BLE001
            log.warning("ffmpeg audio extraction failed: %s", exc)
            return None
        if not os.path.exists(out) or os.path.getsize(out) < 256:
            return None  # no audio track (or empty) — not an error
        try:
            return open(out, "rb").read(), "audio.mp3"
        except Exception:  # noqa: BLE001
            return None


def transcribe(file_bytes: bytes, filename: str, cfg: dict) -> str:
    """Transcribe an uploaded video/audio file's voice-over with Groq Whisper.

    Extracts a compact MP3 first (see ``_extract_audio``) so large videos transcribe
    quickly and never hit the API's size ceiling; falls back to sending the original
    bytes when ffmpeg is unavailable. An empty result is normal for a silent clip and is
    NOT treated as a failure by the caller.
    """
    model = cfg.get("compliance", {}).get("transcribe_model", "whisper-large-v3-turbo")
    keys = _keys()
    if not keys:
        return ""

    audio = _extract_audio(file_bytes, filename)
    send_bytes, send_name = audio if audio else (file_bytes, filename or "video.mp4")

    from groq import Groq
    last_exc: Exception | None = None
    for key in keys:
        try:
            client = Groq(api_key=key)
            resp = client.audio.transcriptions.create(
                file=(send_name, send_bytes), model=model, response_format="text",
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


def sample_video_frames(file_bytes: bytes, filename: str, cfg: dict, max_frames: int | None = None) -> list[str]:
    """Extract frames from an uploaded video with ffmpeg and return them as JPEG data
    URLs, evenly spaced across the whole clip. This is server-side (no reliance on the
    browser's canvas capture), so the frames are reliable and OCR can read text burned
    into the video. Returns [] if ffmpeg is unavailable or the decode fails.
    """
    import glob
    import os
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("ffmpeg"):
        log.warning("ffmpeg not found — cannot extract video frames server-side")
        return []

    comp_cfg = cfg.get("compliance", {})
    fps = comp_cfg.get("frame_fps", 1)          # sample 1 frame per second, then thin out
    cap = comp_cfg.get("frame_scan_cap", 90)    # never decode more than this many
    width = comp_cfg.get("frame_width", 640)    # downscale: image tokens scale with resolution,
                                                # and the Groq free tier caps ~8000 tokens/minute
    # Keep in step with extract_text's per-frame OCR budget so every returned frame is read.
    if max_frames is None:
        max_frames = max(1, int(comp_cfg.get("frame_ocr_max", 12)))
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, os.path.basename(filename or "video.mp4"))
        with open(src, "wb") as fh:
            fh.write(file_bytes)
        pattern = os.path.join(td, "f_%04d.jpg")
        cmd = [
            "ffmpeg", "-y", "-i", src,
            "-vf", f"fps={fps},scale='min({width},iw)':-2",
            "-frames:v", str(cap), "-q:v", "5", pattern,
        ]
        try:
            subprocess.run(cmd, capture_output=True, timeout=180)
        except Exception as exc:  # noqa: BLE001
            log.warning("ffmpeg frame extraction failed: %s", exc)
            return []
        files = sorted(glob.glob(os.path.join(td, "f_*.jpg")))
        if not files:
            return []
        # Evenly sample up to max_frames across the whole video (extract_text caps at 5).
        if len(files) > max_frames:
            step = len(files) / max_frames
            files = [files[min(len(files) - 1, int(i * step))] for i in range(max_frames)]
        frames: list[str] = []
        for fp in files:
            try:
                frames.append(as_data_url(open(fp, "rb").read(), "image/jpeg"))
            except Exception:  # noqa: BLE001
                continue
        return frames


def suggest_posts(draft: str, avoid: list[str], cfg: dict, n: int = 6) -> list[str]:
    """Generate MAS-compliant social-media post suggestions with the Groq text model.

    ``avoid`` is the list of restricted terms/rule titles pulled from the live rule
    set, so custom don'ts added in Settings shape the suggestions too.
    """
    comp_cfg = cfg.get("compliance", {})
    model = env("COMPLIANCE_TEXT_MODEL") or comp_cfg.get("text_model", "llama-3.3-70b-versatile")
    keys = _keys()
    if not keys:
        raise RuntimeError("No Groq API key configured (GROQ_API_KEY).")
    from groq import Groq

    avoid_txt = "; ".join(a for a in avoid if a) or "guaranteed returns, specific return figures"
    system = (
        "You write ready-to-publish, professional social-media posts for a regulated insurance "
        "brand in Singapore under MAS Guideline FSG-03. Write each suggestion as a COMPLETE post: "
        "an attention-grabbing opening line, one or two sentences of genuine, specific value or "
        "insight, and a soft, non-pushy call to action. Aim for roughly 300-600 characters across "
        "2-4 short lines; use tasteful line breaks, at most one or two emojis, and 1-3 relevant "
        "hashtags. Keep it warm, factual and educational. Every post MUST avoid: guaranteed, "
        "assured, risk-free or capital-protected returns; any specific investment return, yield or "
        "growth figure or percentage; client testimonials or chat screenshots; urgency or scarcity "
        "pressure; the restricted term 'financial advisor'; and these restricted items from policy: "
        + avoid_txt + ". Never promise or imply returns."
    )
    topic = draft.strip()
    user = (
        "The user is drafting a post about:\n\"" + (topic or "financial wellness") + "\"\n\n"
        "Return ONLY a JSON object of the form {\"suggestions\": [\"...\", ...]} with " + str(n) +
        " distinct, ready-to-publish posts that build on and expand this topic. Each array item is "
        "one full, publishable post (with line breaks and hashtags), not a one-line phrase."
    )
    last_exc: Exception | None = None
    for key in keys:
        try:
            resp = Groq(api_key=key).chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.75,
                max_tokens=1800,
                response_format={"type": "json_object"},
            )
            data = _extract_json(resp.choices[0].message.content or "")

            def _clean(s: Any) -> str:
                # Drop the model's stray indentation on wrapped lines; keep real line breaks.
                return "\n".join(line.strip() for line in str(s).splitlines()).strip()

            out = [c for c in (_clean(s) for s in (data.get("suggestions") or [])) if c]
            return out[:n]
        except Exception as exc:  # try next key on rate-limit/quota
            last_exc = exc
            s = str(exc).lower()
            if "429" in s or "rate" in s or "quota" in s or "per day" in s:
                continue
            raise
    raise RuntimeError(f"Suggestion call failed: {last_exc}")
