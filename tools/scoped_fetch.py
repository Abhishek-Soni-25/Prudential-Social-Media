"""Cost-bounded scoped fetch into the real knowledge base (data/mentions.jsonl).

Runs ONLY the requested channels, with small hard caps on how much each paid actor
scrapes, so credits are not drained. Every channel is wrapped so one failure never
stops the others and never removes existing data (the pipeline only appends).

Usage (from repo root):
    python scoped_fetch.py youtube_channel,tiktok,quora
"""
import sys, copy, json, logging
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
load_dotenv(".env")

from src.config import load_config
from src import main as m, mentions as mentions_store
from src.pipeline.risk_classifier import RiskClassifier
from src.escalation import Escalation

channels = (sys.argv[1] if len(sys.argv) > 1 else "youtube_channel,tiktok,quora").split(",")
channels = [c.strip() for c in channels if c.strip()]

cfg = copy.deepcopy(load_config())

# ---- Hard cost caps -------------------------------------------------------------
cfg["max_items_per_poll"] = 25                 # keep at most N posts/channel

# Quora is the priciest actor ($0.10/question + $0.05/answer) — keep it tiny.
q = cfg.setdefault("apify", {}).setdefault("actors", {}).setdefault("quora", {})
q["input_template"] = {"maxQuestions": 3, "scrapeAnswers": True, "maxAnswersPerQuestion": 2}
# TikTok — a modest page of videos with subtitles for transcription.
t = cfg["apify"]["actors"].setdefault("tiktok", {})
t.setdefault("input_template", {}).update({"resultsPerPage": 15, "shouldDownloadVideos": False})
# Instagram / Telegram / LinkedIn — cap page sizes too (used in round 2).
cfg["apify"]["actors"].get("instagram", {}).setdefault("input_template", {}).update({"maxPosts": 20})
cfg["apify"]["actors"].get("linkedin", {}).setdefault("input_template", {}).update({"maxPosts": 25})
cfg["apify"]["actors"].get("telegram", {}).setdefault("input_template", {}).update({"maxResultsPerKeyword": 25})
# Bright Data (reddit/youtube keyword) — cap discovery volume (used in round 2).
for ch in ("reddit", "youtube"):
    cfg.setdefault("channels", {}).get(ch, {}).setdefault("extra_input", {})["num_of_posts"] = 20
# Bound video transcription (Whisper) per run.
cfg.setdefault("collection", {})["max_video_transcriptions"] = 15

# ---- Enable ONLY the requested channels ----------------------------------------
for name, ch in cfg.get("channels", {}).items():
    ch["enabled"] = name in channels

before = len(mentions_store.load_mentions())
print(f"[scoped_fetch] channels={channels}  knowledge base before={before}")

connectors = m.build_connectors(cfg)
print(f"[scoped_fetch] built {len(connectors)} connector(s): {[c.channel for c in connectors]}")

acfg = cfg.get("analysis", {})
classifier = RiskClassifier(
    model=acfg.get("model"), models=acfg.get("models"),
    max_tokens=acfg.get("max_tokens", 1024),
    requests_per_minute=acfg.get("requests_per_minute", 25),
    max_retries=acfg.get("max_retries", 3),
    target_name=cfg.get("target", {}).get("name", "the organization"),
)
escalation = Escalation(cfg.get("escalation", {}))

stats = m.run_cycle(connectors, classifier, escalation, cfg)
after = len(mentions_store.load_mentions())

# Per-channel tally of what actually landed.
by_ch = {}
for rec in mentions_store.load_mentions():
    by_ch[rec.get("platform")] = by_ch.get(rec.get("platform"), 0) + 1

print("[scoped_fetch] DONE")
print(json.dumps({
    "requested": channels,
    "cycle_stats": stats,
    "kb_before": before, "kb_after": after, "added": after - before,
    "kb_by_channel": by_ch,
}, indent=2))
