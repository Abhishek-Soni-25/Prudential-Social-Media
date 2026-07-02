import type { CaseFile, Mention, Stats } from "../types";
import { fmtTime } from "../components/ui";

// PRD 6.7 — single large-screen live view for crisis use.
export function CommandView({ stats, mentions, cases }: {
  stats: Stats; mentions: Mention[]; cases: CaseFile[];
}) {
  const neg = mentions.filter((m) => m.sentiment === "negative").length;
  const negPct = mentions.length ? Math.round((neg / mentions.length) * 100) : 0;
  const high = cases.filter((c) => c.severity === "HIGH");

  return (
    <div className="command">
      <div className="cmd-grid">
        <CmdTile label="Items analysed" value={stats.total_cases} />
        <CmdTile label="High severity" value={stats.by_severity.HIGH ?? 0} tone="high" />
        <CmdTile label="Medium severity" value={stats.by_severity.MEDIUM ?? 0} tone="med" />
        <CmdTile label="Negative sentiment" value={`${negPct}%`} tone="high" />
      </div>

      <div className="cmd-alerts">
        <div className="cmd-alerts-head">🚨 Active high-severity alerts</div>
        {high.length === 0 && <div className="muted" style={{ padding: 20 }}>No active high-severity alerts.</div>}
        {high.slice(0, 8).map((c) => (
          <div className="cmd-alert" key={c.case_id}>
            <span className="cap cmd-ch">{c.platform}</span>
            <span className="cmd-cat">{c.risk_category.replace(/_/g, " ")}</span>
            <span className="cmd-text">{c.raw_content.slice(0, 120)}</span>
            <span className="muted cmd-time">{fmtTime(c.created_at)}</span>
            {c.url && <a className="link" href={c.url} target="_blank" rel="noreferrer">open ↗</a>}
          </div>
        ))}
      </div>
    </div>
  );
}

function CmdTile({ label, value, tone }: { label: string; value: number | string; tone?: "high" | "med" }) {
  const color = tone === "high" ? "var(--high)" : tone === "med" ? "var(--medium)" : "#e6e9f0";
  return (
    <div className="cmd-tile">
      <div className="cmd-tile-label">{label}</div>
      <div className="cmd-tile-value" style={{ color }}>{value}</div>
    </div>
  );
}
