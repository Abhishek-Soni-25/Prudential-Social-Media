import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { CaseFile, Channel } from "./types";
import { ALL_CHANNELS, computeInsights, computeStats, drawDemoCases } from "./demo";
import { Header } from "./components/Header";
import { NavBar } from "./components/NavBar";
import { ChannelsStrip } from "./components/ChannelsStrip";
import { StatCards } from "./components/StatCards";
import { Insights } from "./components/Insights";
import { CasesTable } from "./components/CasesTable";
import { CaseDrawer } from "./components/CaseDrawer";

const titleCase = (s: string) => s.replace(/_/g, " ").toLowerCase();

// All monitored channels (reddit/linkedin are live; the rest run client-side).
const CHANNELS: Channel[] = ALL_CHANNELS.map((name) => ({
  name, enabled: true, mode: "live", sources: [],
}));

export default function App() {
  const [liveCases, setLiveCases] = useState<CaseFile[]>([]);   // reddit + linkedin (n8n)
  const [demoCases, setDemoCases] = useState<CaseFile[]>([]);   // 4 client-side channels
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CaseFile | null>(null);
  const [filters, setFilters] = useState({ severity: "", category: "", channel: "" });
  const [error, setError] = useState<string | null>(null);

  const combined = useMemo(() => [...liveCases, ...demoCases], [liveCases, demoCases]);
  const stats = useMemo(() => computeStats(combined), [combined]);
  const insights = useMemo(() => computeInsights(combined, ALL_CHANNELS), [combined]);

  const filtered = useMemo(() => combined.filter((c) => {
    const sevOk = !filters.severity
      || c.severity === filters.severity
      || (filters.severity === "NONE" && c.severity === "LOW"); // "No Risk" folds in LOW
    return sevOk
      && (!filters.category || c.risk_category === filters.category)
      && (!filters.channel || c.platform === filters.channel);
  }), [combined, filters]);

  // Pull 3 live Reddit + 3 LinkedIn items (fetched & classified on demand, not stored).
  const fetchLive = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.live();
      setLiveCases(r.items ?? []);
      setError(r.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the live feed (backend :8000).");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: draw demo alerts instantly + fetch the live feed.
  useEffect(() => {
    setDemoCases(drawDemoCases());
    fetchLive();
  }, [fetchLive]);

  const runScan = () => {
    setDemoCases(drawDemoCases());  // fresh random 3 / demo channel (instant, client-side)
    fetchLive();                    // fresh random 3 / live channel (Reddit + LinkedIn)
  };

  const categories = Object.keys(stats.by_category);

  return (
    <div>
      <Header running={loading} onScan={runScan} />
      <NavBar
        active={filters.severity as "" | "HIGH" | "MEDIUM" | "NONE"}
        onSelect={(s) => setFilters((f) => ({ ...f, severity: s }))}
        stats={stats}
      />

      <main className="main">
        <div className="page-head">
          <h2>Risk Surveillance Dashboard</h2>
          <div className="sub">
            Prudential Singapore · responsible-AI monitoring across {CHANNELS.length} channels for
            reputational, compliance, market-abuse &amp; cyber risk — mapped to RACM / KRI.
          </div>
        </div>

        {error && <div className="banner banner-info">ℹ Live feed: {error}</div>}
        {(stats.by_severity.HIGH ?? 0) > 0 && (
          <div className="banner banner-error">
            🚨 {stats.by_severity.HIGH} high-severity alert
            {(stats.by_severity.HIGH ?? 0) > 1 ? "s" : ""} on negative / abusive content about
            Prudential Singapore require immediate review.
          </div>
        )}

        <StatCards stats={stats} />

        <Insights d={insights} />

        <ChannelsStrip channels={CHANNELS} />

        <div className="panel">
          <div className="panel-head">
            <h3>Analysed content</h3>
            <div className="filters">
              <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{titleCase(c)}</option>
                ))}
              </select>
              <select value={filters.channel} onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}>
                <option value="">All channels</option>
                {CHANNELS.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <span className="count">{filtered.length} shown{loading ? " · refreshing live…" : ""}</span>
            </div>
          </div>
          <CasesTable cases={filtered} onSelect={setSelected} />
        </div>

        <div className="footnote">
          Monitors public &amp; legally authorized channels only · PII pseudonymized · adheres to
          jurisdictional privacy obligations (PDPA / GDPR). For internal compliance use.
        </div>
      </main>

      {selected && <CaseDrawer c={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
