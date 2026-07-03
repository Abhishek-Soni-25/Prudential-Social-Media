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
            <div className="hbars">
              {d.categories.map((c) => {
                const col = CAT_COLOR[c.name] ?? "var(--brand)";
                return (
                  <div className="hbar" key={c.name}>
                    <span className="hbar-name">{cap(c.name)}</span>
                    <span className="hbar-track" style={{ background: `${col}1f` }}>
                      <span className="hbar-fill" style={{ width: `${Math.max(6, (c.count / catMax) * 100)}%`, background: `linear-gradient(90deg, ${col}, ${col}bb)` }} />
                    </span>
                    <span className="hbar-num" style={{ color: col }}>{c.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Channel risk */}
        <div className="panel">
          <div className="panel-head"><h3>Channel risk</h3></div>
          <div className="panel-body">
            <div className="hbars">
              {d.channelRisk.map((c) => {
                const col = c.alerts ? "var(--high)" : "#5b6cf0";
                return (
                  <div className="hbar" key={c.name}>
                    <span className="hbar-name cap" style={{ width: 90 }}>{c.name}</span>
                    <span className="hbar-track" style={{ background: c.alerts ? "#fbe4e6" : "#eef1fb" }}>
                      <span className="hbar-fill" style={{ width: `${c.total ? Math.max(6, (c.alerts / c.total) * 100) : 6}%`, background: `linear-gradient(90deg, ${col}, ${col}bb)`, opacity: c.alerts ? 1 : 0.4 }} />
                    </span>
                    <span className="hbar-num" style={{ color: c.alerts ? "var(--high)" : "var(--ink-soft)" }}>
                      {c.alerts}<span className="muted" style={{ fontWeight: 400 }}>/{c.total}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
