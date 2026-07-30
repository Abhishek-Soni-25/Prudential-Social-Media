# Prudential Singapore — Social Media Surveillance & Media Compliance Platform

A responsible‑AI platform for **Prudential Singapore** that:

1. **Monitors** public social & community platforms (LinkedIn, Instagram, Telegram, Quora,
   Reddit, YouTube, **TikTok**) for mentions of Prudential, classifies each with an LLM into a
   **reputational / compliance‑conduct / market‑abuse / cyber‑operational** risk taxonomy,
   maps findings to **RACM/KRI**, and surfaces them in a branded analytics console.
2. **Screens** marketing creatives (text, image, **video**) against **MAS Guideline FSG‑03**
   and Prudential advertising policy in the **Media Compliance Analyzer**, with OCR + speech
   transcription, a config‑driven rule engine, and an append‑only audit register.

Everything runs as **one container** (React SPA + FastAPI API) — locally or on Google Cloud Run.

---

## Table of contents
- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start (local dev)](#quick-start-local-dev)
- [Run as a single container](#run-as-a-single-container)
- [Configuration](#configuration)
- [Data collection & the knowledge base](#data-collection--the-knowledge-base)
- [Video / reel sentiment](#video--reel-sentiment)
- [Media Compliance Analyzer](#media-compliance-analyzer)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Deployment (Cloud Run)](#deployment-cloud-run)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security, privacy & legal](#security-privacy--legal)

---

## Features

**Surveillance & risk**
- Multi‑channel keyword collection via **Bright Data** (Reddit, YouTube) and **Apify** actors
  (LinkedIn, Instagram, Telegram, Quora, **TikTok**).
- First‑party monitoring of **Prudential Singapore's own YouTube channel** (`@PrudentialSingapore`).
- Prudential‑scoped **relevance filter**, **sentiment + AI risk classification** (Groq),
  **severity** scoring and **RACM/KRI** mapping.
- **Collection window** — only content from the configured period (default **May–Jul 2026**)
  is stored.

**Analytics console** — Overview, Listening, Influencers & UGC, Topics & Themes, Content
Performance, PR & Reputation, Campaign Analytics, Marketing Report, Competition Benchmarking
(Share of Voice), Publish & Respond, Bulk Actions, Keyword Campaigns.

**Media Compliance Analyzer** — screen content / image / video creatives against MAS FSG‑03;
frame‑by‑frame OCR + voice‑over transcription; Approve / Advisory / Manual‑review / Reject
verdict; append‑only FSG‑03 audit register; officer‑managed Do's & Don'ts.

**Video / reel understanding** — TikTok, Instagram Reels and YouTube clips are **transcribed**
so their sentiment reflects what was said, not just the caption. A single video can also be
analysed on demand by URL (`POST /api/analyze/video`).

---

## Architecture

```
  DATA SOURCES     LinkedIn · Instagram · Telegram · Quora · TikTok   (Apify actors)
                   Reddit · YouTube                                    (Bright Data)
                   @PrudentialSingapore uploads                        (YouTube RSS)
                          |
                          v
  CONNECTORS       normalise every payload -> shared "Post" model
                          |
                          v
  PIPELINE         ingest -> collection-window filter -> relevance filter
                   -> video transcript enrichment (TikTok/IG/YouTube)
                   -> sentiment + AI risk classification (Groq)
                   -> severity -> case (+ RACM/KRI) -> escalation
                          |
                          v
  API + STORES     FastAPI /api/*  <->  JSON / JSONL knowledge base
                          |            (mentions.jsonl, cases/, audit.jsonl, ruleset)
                          v
  WEB CONSOLE      React SPA (dashboards, reports, publishing, Media Compliance)

  MEDIA COMPLIANCE (parallel) creative -> OCR + transcription -> rule engine -> verdict -> audit register
```

The Python backend does **raw extraction only**; the compliance **rule/decision engine is a
pure TypeScript function** (`frontend/src/compliance/`), so verdicts are reproducible.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18 + TypeScript, Vite, Vitest; hand‑built SVG charts |
| Backend | Python 3.11, FastAPI, Uvicorn; PyYAML + python‑dotenv |
| AI / ML | **Groq** — Llama 3.3 70B (risk/sentiment/text), Qwen 3.6 27B vision (OCR), Whisper v3 Turbo (speech‑to‑text); local VADER pre‑pass |
| Media | ffmpeg (frames + audio), Pillow / pillow‑heif (image normalisation), youtube‑transcript‑api |
| Data providers | Bright Data (Reddit, YouTube), Apify actors (LinkedIn, Instagram, Telegram, Quora, TikTok) |
| Deploy | Docker (multi‑stage) → Google Cloud Run; Cloud Build CI/CD |
| Storage | JSON / JSONL files under `data/` |

---

## Prerequisites

- **Python 3.11+** and **Node.js 20+**
- **ffmpeg** on the PATH (video frame sampling + audio extraction)
  - macOS `brew install ffmpeg` · Debian/Ubuntu `sudo apt-get install -y ffmpeg`
  - *(optional, for iPhone HEIC images)* `libheif` (`sudo apt-get install -y libheif1`)
- API keys (see [Configuration](#configuration)):
  - **Groq** (required) — https://console.groq.com/keys
  - **Bright Data** and **Apify** (required for live collection)

---

## Quick start (local dev)

```bash
# 1. Clone
git clone <your-repo-url>
cd Prudential-Social-Media-Monitoring

# 2. Backend
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 3. Secrets
cp .env.example .env                 # then edit .env (at minimum set GROQ_API_KEY)

# 4. Run the API (serves /api on :8000)
uvicorn src.api:app --reload --port 8000
```

In a second terminal:

```bash
# 5. Frontend dev server (proxies /api -> :8000)
cd frontend
npm install
npm run dev                          # open http://localhost:5173
```

Open **http://localhost:5173**. The dashboard loads whatever is stored in the knowledge base.
Click **Run Scan** to collect & classify fresh content (billable — calls Bright Data/Apify/Groq).

> The current page is kept in the URL hash (e.g. `#campaign`), so a refresh keeps you on the
> same module. Only **real stored data** is shown — there is no demo/placeholder data.

---

## Run as a single container

The Dockerfile builds the SPA and serves it together with the API on one port — identical to
production.

```bash
docker build -t pru-surveillance .
docker run --rm -p 8080:8080 \
  -e GROQ_API_KEY=your_key \
  -e BRIGHTDATA_API_KEY=your_key \
  -e APIFY_TOKEN=your_token \
  pru-surveillance
# open http://localhost:8080
```

---

## Configuration

Two files drive everything. **Secrets are only in `.env`, never in the YAML.**

### `.env` (copy from `.env.example`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | ✅ | LLM inference (classification, OCR, transcription) |
| `GROQ_API_KEY_2`, `GROQ_API_KEY_3` | optional | additional keys, rotated to extend the free‑tier quota |
| `BRIGHTDATA_API_KEY` | for live | Reddit + YouTube collection |
| `APIFY_TOKEN` | for live | LinkedIn, Instagram, Telegram, Quora, TikTok |
| `QUORA_SESSION_COOKIES` | for Quora | the Quora actor returns 0 results without valid `quora.com` cookies |
| `INSTAGRAM_SESSION_COOKIES` | optional | improves Instagram throughput |

### `config/config.yaml` (non‑secret)

Key sections:

- `collection` — the **date window** kept in the knowledge base and the video‑transcription budget:
  ```yaml
  collection:
    since: "2026-05-01"
    until: "2026-07-31"
    transcribe_video: true          # download + Whisper reels without captions
    max_video_mb: 20
    max_video_transcriptions: 40     # per‑scan cap (cost control)
  ```
- `target` — organisation name, aliases, official handles (drives the relevance filter).
- `thresholds` — min LLM confidence to raise HIGH / MEDIUM / LOW alerts.
- `analysis` — Groq model fallback chain + throttle.
- `compliance` — vision/transcribe models + video frame‑OCR budget.
- `apify.actors` / `brightdata.datasets` — provider IDs and input templates.
- `channels` — which channels run and via which provider/mode. Modes:
  `brightdata` · `apify` · `youtube_channel` · `n8n` · `demo` · `live`.
- `competitors` — Share‑of‑Voice benchmark set (AIA, Great Eastern, Income, Manulife).

---

## Data collection & the knowledge base

Click **Run Scan** in the UI (or `POST /api/scan`, or the CLI below) to run one collection
cycle across every enabled channel. Each item is: window‑filtered → relevance‑filtered →
(video) transcribed → classified → appended to **`data/mentions.jsonl`** (the knowledge base).
Re‑scans are **manual** to control provider cost; stored data is reused between sessions.

```bash
# CLI (one cycle, then exit)
python -m src.main --once
```

**Channels & providers**

| Channel | Provider / mode | Notes |
| --- | --- | --- |
| LinkedIn | Apify (`apify`) | public posts by keyword (3‑month window) |
| Instagram | Apify (`apify`) | posts **and reels** by keyword; reels are transcribed |
| Telegram | Apify (`apify`) | public channels by keyword |
| Quora | Apify (`apify`) | answers by keyword (**needs session cookies**) |
| TikTok | Apify `clockworks/tiktok-scraper` (`apify`) | video caption + subtitles; transcribed for sentiment |
| Reddit | Bright Data (`brightdata`) | posts by keyword |
| YouTube | Bright Data (`brightdata`) | videos by keyword |
| YouTube (Prudential) | `youtube_channel` | first‑party uploads from `@PrudentialSingapore`, transcribed |

---

## Video / reel sentiment

For TikTok, Instagram Reels and YouTube, the pipeline folds a **transcript** of the spoken
content into the item's text before classification, so the sentiment reflects the clip:

- **YouTube** — caption transcript via `youtube-transcript-api`.
- **TikTok** — the actor's auto‑caption subtitle track, else download the clip and Whisper it.
- **Instagram Reels** — download the reel and Whisper it (when a video URL is returned).

Analyse a **single video by URL** on demand:

```bash
curl -X POST http://localhost:8000/api/analyze/video \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@user/video/1234567890"}'
# -> { sentiment, risk_category, severity, confidence, rationale, transcript, ... }
# also supports youtube.com / youtu.be and instagram.com reel URLs; the result is stored.
```

---

## Media Compliance Analyzer

Open **Media Compliance** in the sidebar. Paste content, or upload an image or video; the
backend extracts everything readable (image + frame‑by‑frame OCR, voice‑over transcription,
caption), the rule engine screens it against **MAS FSG‑03**, and returns an
**Approve / Advisory / Manual‑review / Reject** verdict. Every screening and rule‑set change
is appended to **`data/compliance/audit.jsonl`** (the FSG‑03 advertising register).

Rules live in `config/rules/prudential-sg-v1.json` (shipped default) and
`data/compliance/ruleset-active.json` (runtime overlay written from **Settings**). Officers can
add custom Do's & Don'ts in the Settings page.

On the **Overview** dashboard, each analysed post shows a read‑only **Compliant / Non‑compliant**
status. Open a row to see **why** it is non‑compliant (the exact FSG‑03 rules that fired) and to
**send a notification to the author** (demo action).

---

## API reference

Base path `/api` (same origin as the SPA).

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | liveness |
| `GET /api/mentions` | analysed‑item feed (the knowledge base) |
| `GET /api/authors` · `GET /api/sentiment` | per‑account activity · sentiment by platform |
| `GET /api/stats` · `GET /api/channels` | dashboard aggregates · configured channels |
| `POST /api/scan` · `GET /api/scan/status` | trigger a collection cycle · poll status |
| `GET /api/competitors` · `POST /api/scan/competitors` | Share‑of‑Voice · competitor scan |
| `POST /api/analyze/video` | analyse one TikTok/YouTube/Instagram URL |
| `GET/POST /api/keywords` | manage campaign keywords |
| `POST /api/compliance/extract` · `/extract/video` · `/extract/link` | OCR / transcription |
| `GET/PUT /api/compliance/ruleset` | read / replace the active rule set |
| `POST/GET /api/compliance/audit` · `GET /api/compliance/audit.csv` | FSG‑03 register |
| `POST /api/publish/reply` · `/post` · `GET /api/publish/outbox` | publishing (demo) |

---

## Project structure

```
config/
  config.yaml                 runtime config (channels, providers, collection window, models)
  rules/prudential-sg-v1.json shipped MAS FSG-03 rule set
src/
  api.py                      FastAPI app: /api/* + serves the built SPA
  main.py                     orchestrator: build_connectors + run_cycle (+ CLI)
  media_enrich.py             video/reel transcript enrichment for sentiment
  compliance.py               OCR, transcription, frame sampling, YouTube fetch
  mentions.py                 the mentions.jsonl knowledge base
  connectors/                 brightdata, apify (incl. TikTok), youtube_channel, n8n, demo, ...
  pipeline/                   ingest, relevance, sentiment, risk_classifier, alerting
frontend/
  src/App.tsx                 hash routing + data loading (real data only)
  src/pages, src/components   dashboards, tables, drawer, Media Compliance UI
  src/compliance/             pure TS rule engine, matcher, decision engine, audit log
data/                         mentions.jsonl, cases/, compliance/ (audit + ruleset), state/
Dockerfile · cloudbuild.yaml  single-container build + Cloud Run deploy
```

---

## Deployment (Cloud Run)

The app deploys as one Cloud Run service via Cloud Build. See **`DEPLOY.md`** for the full
walkthrough. In short:

1. Push the repo (with `Dockerfile`, `cloudbuild.yaml`, `.dockerignore`).
2. Enable Cloud Build, Cloud Run and Artifact Registry; grant Cloud Build the Run Admin +
   Service Account User roles.
3. Create a Cloud Build trigger on `/cloudbuild.yaml`; set substitution `_GROQ_API_KEY` (and any
   provider keys you inject as env vars).
4. Push to the branch — Cloud Build builds the image and deploys it. Open the Service URL.

> For consistent behaviour across users/machines, point everyone at **one** deployed backend so
> they share the same LLM egress and the same rule‑set overlay.

One‑shot deploy without a trigger:
```bash
gcloud run deploy prudential-surveillance --source . --region asia-south1 \
  --allow-unauthenticated --port 8080 --set-env-vars GROQ_API_KEY=YOUR_KEY
```

---

## Testing

```bash
# Frontend unit tests (decision engine, matcher, audit log)
cd frontend && npm test

# Type-check + production build
npm run build
```

---

## Troubleshooting

- **Dashboard empty / "Backend unreachable"** — ensure the API is running on `:8000` (dev) and
  reachable; the SPA calls `/api` on the same origin.
- **"No stored mentions yet"** — click **Run Scan** (needs provider + Groq keys) or run
  `python -m src.main --once`.
- **A channel is skipped** — its provider credential is missing in `.env` (check the API logs).
- **Quora returns nothing** — set valid `QUORA_SESSION_COOKIES` from the `quora.com` domain.
- **Video not transcribed** — install `ffmpeg`; some YouTube videos have captions disabled
  (then only the title/caption is scored). Whisper needs a working `GROQ_API_KEY`.
- **OCR fails for some images** — install `libheif` for HEIC; the backend otherwise normalises
  common formats to JPEG automatically.

---

## Security, privacy & legal

- **Public / authorised data only.** ToS‑gated connectors are off by default; WhatsApp E2E
  content is never read.
- **PII minimisation** — author identifiers are pseudonymised (SHA‑256) in stored cases;
  retention and allow‑lists are config‑driven (PDPA/GDPR aligned).
- **Human‑in‑the‑loop** — the platform flags and routes; it takes no enforcement action.
- **Auditability** — the compliance decision engine is a pure, reproducible function; every
  screening and rule‑set change is written to an append‑only register.
- Never commit `.env` or provider cookies.
