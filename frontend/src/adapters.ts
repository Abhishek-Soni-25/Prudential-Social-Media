// Adapt a real pipeline Mention (/api/mentions) onto the CaseFile shape the existing
// dashboard (stats, insights, table, drawer) already renders — so real Bright Data / Apify
// data flows through the same polished UI as the prototype.
import type { CaseFile, Mention } from "./types";

const SENT_SCORE: Record<string, number> = { negative: -0.6, neutral: 0.05, positive: 0.6 };

export function mentionToCase(m: Mention): CaseFile {
  return {
    case_id: `${m.platform}-${m.id}`,
    platform: m.platform,
    source: m.author_url ? `@${m.author}` : (m.provider ?? m.platform),
    timestamp: m.timestamp,
    author_ref: m.author,
    raw_content: m.text,
    risk_category: m.risk_category,
    severity: m.severity,
    sentiment_polarity: m.sentiment,
    sentiment_score: SENT_SCORE[m.sentiment] ?? 0,
    confidence: m.confidence,
    rationale: m.rationale || "—",
    indicators: m.indicators ?? [],
    mitigation_urgency:
      m.severity === "HIGH" ? "Immediate" : m.severity === "MEDIUM" ? "Priority" : "Routine",
    racm_ref: "-",
    kri_ref: "-",
    url: m.url,
    created_at: m.analysed_at || m.timestamp,
  };
}
