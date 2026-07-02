import { useMemo, useState } from "react";
import type { CaseFile } from "../types";
import { CasesTable } from "../components/CasesTable";

const titleCase = (s: string) => s.replace(/_/g, " ").toLowerCase();

export function Mentions({
  cases, channels, onSelect,
}: {
  cases: CaseFile[]; channels: string[]; onSelect: (c: CaseFile) => void;
}) {
  const [f, setF] = useState({ severity: "", sentiment: "", channel: "", q: "" });

  const filtered = useMemo(() => cases.filter((c) => {
    const sevOk = !f.severity || c.severity === f.severity || (f.severity === "NONE" && c.severity === "LOW");
    const sentOk = !f.sentiment || (c.sentiment_polarity || "").toLowerCase() === f.sentiment;
    const chOk = !f.channel || c.platform === f.channel;
    const qOk = !f.q || (c.raw_content + c.rationale + c.author_ref).toLowerCase().includes(f.q.toLowerCase());
    return sevOk && sentOk && chOk && qOk;
  }), [cases, f]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Listening — all mentions</h3>
        <div className="filters">
          <input className="search-input" placeholder="Search text / author…" value={f.q}
            onChange={(e) => setF((s) => ({ ...s, q: e.target.value }))} />
          <select value={f.sentiment} onChange={(e) => setF((s) => ({ ...s, sentiment: e.target.value }))}>
            <option value="">All sentiment</option>
            <option value="negative">Negative</option>
            <option value="neutral">Neutral</option>
            <option value="positive">Positive</option>
          </select>
          <select value={f.severity} onChange={(e) => setF((s) => ({ ...s, severity: e.target.value }))}>
            <option value="">All severity</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="NONE">No risk</option>
          </select>
          <select value={f.channel} onChange={(e) => setF((s) => ({ ...s, channel: e.target.value }))}>
            <option value="">All channels</option>
            {channels.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </select>
          <span className="count">{filtered.length} shown</span>
        </div>
      </div>
      <CasesTable cases={filtered} onSelect={onSelect} />
    </div>
  );
}
