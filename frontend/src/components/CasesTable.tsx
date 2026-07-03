import type { CaseFile } from "../types";
import { CategoryChip, ConfidenceBar, SentimentTag, SeverityBadge, fmtTime } from "./ui";

export function CasesTable({
  cases,
  onSelect,
}: {
  cases: CaseFile[];
  onSelect: (c: CaseFile) => void;
}) {
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
          <th>Detected</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <tr key={c.case_id} onClick={() => onSelect(c)}>
            <td><SeverityBadge severity={c.severity} /></td>
            <td><CategoryChip category={c.risk_category} /></td>
            <td className="cap">{c.platform}</td>
            <td><SentimentTag polarity={c.sentiment_polarity} /></td>
            <td className="rationale-cell">{c.rationale}</td>
            <td><ConfidenceBar value={c.confidence} /></td>
            <td className="muted">{fmtTime(c.created_at)}</td>
            <td>
              {c.url ? (
                <a
                  className="link"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open ↗
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
