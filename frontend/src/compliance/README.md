# Media Compliance — Prudential Assurance Singapore (MAS FSG-03)

Screens adviser and marketer creatives (image, video, or video link) against
**MAS Guideline FSG-03** and Prudential advertising policy. The rule set is
**configuration, not code**: 24 rules — 12 prohibitions (`D-01…D-12`) and 12
required disclosures (`A-01…A-12`) — live in
[`prudential-sg-v1.json`](./prudential-sg-v1.json) (a build-time snapshot of the
backend's `config/rules/prudential-sg-v1.json`)
and are owned by Prudential Compliance through the **Rule Configuration** screen.

```
extractor ──▶ ExtractedAsset ──▶ ruleMatcher ──▶ hits + notEvaluated
                                                        │
                                        decisionEngine.evaluate  ──▶ Verdict ──▶ auditLog (register)
```

| Module | Role |
|---|---|
| `extractors/{image,video,videoLink}.ts` | Produce the normalised `ExtractedAsset` (+ `extractionStatus`). |
| `ruleMatcher.ts` | Run the detection templates against the asset → `RuleHit[]` + `notEvaluated[]`. |
| `decisionEngine.ts` | **Pure function.** Hits + extraction status → `Verdict`. No I/O, no clock. |
| `rules.ts` | Load the live rule set; answer "is this rule's dependency met?". |
| `screening.ts` | Orchestrates matcher → engine against the version that is live now. |
| `auditLog.ts` | Append-only FSG-03 Safeguard 4 register, PII pseudonymisation, CSV export. |

Run the tests: `cd frontend && npm test` (Vitest — covers every decision branch,
every boundary, the matcher, and the audit log).

---

## The decision table

`evaluate(hits, extractionStatus)` filters to `status === 'active'` **first**
(advisory and pending_config hits are carried through for display but can never
change the outcome), drops any active hit below its severity confidence floor
(keeping it for display and forcing a manual review), then applies — **first
match wins**:

| Condition (active rules only) | Outcome |
|---|---|
| `extractionStatus !== 'complete'` | **MANUAL_REVIEW** (extraction incomplete — never approve on partial/failed extraction) |
| any **High** at confidence ≥ floor.High (0.85) | **REJECT** |
| any **High** below 0.85 | **MANUAL_REVIEW** (low confidence — never auto-reject a low-confidence High) |
| any **Medium** | **MANUAL_REVIEW** |
| **count(Low) ≥ 3** | **MANUAL_REVIEW** (a volume of minor defects is a training-gap signal) |
| any below-floor hit remaining | **MANUAL_REVIEW** (low confidence) |
| **count(Low) ∈ {1, 2}** | **APPROVE_WITH_ADVISORY** |
| otherwise | **APPROVE** |

**Counting applies to the Low tier only. High and Medium are never counted** — a
count-based rule on those tiers invites arguments about arithmetic instead of
about the breach. With today's config there is exactly one active Low rule
(`A-04`), so `count(Low) ≥ 3` is unreachable *today* — but it is implemented and
tested, and becomes reachable the moment Prudential promotes a Low rule to
active.

The confidence floor (`{ High: 0.85, Medium: 0.75, Low: 0.75 }`) is config, tuned
on observed false-positive rates once there is live volume — not set from
judgement. The engine reads it from the rule set, never hardcodes it.

Every `Verdict` cites `ruleId` + regulatory `basis` + evidence `region`, and is
stamped with the `ruleSetVersion` that was live at screening time. That is what
makes a decision defensible — and replayable — in a MAS inspection.

---

## Severity vs status — two independent questions

These are **orthogonal**. A rule can be High severity and still Advisory, because
*how serious a breach is* and *whether the engine may act on it* are different
questions.

**Severity** — how serious:
- **High** — client-data exposure, or a statement that misleads on returns/risk.
- **Medium** — a missing mandatory disclosure or a balance defect.
- **Low** — a traceability, brand or housekeeping defect.

**Status** — whether the engine may act:
- **active** — evaluated, feeds the decision engine, **can block a post**.
- **advisory** — evaluated, shown in the UI and written to the audit log, but
  **never feeds the decision engine**. Used where the call is a legal/contextual
  judgement the engine should not make on its own.
- **pending_config** — **not evaluated at all**. Shipped and visible in the admin
  screen with its `dependency` named, switched off until a Prudential policy
  decision or data feed lands.

> The single most important consequence: **an Advisory High never causes a
> REJECT.** It is filtered out before the outcome logic. This is the first test
> in `decisionEngine.test.ts`.

Today's split (checked in the tests): **9 active** (`D-01…D-05`, `A-01…A-04`),
**6 advisory** (`D-06`, `D-07`, `D-08`, `D-10`, `A-05`, `A-06`), **9
pending_config** (`D-09`, `D-11`, `D-12`, `A-07…A-12`).

---

## The phrase-list dependency (and why the lists ship empty)

`A-01` (risk warning), `A-02` (representative/licensing statement) and `A-03`
(past-performance caveat) are **phrase-presence checks**: they test whether an
*approved* phrase appears in the asset. Prudential has **not supplied the accepted
wording yet**, so the three phrase lists in the config ship **empty**:

```json
"phraseLists": { "riskWarning": [], "licensingStatement": [], "pastPerformanceCaveat": [] }
```

We do **not** invent accepted phrasings. Instead, **any rule whose dependency is
unmet is skipped at evaluation time regardless of its status**, and is recorded
in the verdict under `notEvaluated` with the reason *"awaiting approved phrase
list"*. The results UI shows this against the rule; the admin screen shows
*"empty — rule paused"*.

So on day one, **6 of the 9 active rules actually run** (`D-01…D-05`, `A-04`).
That is correct and expected. The moment a compliance officer adds even one
approved phrase to a list in the Rule Configuration screen, the corresponding
rule **starts evaluating with no code change** — see
`isDependencyMet` / `canActivate` in `rules.ts`.

---

## How to add or change a rule (no deploy)

Everything below is done in **Media Compliance → Rule Configuration**. Every save
bumps `ruleSetVersion` and writes an audit entry (who, what, when); each screening
decision records the version applied, so a historical decision replays against the
rules that were live at the time.

Compliance officers can, with no deploy:
- toggle **status** between active / advisory / pending_config (promotion to
  active is **blocked** while a dependency is unmet, and the missing dependency is
  named);
- edit **severity**, **rule text** and the **reviewer note**;
- edit the **confidence floor** per severity tier;
- maintain the three **phrase lists**;
- **add a rule from a template**, where the detection signal is one of:

  | Template | Fires when | Params |
  |---|---|---|
  | `lexicon` | any listed term appears | `terms: string[]` |
  | `entity` | a listed entity appears (optionally with a comparative/figure) | `entityList: string[]` |
  | `regex` | a pattern matches (e.g. `percentage`, `nric`) | `pattern`, optional `nearTerms` |
  | `phrase_absence` | a trigger is present but no approved phrase appears | `phraseList`, `trigger` |

New rules ship **advisory** by default — promote to active once hit quality is
trusted (the override rate on the Rule Configuration screen is the signal).

**A rule whose detection cannot be expressed in those four templates needs a code
change.** This is deliberate — we do not build a general-purpose rule language.
Add a new template branch in `ruleMatcher.ts` and raise it through the normal
change process.

### Editing the JSON directly

The config schema is in `types.ts` (`RuleSet` / `Rule`). `type` is `prohibition`
(presence = hit) or `requirement` (absence = hit). `dependency` is a string,
required when `status` is `pending_config`, `null` otherwise — **except**
`A-01/A-02/A-03`, which are active but carry a dependency on their phrase list.

---

## Audit register & PII

`auditLog.ts` writes one **append-only** record per evaluation (and per override)
to the FSG-03 Safeguard 4 register — see
[`docs/compliance-audit-schema.md`](../../../../docs/compliance-audit-schema.md) for the
record shape, storage location and CSV export. **Policy numbers and NRIC/FIN
patterns are pseudonymised before anything is written** (`pseudonymise()`); the
register stores the asset hash and the evidence crop, never raw client data. A
compliance-officer override requires a free-text justification and is written as a
new record with officer identity and timestamp — history is never edited.

## Out of scope for v1 (deliberate)

Hit counting on High or Medium; repeat-offender escalation (an HR/supervision
decision — the tool surfaces the pattern, a human decides); automatic FAA-N14
case creation.
