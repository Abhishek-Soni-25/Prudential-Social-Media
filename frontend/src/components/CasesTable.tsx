import { useEffect, useMemo, useState } from "react";
import type { CaseFile } from "../types";
import type { RuleSet, ExtractedAsset } from "@compliance/types";
import { loadActiveRuleSet, runScreening } from "@compliance/screening";
import { CategoryChip, ConfidenceBar, SentimentTag, SeverityBadge, fmtTime } from "./ui";

/**
 * Screen a mention's text against the live rule set. A mention is "non-compliant"
 * only when it contains actively-PROHIBITED content (guaranteed returns, specific
 * return figures, testimonials, restricted terms, …). Disclosure/register
 * requirements (e.g. A-04 metadata, A-01 risk warning) don't apply to a third
 * party's social post, so we ignore requirement-type hits here.
 */
function isCompliant(text: string, ruleSet: RuleSet): boolean {
  const asset: ExtractedAsset = {
    assetId: "m", adviserId: "", channel: "", imageText: [], transcript: "",
    captionText: text || "", frames: [], extractionStatus: "complete",
    metadata: { date: "n/a", version: "n/a" },
  };
  const active = runScreening(asset, ruleSet).verdict.activeHits;
  return active.filter((h) => h.type === "prohibition").length === 0;
}

export function CasesTable({
  cases,
  onSelect,
}: {
  cases: CaseFile[];
  onSelect: (c: CaseFile) => void;
}) {
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);

  useEffect(() => {
    loadActiveRuleSet().then(setRuleSet).catch(() => setRuleSet(null));
  }, []);

  // Compliance status per row (recomputed when the rule set or rows change).
  const compliance = useMemo(() => {
    const map: Record<string, boolean | null> = {};
    for (const c of cases) map[c.case_id] = ruleSet ? isCompliant(c.raw_content, ruleSet) : null;
    return map;
  }, [cases, ruleSet]);

  if (cases.length === 0) {
    return (
      <div className="empty">
        No cases match the current filters.
        <br />
        Run a scan to ingest and classify content.
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Category</th>
            <th>Channel</th>
            <th>Sentiment</th>
            <th>Rationale</th>
            <th>Confidence</th>
            <th>Media Compliance</th>
            <th>Detected</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const compliant = compliance[c.case_id];
            return (
              <tr key={c.case_id} onClick={() => onSelect(c)}>
                <td><SeverityBadge severity={c.severity} /></td>
                <td><CategoryChip category={c.risk_category} /></td>
                <td className="cap">{c.platform}</td>
                <td><SentimentTag polarity={c.sentiment_polarity} /></td>
                <td className="rationale-cell">{c.rationale}</td>
                <td><ConfidenceBar value={c.confidence} /></td>
                <td>
                  {compliant === null ? (
                    <span className="muted">…</span>
                  ) : (
                    // Read-only status. Clicking it does nothing (and must not open the
                    // row drawer); open the row itself to see the reason + notify action.
                    <span
                      className={`mc-status-chip ${compliant ? "compliant" : "noncompliant"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {compliant ? "Compliant" : "Non-compliant"}
                    </span>
                  )}
                </td>
                <td className="muted">{fmtTime(c.created_at)}</td>
                <td>
                  {c.url ? (
                    <a className="link" href={c.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      Open ↗
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
