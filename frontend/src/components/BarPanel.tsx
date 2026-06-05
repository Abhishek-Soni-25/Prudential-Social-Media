export function BarPanel({
  title,
  data,
  color,
  labelFmt,
}: {
  title: string;
  data: Record<string, number>;
  color?: string;
  labelFmt?: (k: string) => string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
      </div>
      <div className="panel-body">
        {entries.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No data yet.</div>}
        {entries.map(([k, v]) => (
          <div className="bar-row" key={k}>
            <span className="bar-label cap">{labelFmt ? labelFmt(k) : k}</span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{ width: `${(v / max) * 100}%`, background: color ?? "var(--brand)" }}
              />
            </span>
            <span className="bar-val">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
