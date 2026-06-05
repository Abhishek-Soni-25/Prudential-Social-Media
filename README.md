# Social Media Surveillance & Risk Management System

A responsible-AI platform for **Prudential Singapore** that monitors social media and
community platforms to proactively surface **reputational, compliance/conduct, market-abuse,
and cyber** risks — with sentiment analysis, AI risk classification, RACM/KRI mapping, and a
branded React risk console.

> **Working prototype.** Live **Reddit + LinkedIn** data is scraped by an n8n agent and
> classified in real time by an LLM. The other channels (Telegram, X, WhatsApp, Quora) are
> demonstrated from sample pools that run **entirely in the browser** (no backend, nothing
> stored). Every Run Scan shows **3 items per channel (≈18 total)**.

## Channels

| Channel   | Source            | How it works                                                              |
|-----------|-------------------|---------------------------------------------------------------------------|
| Reddit    | **n8n (live)**    | n8n agent (Google-search scraping) → backend draws **3 at random/scan** → LLM-classified. |
| LinkedIn  | **n8n (live)**    | Same n8n agent → **3 at random/scan** → LLM-classified.                   |
| Telegram  | **frontend demo** | 50-item Prudential pool, **3 drawn at random/scan**, pre-classified, client-side only. |
| X         | **frontend demo** | 50-item pool, 3 at random/scan, client-side only.                         |
| WhatsApp  | **frontend demo** | 50-item pool, 3 at random/scan, client-side only.                         |
| Quora     | **frontend demo** | 50-item pool, 3 at random/scan, client-side only.                         |

- Live Reddit/LinkedIn webhook: `config.yaml → n8n.webhook_url`.
- Demo pools: [`frontend/src/demoData.ts`](frontend/src/demoData.ts) (regenerate with
  `python tools/gen_demo_frontend.py`). Demo analysis is **pre-baked** per sample, so it runs
  with no backend call and nothing is persisted.
- The original live connectors (PRAW, Telethon, tweepy, a **ToS-gated** `linkedin-api`
  scraper, archive-feed stubs) remain in `src/connectors/` and can be re-enabled by switching
  a channel's `mode` in `config.yaml`.

## AI core: Groq · `llama-3.3-70b-versatile`

All LLM risk classification (sentiment + the 4 risk categories) uses the **Groq API** with
`llama-3.3-70b-versatile`. Set `GROQ_API_KEY` in `.env`. The classifier throttles to stay
under rate limits, retries on `429`, and falls back to the n8n-provided sentiment if the LLM
is unavailable, so live items always render. (The model name is intentionally not shown in
the UI.)

## Flow

```
ingest (n8n live  +  client-side demo pools)
   → relevance filter (Prudential Singapore mentions only)
   → sentiment + AI risk classification (Groq)   [demo: pre-baked]
   → severity (HIGH / MEDIUM / NO-RISK)
   → alerts shown on the dashboard (+ RACM/KRI, escalation in the CLI pipeline)
```

Negative/abusive content about the target → **REPUTATIONAL**; insider/mis-selling →
**COMPLIANCE_CONDUCT**; trading/leak chatter → **MARKET_ABUSE**; data-leak/credentials →
**CYBER_OPERATIONAL**; everything else analysed as **GENERAL** (no risk).

See [docs/architecture.md](docs/architecture.md) and [docs/risk-taxonomy.md](docs/risk-taxonomy.md).

## Quick start

```powershell
# 1. Backend deps
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2. Secrets — copy and add your Groq key
copy .env.example .env
#   set GROQ_API_KEY=...   (required; get one at https://console.groq.com/keys)

# 3. Run the backend API (serves live Reddit/LinkedIn classification)
.\.venv\Scripts\python.exe -m uvicorn src.api:app --port 8000

# 4. Run the dashboard (separate terminal)
cd frontend
npm install        # first time only
npm run dev        # open http://localhost:5173  (proxies /api -> :8000)
```

Click **Run Scan** to re-draw the demo channels (instant, client-side) and fetch a fresh
batch of live Reddit/LinkedIn items (classified by Groq).

The legacy stored pipeline (`python -m src.main --once`) and case files / escalation are still
available for the n8n channels but are not used by the dashboard.

## Dashboard

Prudential-branded console:
- **Stat cards** — items analysed, High / Medium / No-risk (counts reconcile to the total).
- **Insights** — highlight metrics (action-required, negative-sentiment %, top risk category,
  most-flagged channel) + a **sentiment breakdown**, **colour-coded risk categories**, and a
  **per-channel risk** view.
- **Monitored channels** strip, a filterable **analysed-content** table (severity, category,
  channel, sentiment, rationale, confidence) and a **detail drawer** (indicators, raw content,
  RACM/KRI, pseudonymized author).
- Red **alert banner** for high-severity items; severity tabs in the red nav double as filters.

`npm run build` produces a static bundle in `frontend/dist/`.

## Guardrails

- **Public / authorized data only** — no privacy-setting bypass; the bundled LinkedIn scraper
  is ToS-gated and off by default (see [docs/architecture.md](docs/architecture.md) §6).
- **PII minimization** — author identifiers are pseudonymized (SHA-256) in stored cases.
- **Jurisdictional compliance** — retention, hashing, allow-lists are config-driven (PDPA/GDPR).
- **Human-in-the-loop** — the system flags and routes; it takes no enforcement action.

## Project layout

```
src/
  api.py             FastAPI backend: /api/live (Reddit+LinkedIn), /api/cases, /api/scan ...
  main.py            CLI orchestrator (stored pipeline)
  config.py          Config + secrets loading
  models.py          Post, RiskAssessment, CaseFile dataclasses
  connectors/        n8n (live), demo, + optional PRAW/Telethon/tweepy/linkedin connectors
  pipeline/          ingest → relevance → sentiment → risk_classifier (Groq) → alerting
  case_management.py Case-file generation + JSON store (CLI pipeline)
  escalation.py      Routing of HIGH/MEDIUM alerts
frontend/
  src/demoData.ts    50 pre-classified demo samples per channel (generated)
  src/demo.ts        client-side draw + stats + insights
  src/components/    Header, NavBar, StatCards, Insights, CasesTable, CaseDrawer ...
tools/
  gen_demo_frontend.py   regenerates frontend/src/demoData.ts
docs/                Architecture + risk taxonomy
config/config.yaml   Runtime configuration (n8n webhook, target, models, thresholds, RACM)
```
