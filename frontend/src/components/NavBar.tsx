import type { Stats } from "../types";

type SevFilter = "" | "HIGH" | "MEDIUM" | "NONE";

const TABS: { key: SevFilter; label: string }[] = [
  { key: "", label: "All Cases" },
  { key: "HIGH", label: "High" },
  { key: "MEDIUM", label: "Medium" },
  { key: "NONE", label: "No Risk" },
];

/** Prudential-style red navigation band; tabs double as severity quick-filters. */
export function NavBar({
  active,
  onSelect,
  stats,
}: {
  active: SevFilter;
  onSelect: (s: SevFilter) => void;
  stats: Stats | null;
}) {
  const counts: Record<string, number> = {
    "": stats?.total_cases ?? 0,
    HIGH: stats?.by_severity?.HIGH ?? 0,
    MEDIUM: stats?.by_severity?.MEDIUM ?? 0,
    NONE: (stats?.by_severity?.NONE ?? 0) + (stats?.by_severity?.LOW ?? 0),
  };
  return (
    <div className="pru-navwrap">
      <nav className="pru-nav">
        <span className="nav-title">
          <span className="ico">◈</span> Social Media Surveillance
        </span>
        <div className="nav-tabs">
          {TABS.map((t) => (
            <button
              key={t.key || "all"}
              className={`nav-tab ${active === t.key ? "active" : ""}`}
              onClick={() => onSelect(t.key)}
            >
              {t.label}
              <span className="n">{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
