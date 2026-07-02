import type { Mention } from "../types";

// Sentiment (positive / neutral / negative) split for each platform, computed from the
// analysed mentions. Directly answers "categorise the post into negative/positive/neutral
// with respect to each platform".
export function SentimentByPlatform({ mentions }: { mentions: Mention[] }) {
  const byPlatform = new Map<string, { positive: number; neutral: number; negative: number }>();
  for (const m of mentions) {
    const d = byPlatform.get(m.platform) ?? { positive: 0, neutral: 0, negative: 0 };
    d[m.sentiment] += 1;
    byPlatform.set(m.platform, d);
  }
  const rows = [...byPlatform.entries()].sort(
    (a, b) => (b[1].positive + b[1].neutral + b[1].negative) - (a[1].positive + a[1].neutral + a[1].negative),
  );

  return (
    <div className="panel">
      <div className="panel-head"><h3>Sentiment by platform</h3></div>
      <div className="panel-body">
        {rows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No mentions yet.</div>}
        {rows.map(([platform, d]) => {
          const total = Math.max(1, d.positive + d.neutral + d.negative);
          return (
            <div className="bar-row" key={platform} style={{ alignItems: "center" }}>
              <span className="bar-label cap" style={{ width: 84 }}>{platform}</span>
              <span className="stacked" style={{ flex: 1, marginBottom: 0 }}>
                <span className="seg" style={{ width: `${(d.negative / total) * 100}%`, background: "var(--high)" }} />
                <span className="seg" style={{ width: `${(d.neutral / total) * 100}%`, background: "#cbd1da" }} />
                <span className="seg" style={{ width: `${(d.positive / total) * 100}%`, background: "var(--ok)" }} />
              </span>
              <span className="bar-val" style={{ minWidth: 92, textAlign: "right", fontWeight: 400 }}>
                <span style={{ color: "var(--high)" }}>{d.negative}</span> ·{" "}
                <span style={{ color: "var(--ink-faint)" }}>{d.neutral}</span> ·{" "}
                <span style={{ color: "var(--ok)" }}>{d.positive}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
