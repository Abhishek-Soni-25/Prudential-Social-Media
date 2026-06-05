import type { Stats } from "../types";

export function StatCards({ stats }: { stats: Stats | null }) {
  const sev = stats?.by_severity ?? {};
  const cards = [
    { k: "Items analysed", v: stats?.total_cases ?? 0, accent: "var(--brand)" },
    { k: "High severity", v: sev.HIGH ?? 0, accent: "var(--high)" },
    { k: "Medium severity", v: sev.MEDIUM ?? 0, accent: "var(--medium)" },
    { k: "No risk", v: (sev.NONE ?? 0) + (sev.LOW ?? 0), accent: "#64748b" },
  ];
  return (
    <div className="cards">
      {cards.map((c) => (
        <div className="card" key={c.k}>
          <div className="k">
            <span className="accent" style={{ background: c.accent }} />
            {c.k}
          </div>
          <div className="v" style={{ color: c.accent }}>
            {c.v}
          </div>
        </div>
      ))}
    </div>
  );
}
