import type { Insights as InsightsData } from "../demo";

const CAT_COLOR: Record<string, string> = {
  REPUTATIONAL: "#ED1B2E",
  COMPLIANCE_CONDUCT: "#d97706",
  MARKET_ABUSE: "#7c3aed",
  CYBER_OPERATIONAL: "#2563eb",
};
const cap = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

export function Insights({ d }: { d: InsightsData }) {
  const sent = d.sentiment;
  const total = Math.max(1, d.total);
  const catMax = Math.max(1, ...d.categories.map((c) => c.count));

  return (
    <>
      {/* Highlight metrics */}
      <div className="insight-strip">
        <div className="insight-card">
          <div className="ic-label">Action required</div>
          <div className="ic-value" style={{ color: "var(--high)" }}>
            {d.alerts}<span className="ic-unit"> / {d.total}</span>
          </div>
          <div className="ic-sub">items flagged as a risk</div>
        </div>
        <div className="insight-card">
          <div className="ic-label">Negative sentiment</div>
          <div className="ic-value" style={{ color: "var(--high)" }}>{d.negPct}%</div>
          <div className="ic-sub">{sent.negative} of {d.total} mentions</div>
        </div>
        <div className="insight-card">
          <div className="ic-label">Top risk category</div>
          <div className="ic-value ic-text" style={{ color: d.topCategory ? CAT_COLOR[d.topCategory.name] : "var(--ink-faint)" }}>
            {d.topCategory ? cap(d.topCategory.name) : "—"}
          </div>
          <div className="ic-sub">{d.topCategory ? `${d.topCategory.count} alerts` : "no alerts"}</div>
        </div>
        <div className="insight-card">
          <div className="ic-label">Most-flagged channel</div>
          <div className="ic-value ic-text cap">{d.topChannel ? d.topChannel.name : "—"}</div>
          <div className="ic-sub">{d.topChannel ? `${d.topChannel.alerts} alerts` : "all clear"}</div>
        </div>
      </div>

      <div className="grid3">
        {/* Sentiment breakdown */}
        <div className="panel">
          <div className="panel-head"><h3>Sentiment breakdown</h3></div>
          <div className="panel-body">
            <div className="stacked">
              <span className="seg" style={{ width: `${(sent.negative / total) * 100}%`, background: "var(--high)" }} />
              <span className="seg" style={{ width: `${(sent.neutral / total) * 100}%`, background: "#cbd1da" }} />
              <span className="seg" style={{ width: `${(sent.positive / total) * 100}%`, background: "var(--ok)" }} />
            </div>
            <div className="sent-legend">
              <div><span className="dot" style={{ background: "var(--high)" }} /> Negative <b>{sent.negative}</b></div>
              <div><span className="dot" style={{ background: "#cbd1da" }} /> Neutral <b>{sent.neutral}</b></div>
              <div><span className="dot" style={{ background: "var(--ok)" }} /> Positive <b>{sent.positive}</b></div>
            </div>
          </div>
        </div>

        {/* Risk category */}
        <div className="panel">
          <div className="panel-head"><h3>Alerts by risk category</h3></div>
          <div className="panel-body">
            {d.categories.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No alerts.</div>}
            {d.categories.map((c) => (
              <div className="bar-row" key={c.name}>
                <span className="bar-label">{cap(c.name)}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(c.count / catMax) * 100}%`, background: CAT_COLOR[c.name] ?? "var(--brand)" }} />
                </span>
                <span className="bar-val">{c.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Channel risk */}
        <div className="panel">
          <div className="panel-head"><h3>Channel risk</h3></div>
          <div className="panel-body">
            {d.channelRisk.map((c) => (
              <div className="bar-row" key={c.name}>
                <span className="bar-label cap" style={{ width: 78 }}>{c.name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${c.total ? (c.alerts / c.total) * 100 : 0}%`, background: c.alerts ? "var(--high)" : "#e7e9ee" }} />
                </span>
                <span className="bar-val" style={{ color: c.alerts ? "var(--high)" : "var(--ink-faint)" }}>
                  {c.alerts}<span className="muted" style={{ fontWeight: 400 }}>/{c.total}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
