"""Generate frontend/src/demoData.ts — 50 pre-classified Prudential samples per demo
channel (telegram, x, whatsapp, quora).

The demo channels run ENTIRELY in the browser (no backend, no storage). So each sample
carries its own pre-baked analysis (category / severity / confidence / sentiment /
indicators). On "Run Scan" the frontend draws 3 at random per channel and renders the
risk-bearing ones as alerts. Real Gemini analysis is reserved for live Reddit/LinkedIn.
"""

import json
from pathlib import Path

# Reuse the same template content used elsewhere.
from gen_demo import T, PRODUCTS, URL, AUTHORS  # noqa: E402

# Risk-weighted distribution per channel (50 total): fewer purely-general items so most
# drawn rows are real alerts, and the general ones are still fully categorised.
PLAN = [("benign", 10), ("reputational", 16), ("compliance", 9),
        ("market_abuse", 7), ("cyber", 8)]

POS_WORDS = ("smooth", "thrilled", "shoutout", "warmest", "grateful", "excited",
             "good", "decent", "competitive", "reasonable", "useful", "closed a", "steady")

META = {
    # Non-risk brand mentions are categorised GENERAL (analysed → no risk), not left blank.
    "benign": dict(risk_category="GENERAL", severity="NONE", confidence=0.8,
                   sentiment_polarity="Neutral", sentiment_score=0.15,
                   mitigation_urgency="None", racm_ref="-", kri_ref="-",
                   rationale="General brand mention of Prudential Singapore; analysed, no specific risk indicator."),
    "reputational": dict(risk_category="REPUTATIONAL", severity="MEDIUM", confidence=0.9,
                         sentiment_polarity="Negative", sentiment_score=-0.72,
                         mitigation_urgency="Priority", racm_ref="RACM-REP-01", kri_ref="KRI-REP-NEGSENT",
                         rationale="Negative/abusive sentiment toward Prudential Singapore (complaint, scam accusation or boycott call) posing a reputational risk."),
    "compliance": dict(risk_category="COMPLIANCE_CONDUCT", severity="HIGH", confidence=0.93,
                       sentiment_polarity="Negative", sentiment_score=-0.4,
                       mitigation_urgency="Immediate", racm_ref="RACM-CMP-04", kri_ref="KRI-CMP-VIOL",
                       rationale="Possible conduct/compliance breach (mis-selling, fraud or falsification) involving a Prudential agent."),
    "market_abuse": dict(risk_category="MARKET_ABUSE", severity="HIGH", confidence=0.92,
                         sentiment_polarity="Neutral", sentiment_score=-0.1,
                         mitigation_urgency="Immediate", racm_ref="RACM-MAB-02", kri_ref="KRI-MAB-SUSP",
                         rationale="Indicators of market abuse — insider information or coordinated trading relating to Prudential."),
    "cyber": dict(risk_category="CYBER_OPERATIONAL", severity="HIGH", confidence=0.94,
                  sentiment_polarity="Negative", sentiment_score=-0.5,
                  mitigation_urgency="Immediate", racm_ref="RACM-CYB-03", kri_ref="KRI-CYB-LEAK",
                  rationale="Potential data leak or credential exposure affecting Prudential Singapore."),
}

KEYWORDS = {
    "reputational": ["scam", "fraud", "boycott", "liars", "avoid", "worst", "cheated", "mis-sold", "ripped", "rip"],
    "compliance": ["hide", "omit", "backdate", "forge", "guarantee", "elderly", "lie", "side-deal", "side deal", "audit"],
    "market_abuse": ["insider", "accumulate", "pump", "before", "leak", "non-public", "results beat", "buy"],
    "cyber": ["nric", "database", "api key", "creds", "leaked", "exposed", "admin", "vpn", "data"],
    "benign": [],
}


def indicators_for(cat: str, text: str) -> list[str]:
    low = text.lower()
    hits = [k for k in KEYWORDS.get(cat, []) if k in low]
    return hits[:3]


def build(channel: str) -> list[dict]:
    out, n = [], 0
    cats = T[channel]
    for cat, count in PLAN:
        templates = cats[cat]
        meta = META[cat]
        for i in range(count):
            tpl = templates[i % len(templates)]
            product = PRODUCTS[n % len(PRODUCTS)]
            text = tpl.replace("{p}", product)
            author = AUTHORS[channel][n % len(AUTHORS[channel])].format(n=n + 1)
            entry = {
                "id": f"{channel}-{n+1}",
                "channel": channel,
                "author_ref": author,
                "raw_content": text,
                "url": URL[channel].format(n=n + 1000),
                "indicators": indicators_for(cat, text),
                **meta,
            }
            if cat == "benign":  # vary GENERAL sentiment by wording
                positive = any(w in text.lower() for w in POS_WORDS)
                entry["sentiment_polarity"] = "Positive" if positive else "Neutral"
                entry["sentiment_score"] = 0.55 if positive else 0.15
            out.append(entry)
            n += 1
    return out


def main() -> None:
    pool = {ch: build(ch) for ch in T}
    body = json.dumps(pool, indent=2, ensure_ascii=False)
    ts = (
        "// AUTO-GENERATED by tools/gen_demo_frontend.py — do not edit by hand.\n"
        "// 50 pre-classified Prudential samples per demo channel. Demo channels run\n"
        "// entirely client-side: no backend call, nothing stored.\n"
        "export interface DemoSample {\n"
        "  id: string; channel: string; author_ref: string; raw_content: string; url: string;\n"
        "  risk_category: string; severity: \"HIGH\" | \"MEDIUM\" | \"LOW\" | \"NONE\";\n"
        "  confidence: number; rationale: string; indicators: string[];\n"
        "  sentiment_polarity: string; sentiment_score: number; mitigation_urgency: string;\n"
        "  racm_ref: string; kri_ref: string;\n"
        "}\n\n"
        f"export const DEMO_POOL: Record<string, DemoSample[]> = {body};\n"
    )
    out = Path(__file__).resolve().parent.parent / "frontend" / "src" / "demoData.ts"
    out.write_text(ts, encoding="utf-8")
    print("wrote", out)
    for ch, items in pool.items():
        risky = sum(1 for x in items if x["severity"] != "NONE")
        print(f"  {ch}: {len(items)} samples ({risky} risk-bearing)")


if __name__ == "__main__":
    main()
