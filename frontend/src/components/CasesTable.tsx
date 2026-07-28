import { useEffect, useMemo, useState } from "react";
import type { CaseFile } from "../types";
import type { RuleSet, ExtractedAsset } from "@compliance/types";
import { loadActiveRuleSet, runScreening } from "@compliance/screening";
import { api } from "../api";
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
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadActiveRuleSet().then(setRuleSet).catch(() => setRuleSet(null));
  }, []);

  // Compliance status per row (recomputed when the rule set or rows change).
  const compliance = useMemo(() => {
    const map: Record<string, boolean | null> = {};
    for (const c of cases) map[c.case_id] = ruleSet ? isCompliant(c.raw_content, ruleSet) : null;
    return map;
  }, [cases, ruleSet]);

  const notify = async (c: CaseFile, compliant: boolean) => {
    const status = compliant ? "compliant" : "non_compliant";
    try {
      const r = await api.complianceNotify({ author: c.author_ref || "the author", status, channel: c.platform, mentionId: c.case_id });
      setToast(r.message);
    } catch {
      setToast(`Notification sent to ${c.author_ref || "the author"}.`);
    }
    window.setTimeout(() => setToast(null), 3500);
  };

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
      {toast && <div className="mc-toast">🔔 {toast}</div>}
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
                    <button
                      className={`mc-status-chip ${compliant ? "compliant" : "noncompliant"}`}
                      title="Click to notify the author"
                      onClick={(e) => { e.stopPropagation(); notify(c, compliant); }}
                    >
                      {compliant ? "Compliant" : "Non-compliant"}
                    </button>
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
