# Media Compliance — audit register & rule-set overlay

The Media Compliance module screens Prudential Assurance Singapore marketing creatives
against MAS **FSG-03** and the related FAR / PDPA rules. The Python backend performs
**raw extraction only** (OCR, transcription, link fetch); the rule engine, matcher and
decision logic live in TypeScript under `lib/compliance/` and run on the extraction
output. Every screened asset and every rule-set change is written to an **append-only**
register.

**This register (`data/compliance/audit.jsonl`) IS the FSG-03 Safeguard 4 digital
advertising register.** It is the durable, traceable record of what was screened, what
the engine computed, and how a human disposed of it.

## Where things live

| File | Purpose |
| --- | --- |
| `config/rules/prudential-sg-v1.json` | Shipped default rule set (read-only, versioned in git). |
| `data/compliance/ruleset-active.json` | Runtime **overlay**. If present, it is served instead of the default. Written by `PUT /api/compliance/ruleset`. |
| `data/compliance/audit.jsonl` | Append-only audit register, one JSON record per line. Never rewritten. |

The `data/compliance/` directory is created on first write.

## Rule-set overlay — `ruleset-active.json`

`GET /api/compliance/ruleset` returns the overlay if it exists, otherwise the shipped
default. `PUT /api/compliance/ruleset` takes a **full** rule set JSON (same shape as
`prudential-sg-v1.json`) and writes it verbatim to the overlay. Requirements:

- The body **must** contain a `version` field, else the request is rejected `400`. The
  frontend bumps the version before sending; the backend persists what it receives.
- An optional `_actor` field names the officer making the change (default
  `"compliance-officer"`); it is stripped from the stored rule set and recorded in the
  audit log instead.
- Every successful `PUT` appends a `ruleset_change` record to the audit register.

## Audit record shape (`audit.jsonl`)

Two record kinds share the log.

### 1. Screening record (posted by the client via `POST /api/compliance/audit`)

The client has **already pseudonymised all PII** before posting. The backend adds
`receivedAt` and, if absent, an `id`. Fields (client-supplied unless noted):

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Record id. Server generates `aud_<hex>` if the client omits it. |
| `assetHash` | string | Content hash / pseudonymous asset identifier. |
| `adviserId` | string | Pseudonymised adviser identifier. |
| `channel` | string | Channel the asset was posted on. |
| `submittedAt` | string (ISO 8601) | When the asset was submitted for review (client clock). |
| `extractionStatus` | `"complete"` \| `"partial"` \| `"failed"` | From the extraction endpoint. |
| `computedOutcome` | string | Outcome the TS rule engine computed. |
| `finalDisposition` | string | Human reviewer's final decision. |
| `ruleSetVersion` | string | Version of the rule set the asset was evaluated against. |
| `hits` | array | Rules that fired (JSON). |
| `notEvaluated` | array | Rules skipped / not evaluable (e.g. `pending_config`, missing signal) (JSON). |
| `override` | object \| null | Reviewer override details, if any (JSON). |
| `receivedAt` | string (ISO 8601) | **Server-added** timestamp at append time. |

Extra keys are permitted and preserved. `GET /api/compliance/audit` returns records
newest-first (optional `?limit=`). `GET /api/compliance/audit.csv` exports the register
as a CSV attachment; nested fields (`hits`, `notEvaluated`, `override`) are flattened to
JSON strings per cell, with a header row (empty log → header only).

### 2. Rule-set change record (server-generated on `PUT /api/compliance/ruleset`)

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"ruleset_change"` | Discriminator. |
| `version` | string | Version of the rule set just persisted. |
| `at` | string (ISO 8601) | Server timestamp of the change. |
| `actor` | string | From `_actor` in the PUT body, default `"compliance-officer"`. |

## PII & retention

- **PII is pseudonymised client-side before it is POSTed.** The backend never
  de-pseudonymises and stores records as received.
- The log is **append-only**: existing lines are never modified or deleted by the
  application. Correcting a record means appending a new record, not editing history.
- Retention follows Prudential's FSG-03 record-keeping policy for the digital
  advertising register. Rotation / archival is an operational concern handled outside
  the application (e.g. object-storage lifecycle on the mounted data volume); the
  application itself never truncates the file.
