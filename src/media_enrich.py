"""Video / reel enrichment for sentiment analysis.

Text-only channels (Reddit, Quora, LinkedIn text posts) already carry everything the
classifier needs in ``post.text``. Video channels — TikTok, Instagram Reels, YouTube —
do not: the meaning is in what is *said and shown*, and the caption alone is a poor proxy
for the sentiment of the clip. So before classification we obtain a transcript of the
spoken content and fold it into the post's text, so the Groq sentiment/risk pass reflects
the actual reel, not just its caption.

Transcript sources, in order of preference (all best-effort — an item without one simply
falls back to its caption):
  * YouTube        → caption transcript via youtube-transcript-api (compliance.fetch_youtube).
  * TikTok         → the auto-caption subtitle track the Apify actor returns (subtitle_url),
                     else download the video and transcribe the audio with Whisper.
  * Instagram Reel → download the reel video and transcribe with Whisper.

Downloads are size-capped and every step is wrapped so a failure never breaks a scan.
"""

from __future__ import annotations

import logging
import re
import urllib.request

from .models import Post
from . import compliance as compliance_mod

log = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (compatible; PrudentialSurveillance/1.0)"


def _download(url: str, max_bytes: int) -> bytes | None:
    """GET up to ``max_bytes`` of a media URL. Returns None on any failure/oversize."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = resp.read(max_bytes + 1)
        if not data or len(data) > max_bytes:
            log.info("media_enrich: skipping oversize/empty download (%s)", url[:80])
            return None
        return data
    except Exception as exc:  # noqa: BLE001
        log.info("media_enrich: download failed (%s): %s", url[:80], exc)
        return None


_VTT_TS = re.compile(r"^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->")
_TAG = re.compile(r"<[^>]+>")


def _subtitle_to_text(raw: str) -> str:
    """Flatten a WebVTT / SRT subtitle file into plain, de-duplicated speech text."""
    out: list[str] = []
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s or s == "WEBVTT" or s.isdigit() or "-->" in s or _VTT_TS.match(s):
            continue
        s = _TAG.sub("", s).strip()
        if s and (not out or out[-1] != s):
            out.append(s)
    return " ".join(out).strip()


def _fetch_subtitle(url: str) -> str:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read(2_000_000).decode("utf-8", "ignore")
        return _subtitle_to_text(raw)
    except Exception as exc:  # noqa: BLE001
        log.info("media_enrich: subtitle fetch failed: %s", exc)
        return ""


def transcript_for(post: Post, cfg: dict) -> str:
    """Best-effort transcript of a video post's spoken content ('' if unavailable)."""
    meta = post.raw_meta or {}
    url = post.url or ""
    channel = (post.channel or "").lower()

    # 1) YouTube — caption transcript (no download).
    if channel in ("youtube", "youtube_channel") or "youtube.com" in url or "youtu.be" in url:
        try:
            return (compliance_mod.fetch_youtube(url).get("transcript") or "").strip()
        except Exception as exc:  # noqa: BLE001
            log.info("media_enrich: youtube transcript failed: %s", exc)
            return ""

    # 2) TikTok auto-caption subtitle track supplied by the Apify actor.
    sub_url = meta.get("subtitle_url")
    if sub_url:
        text = _fetch_subtitle(sub_url)
        if text:
            return text

    # 3) Download the clip and transcribe the audio with Whisper.
    coll = cfg.get("collection", {})
    if coll.get("transcribe_video", True):
        video_url = meta.get("video_url")
        if video_url:
            max_bytes = int(coll.get("max_video_mb", 20)) * 1024 * 1024
            data = _download(video_url, max_bytes)
            if data:
                try:
                    return (compliance_mod.transcribe(data, "clip.mp4", cfg) or "").strip()
                except Exception as exc:  # noqa: BLE001
                    log.info("media_enrich: whisper transcribe failed: %s", exc)
    return ""


def enrich_post(post: Post, cfg: dict, budget: dict | None = None) -> str:
    """If ``post`` is a video/reel, fold a transcript into its text so sentiment/risk
    reflect the clip's spoken content. Returns the transcript (or '').

    ``budget`` — optional mutable {"left": int} that caps how many transcriptions a single
    scan performs (video transcription is the most expensive step). When exhausted, the
    post is analysed on its caption alone.
    """
    meta = post.raw_meta or {}
    is_video = bool(meta.get("is_video")) or (post.channel or "").lower() in ("youtube", "youtube_channel", "tiktok")
    if not is_video:
        return ""
    if budget is not None and budget.get("left", 0) <= 0:
        return ""

    transcript = transcript_for(post, cfg)
    if not transcript:
        return ""
    if budget is not None:
        budget["left"] = budget.get("left", 0) - 1

    transcript = transcript[:6000]
    meta["transcript"] = transcript
    post.raw_meta = meta
    # Append so the caption context is preserved alongside the spoken content.
    post.text = (post.text + "\n\n[Video transcript] " + transcript).strip()
    return transcript
