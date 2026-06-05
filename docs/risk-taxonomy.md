# Risk Taxonomy

This taxonomy is the contract used by the AI risk classifier. The same definitions are
embedded (as a cached system prompt) in `src/pipeline/risk_classifier.py`. Keep the two in
sync — this doc is the human-readable source of truth.

Severity tiers follow the spec:
- **HIGH** — immediate action. High-confidence match for Market Abuse, Cyber, or severe
  Compliance/Conduct violations.
- **MEDIUM** — priority review. Significant negative-sentiment spikes or sustained
  operational critique.
- **LOW** — log only. General negative sentiment with no actionable compliance/operational threat.
- **NONE** — no risk; not stored as a case.

## Categories

### REPUTATIONAL
Public backlash, boycott coordination, executive defamation, negative viral brand trends.
- Typical severity: LOW–MEDIUM (HIGH if coordinated/viral with material brand impact).
- Indicators: spikes in negative sentiment about the org, calls to boycott, viral hostile hashtags.

### COMPLIANCE_CONDUCT
Insiders sharing unauthorized information, policy violations, unethical behavior, harassment,
misrepresentation to clients.
- Typical severity: MEDIUM–HIGH.
- Indicators: "don't tell compliance", off-channel deal talk, sharing confidential docs,
  promises of guaranteed returns.

### MARKET_ABUSE
Suspicious trading discussion, insider-information leakage, market manipulation, pump-and-dump
coordination, leaked financial metrics ahead of disclosure.
- Typical severity: **HIGH** (this is a flagship surveillance obligation).
- Indicators: coordinated buy/sell timing, "before earnings", non-public numbers, ramping
  language ("everyone buy at 3pm"), spoofing/layering chatter.

### CYBER_OPERATIONAL
Data-leak mentions, credential exposure, system vulnerabilities, coordinated cyberattack
planning, leaked internal infrastructure detail, operational outages being exploited.
- Typical severity: **HIGH** (cyber) / MEDIUM (operational critique).
- Indicators: pasted credentials/keys, "we found an exploit in <product>", breach offers,
  internal hostnames/tokens, DDoS coordination.

## Classifier output contract

The classifier must return strict JSON:

```json
{
  "is_risk": true,
  "category": "MARKET_ABUSE",
  "severity": "HIGH",
  "confidence": 0.0-1.0,
  "rationale": "short explanation grounded in the text",
  "indicators": ["matched signal 1", "matched signal 2"]
}
```

- `category` ∈ {REPUTATIONAL, COMPLIANCE_CONDUCT, MARKET_ABUSE, CYBER_OPERATIONAL, NONE}.
- If `is_risk` is false, `category` = NONE, `severity` = NONE.
- The model is instructed to judge **context, sarcasm, and intent** and to lower confidence
  for ambiguous/jokey content to minimize false positives (spec Step 2 & Continuous Calibration).
