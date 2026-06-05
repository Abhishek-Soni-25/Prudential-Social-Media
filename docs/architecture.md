# Architecture

## 1. Purpose & scope

Responsible-AI surveillance of **public** social media and **legally authorized** internal
channels to detect emerging **reputational, compliance/conduct, market-abuse, cyber, and
operational** risk, flagged and escalated through a RACM/KRI-aligned case workflow.

This document describes the prototype's components, data flow, data model, and the
deliberate design decisions around legality, privacy, and channel feasibility.

## 2. High-level data flow

```
                ┌──────────────────────────────────────────────┐
                │                 CONNECTORS                     │
                │  Telegram   Reddit   X    [LinkedIn] [WhatsApp]│
                │   (live)    (live)  (live)  (stub)    (stub)   │
                └───────────────┬──────────────────────────────┘
                                │  normalized Post objects
                                ▼
        Step 1   ┌───────────────────────────┐
        INGEST   │  ingest.clean_and_parse    │  strip noise, keep ts/author/meta
                 └───────────────┬───────────┘
                                 ▼
        Step 2   ┌───────────────────────────┐
        SENTIMENT│  sentiment (VADER pre-pass)│  fast local triage score
                 └───────────────┬───────────┘
                                 ▼
        Step 3   ┌───────────────────────────┐
        RISK     │  risk_classifier (Gemini)  │  context/sarcasm/intent → taxonomy,
                 │  cached system prompt       │  severity, confidence, rationale
                 └───────────────┬───────────┘
                                 ▼
        Step 4   ┌───────────────────────────┐
        ALERT    │  alerting (thresholds)     │  HIGH / MEDIUM / LOW / NONE
                 └───────────────┬───────────┘
                    HIGH/MEDIUM   │
                                 ▼
                 ┌───────────────────────────┐     ┌──────────────────────┐
                 │  case_management           │────▶│  escalation (routing) │
                 │  structured CaseFile + store│     │  → stakeholders/teams │
                 └───────────────────────────┘     └──────────────────────┘
```

## 3. Components

### 3.1 Connectors (`src/connectors/`)
- `BaseConnector` — abstract interface. Every connector exposes `poll() -> list[Post]`,
  returning only items newer than its persisted cursor (`data/state/<channel>.json`).
- **Live:** `telegram_connector` (Telethon), `reddit_connector` (PRAW), `x_connector` (tweepy v2).
- **Stubs:** `linkedin_connector`, `whatsapp_connector` — implement the same interface but
  raise a clear `ConnectorUnavailable` unless an authorized compliance-archive endpoint is
  configured. See §6.

Connectors normalize platform payloads into the shared `Post` model so the downstream
pipeline is channel-agnostic.

### 3.2 Pipeline (`src/pipeline/`)
- `ingest` — cleaning/parsing: removes URLs-as-noise, system logs, control chars; preserves
  timestamp, author id, platform, and message id.
- `sentiment` — local VADER pass for a cheap first-order signal and to prioritize/triage
  before spending tokens. Polarity ∈ {Positive, Neutral, Negative, Mixed}.
- `risk_classifier` — the AI core. One **Gemini** API call per post with the full risk
  taxonomy as the `system_instruction` (§ risk-taxonomy.md), `response_mime_type=application/
  json`, and thinking disabled (so the JSON answer isn't truncated by thinking tokens).
  Returns a structured `RiskAssessment`: category, severity, confidence, rationale, indicators.
  This is where sarcasm/intent/context-aware judgement happens, per spec Step 2. Calls are
  throttled to a configurable RPM and retry on `429` (honoring the server's `retryDelay`),
  skipping retries when the *daily* free-tier quota is exhausted.
- `alerting` — applies severity thresholds (config-driven) to decide HIGH/MEDIUM/LOW/NONE.

### 3.3 Case management (`src/case_management.py`)
For every HIGH/MEDIUM alert, builds a `CaseFile`:
`case_id, platform, timestamp, raw_content, risk_category, sentiment_score,
confidence, mitigation_urgency, racm_ref, kri_ref`, persisted as JSON under `data/cases/`.

### 3.4 Escalation (`src/escalation.py`)
Routes HIGH (immediate) and MEDIUM (priority review) case summaries to configured
recipients. The prototype ships a `LogEscalator` (writes routed summaries to a log/stdout);
the interface allows swapping in email/Slack/ServiceNow without touching the pipeline.

### 3.5 Orchestrator (`src/main.py`)
Loads config + secrets, instantiates enabled connectors, then runs the
poll → ingest → sentiment → classify → alert → case → escalate loop. `--once` runs a single
cycle; default runs continuously on `poll_interval_seconds`.

## 4. Data model (`src/models.py`)

```
Post            channel, source, message_id, author_id, timestamp, text, url, raw_meta
SentimentResult polarity, compound_score
RiskAssessment  category, severity, confidence, rationale, indicators[], is_risk
CaseFile        all of the above + case_id, racm_ref, kri_ref, mitigation_urgency, created_at
```

## 5. RACM / KRI alignment

Each risk category maps to a RACM control reference and a KRI, configured in
`config/config.yaml` under `racm_mapping`. Case files carry these references so flagged
items land directly in the existing risk framework rather than a parallel silo.

## 6. Channel-access reality (legal & technical)

- **LinkedIn:** The official API surfaces only content for organizations you administer.
  There is no API to surveil arbitrary public posts. The unofficial `linkedin-api` library
  works by logging in with a real account — this **violates LinkedIn's User Agreement** and
  risks account suspension / legal action. We ship that scraper but keep it **ToS-gated and
  opt-in**: it runs only with `mode: live` + `LINKEDIN_TOS_ACK=true` + credentials. The
  compliant paths are a licensed data provider (Proxycurl, Bright Data) or a consented
  compliance-archive vendor (`LINKEDIN_ARCHIVE_ENDPOINT`).
- **Quora:** No API, login-walled, actively blocks scraping. A reliable compliant scraper
  isn't practical, so it runs in demo mode; the live path is a licensed social-listening
  provider (`QUORA_FEED_ENDPOINT`).
- **WhatsApp:** End-to-end encrypted; no API can read third-party chats. Legitimate internal
  monitoring uses the WhatsApp Business API for the firm's own consented numbers, or a
  compliance-archive vendor (`WHATSAPP_ARCHIVE_ENDPOINT`).

All connectors implement `BaseConnector`, so swapping a demo/stub channel for an authorized
live feed needs zero downstream changes.

## 7. Target relevance filter

Every channel is scoped to a single monitored organization (`config.yaml → target`, default
Prudential Singapore). `pipeline/relevance.is_relevant()` drops any ingested post that
doesn't mention a configured alias, isn't from an official handle, and didn't arrive from a
target search — before any tokens are spent. The classifier system prompt is also
parameterized with the target name so it judges *risk to that organization specifically*.

## 8. Privacy & compliance controls

- `privacy.hash_author_ids` — SHA-256 author pseudonymization in stored cases (default on).
- `privacy.retention_days` — case retention window; older cases are purged on startup.
- `sources` allow-list — the system only reads channels/subreddits/queries you explicitly
  configure; nothing is harvested broadly by default.
- No enforcement automation — output is advisory, routed to humans.

## 9. Scaling notes (beyond prototype)

The synchronous poll loop is intentional for a readable prototype. Production would move
connectors to independent workers writing onto a message queue (Kafka/SQS), with the
pipeline as horizontally-scaled consumers and Gemini calls issued on a paid tier (the free
tier is ~20 requests/day and unsuitable for real volume). Case store would move from JSON
files to a database.
