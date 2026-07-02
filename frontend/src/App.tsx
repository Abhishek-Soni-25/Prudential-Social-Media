import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AuthorActivity, CaseFile, CompetitorSov, Mention } from "./types";
import { ALL_CHANNELS, computeInsights, computeStats, drawDemoCases } from "./demo";
import { mentionToCase } from "./adapters";
import { Sidebar, type Page } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { CaseDrawer } from "./components/CaseDrawer";
import { Overview } from "./pages/Overview";
import { Competitors } from "./pages/Competitors";
import { Reports } from "./pages/Reports";
import {
  ListeningOverview, Influencer, CampaignAnalytics, PRDashboard, BrandIntelligence,
  CompetitiveIntelligence, ContentPerformance, ContentSense, Benchmarking,
  Publish, BulkActions, Campaign,
} from "./pages/Pages";

const REAL_CHANNELS = ["reddit", "youtube", "instagram", "telegram", "quora", "linkedin"];

const META: Record<Page, { title: string; sub: string }> = {
  pinned: { title: "Risk Surveillance Dashboard", sub: "AI monitoring across channels — sentiment & risk mapped to RACM / KRI." },
  listening_overview: { title: "Listening Overview", sub: "Volume, sentiment and trend for Prudential Singapore." },
  influencer: { title: "Influencer & UGC", sub: "Top vocal users and the user-generated content driving the conversation." },
  campaign_analytics: { title: "Campaign Analytics", sub: "Keyword campaign performance and reach by channel." },
  pr_dashboard: { title: "PR Dashboard", sub: "Reputation risk, negative sentiment and flagged items mapped to RACM / KRI." },
  brand_intelligence: { title: "Brand Intelligence — Customer Voice", sub: "AI analysis of the topics and opinions in the conversation." },
  competitive_intelligence: { title: "Competitive Contextual Pulse", sub: "Share of voice — Prudential vs the competitor set." },
  content_performance: { title: "Content Performance", sub: "Engagement by channel and the top-performing posts." },
  content_sense: { title: "Content Sense", sub: "Themes, hashtags and word clouds across the conversation." },
  bench_competition: { title: "Competition Benchmarking", sub: "Share of voice, volume and sentiment vs the competitor set." },
  bench_content: { title: "Content Benchmarking", sub: "Topic themes in the Prudential conversation." },
  reports: { title: "Reports & Export", sub: "Generate a full priority-ranked surveillance report, or export CSV." },
  publish: { title: "Publish & Respond", sub: "Reply to mentions, publish from Prudential's accounts, and track own-post engagement." },
  bulk: { title: "Bulk Actions", sub: "Select and action many mentions at once, ranked by priority." },
  campaign: { title: "Keyword Campaigns", sub: "Add your own keywords and review the channels driving collection." },
};

export default function App() {
  const [page, setPage] = useState<Page>("pinned");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [, setAuthors] = useState<AuthorActivity[]>([]);
  const [demoCases, setDemoCases] = useState<CaseFile[]>([]);
  const [sov, setSov] = useState<CompetitorSov | null>(null);
  const [compScanning, setCompScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CaseFile | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const live = mentions.length > 0;
  const channels = live ? REAL_CHANNELS : ALL_CHANNELS;
  const cases = useMemo(() => (live ? mentions.map(mentionToCase) : demoCases), [live, mentions, demoCases]);
  const stats = useMemo(() => computeStats(cases), [cases]);
  const insights = useMemo(() => computeInsights(cases, channels), [cases, channels]);

  const refresh = useCallback(async () => {
    try {
      const [m, a, s] = await Promise.all([api.mentions(), api.authors(), api.competitors().catch(() => null)]);
      setMentions(m ?? []); setAuthors(a ?? []); if (s) setSov(s);
      setBanner(m && m.length ? null : "No stored mentions yet — showing prototype data. Click “Run Scan”.");
    } catch {
      setBanner("Backend (:8000) unreachable — showing prototype data.");
    }
  }, []);

  useEffect(() => { setDemoCases(drawDemoCases()); refresh(); }, [refresh]);

  const runScan = useCallback(async () => {
    if (!window.confirm("Run a fresh scan? This calls Bright Data + Apify + Groq and is billable.")) return;
    setLoading(true);
    try {
      await api.startScan();
      for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 4000)); const s = await api.scanStatus(); await refresh(); if (!s.running) break; }
    } catch { /* ignore */ } finally { setLoading(false); await refresh(); }
  }, [refresh]);

  const runCompetitorScan = useCallback(async () => {
    if (!window.confirm("Collect competitor mentions (AIA, Great Eastern, Income, Manulife)? Billable.")) return;
    setCompScanning(true);
    try {
      await api.startCompetitorScan();
      for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 4000)); const s = await api.scanStatus(); setSov(await api.competitors().catch(() => null)); if (!s.running) break; }
    } catch { /* ignore */ } finally { setCompScanning(false); setSov(await api.competitors().catch(() => null)); }
  }, []);

  const meta = META[page];
  const sel = setSelected;

  return (
    <div className="shell">
      <Sidebar active={page} onNav={setPage} />
      <div className="content">
        <TopBar title={meta.title} subtitle={meta.sub} count={mentions.length} running={loading} live={live} onScan={runScan} />
        <main className="page">
          {banner && <div className="banner banner-info">ℹ {banner}</div>}

          {page === "pinned" && <Overview stats={stats} insights={insights} mentions={mentions} cases={cases} onSelect={sel} />}
          {page === "listening_overview" && <ListeningOverview mentions={mentions} cases={cases} onSelect={sel} />}
          {page === "influencer" && <Influencer mentions={mentions} />}
          {page === "campaign_analytics" && <CampaignAnalytics mentions={mentions} />}
          {page === "pr_dashboard" && <PRDashboard mentions={mentions} cases={cases} stats={stats} onSelect={sel} />}
          {page === "brand_intelligence" && <BrandIntelligence mentions={mentions} />}
          {page === "competitive_intelligence" && (
            <>
              <CompetitiveIntelligence mentions={mentions} sov={sov} />
              <div style={{ marginTop: 16 }}>
                <Competitors mentions={mentions} sov={sov} onScan={runCompetitorScan} scanning={compScanning} />
              </div>
            </>
          )}
          {page === "content_performance" && <ContentPerformance mentions={mentions} />}
          {page === "content_sense" && <ContentSense mentions={mentions} />}
          {page === "bench_competition" && <Benchmarking mentions={mentions} sov={sov} kind="competition" />}
          {page === "bench_content" && <Benchmarking mentions={mentions} sov={sov} kind="content" />}
          {page === "reports" && <Reports stats={stats} mentions={mentions} />}
          {page === "publish" && <Publish mentions={mentions} cases={cases} />}
          {page === "bulk" && <BulkActions cases={cases} />}
          {page === "campaign" && <Campaign mentions={mentions} />}

          <div className="footnote">
            Monitors public &amp; legally authorized channels only · PII pseudonymized · PDPA / GDPR.
            Data stored from the last scan — re-scan is manual to control provider cost.
          </div>
        </main>
      </div>
      {selected && <CaseDrawer c={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
