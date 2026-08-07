import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AuthorActivity, CaseFile, CompetitorSov, Mention } from "./types";
import { ALL_CHANNELS, computeInsights, computeStats } from "./demo";
import { mentionToCase } from "./adapters";
import { Sidebar, type Page } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Login } from "./components/Login";
import { CaseDrawer } from "./components/CaseDrawer";
import { Overview } from "./pages/Overview";
import { Reports } from "./pages/Reports";
import {
  Influencer, CampaignAnalytics, PRDashboard, ContentPerformance, ContentSense,
  Publish, BulkActions, Campaign,
} from "./pages/Pages";
import { MarketingReport, ListeningReport, CompetitionReport } from "./pages/ReportPages";
import { MediaCompliance } from "./pages/MediaCompliance";
import { MediaComplianceSettings } from "./pages/MediaComplianceSettings";

const REAL_CHANNELS = ["reddit", "youtube", "youtube_channel", "youtube_shorts", "tiktok", "instagram", "telegram", "quora", "linkedin"];

const META: Record<Page, { title: string; sub: string }> = {
  pinned: { title: "Overview Dashboard", sub: "AI monitoring across channels — sentiment & risk mapped to RACM / KRI." },
  listening_overview: { title: "Listening Overview", sub: "Deep view of incoming mentions across all channels — volume, sentiment, audience, engagement." },
  influencer: { title: "Influencers & UGC", sub: "Top vocal users and the user-generated content driving the conversation." },
  campaign_analytics: { title: "Campaign Analytics", sub: "Keyword campaign performance and reach by channel." },
  pr_dashboard: { title: "PR & Reputation", sub: "Reputation risk, negative sentiment and flagged items mapped to RACM / KRI." },
  content_sense: { title: "Topics & Themes", sub: "The topics, opinions, hashtags and word clouds in the conversation." },
  content_performance: { title: "Content Performance", sub: "Engagement by channel and the top-performing posts." },
  marketing: { title: "Marketing Report", sub: "Brand summary — followers, sentiment split, distribution, influencers and share of voice." },
  bench_competition: { title: "Competition Benchmarking", sub: "Benchmark earned & owned content against competitors — SoV, engagement, response." },
  reports: { title: "Risk Report & Export", sub: "Generate a full priority-ranked surveillance report, or export CSV." },
  publish: { title: "Publish & Respond", sub: "Reply to mentions, publish from Prudential's accounts, and track own-post engagement." },
  bulk: { title: "Bulk Actions", sub: "Select and action many mentions at once, ranked by priority." },
  campaign: { title: "Keyword Campaigns", sub: "Add your own keywords and review the channels driving collection." },
  compliance: { title: "Media Compliance", sub: "Screen adviser and marketer creatives against MAS FSG-03 and Prudential advertising policy." },
  mc_settings: { title: "Media Compliance — Settings", sub: "Manage the Do's and Don'ts. Add your own — they apply to every content, image and video screening." },
};

// --- URL-hash routing -------------------------------------------------------
// The current page is persisted in the URL hash (e.g. #campaign) so a browser
// refresh keeps the user on the same module instead of resetting to the overview.
const PAGES: Page[] = [
  "pinned", "listening_overview", "influencer", "campaign_analytics", "pr_dashboard",
  "content_sense", "content_performance", "marketing", "bench_competition",
  "reports", "publish", "bulk", "campaign", "compliance", "mc_settings",
];
const pageFromHash = (): Page => {
  const h = window.location.hash.replace(/^#\/?/, "");
  return (PAGES as string[]).includes(h) ? (h as Page) : "pinned";
};

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => localStorage.getItem("pru_auth") === "1");
  const login = useCallback(() => { localStorage.setItem("pru_auth", "1"); setAuthed(true); }, []);
  const logout = useCallback(() => { localStorage.removeItem("pru_auth"); setAuthed(false); }, []);

  const [page, setPageState] = useState<Page>(pageFromHash);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [, setAuthors] = useState<AuthorActivity[]>([]);
  const [sov, setSov] = useState<CompetitorSov | null>(null);
  const [compScanning, setCompScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<CaseFile | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // Navigate + persist to the URL hash so refresh/back/forward restore the page.
  const setPage = useCallback((p: Page) => {
    setPageState(p);
    if (window.location.hash.replace(/^#\/?/, "") !== p) window.location.hash = p;
  }, []);

  // Keep state in sync with browser back/forward and manual hash edits.
  useEffect(() => {
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener("hashchange", onHash);
    // Normalise the initial URL so a bare "/" gets an explicit hash.
    if (!window.location.hash) window.location.hash = pageFromHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Only ever render REAL stored data — no prototype/demo fallback on load.
  const live = mentions.length > 0;
  const channels = live ? REAL_CHANNELS : ALL_CHANNELS;
  const cases = useMemo(() => mentions.map(mentionToCase), [mentions]);
  const stats = useMemo(() => computeStats(cases), [cases]);
  const insights = useMemo(() => computeInsights(cases, channels), [cases, channels]);

  const refresh = useCallback(async () => {
    try {
      const [m, a, s] = await Promise.all([api.mentions(), api.authors(), api.competitors().catch(() => null)]);
      setMentions(m ?? []); setAuthors(a ?? []); if (s) setSov(s);
      setBanner(m && m.length ? null : "No stored mentions yet. Click “Run Scan” to ingest and analyse content.");
    } catch {
      setBanner("Backend (:8000) unreachable — start the API to load stored data.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { if (authed) refresh(); }, [refresh, authed]);

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

  // Gate the whole console behind the login screen (after all hooks are declared).
  if (!authed) return <Login onSuccess={login} />;

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      <Sidebar active={page} onNav={(p) => { setPage(p); setNavOpen(false); }} />
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}
      <div className="content">
        <TopBar title={meta.title} subtitle={meta.sub} count={mentions.length} running={loading} live={live} onScan={runScan} onLogout={logout} onMenu={() => setNavOpen((o) => !o)} />
        <main className="page">
          {!loaded ? (
            <div className="app-loading">
              <span className="spinner" /> Loading stored data…
            </div>
          ) : (
          <>
          {banner && <div className="banner banner-info">ℹ {banner}</div>}

          {page === "pinned" && <Overview stats={stats} insights={insights} mentions={mentions} cases={cases} onSelect={sel} />}
          {page === "listening_overview" && <ListeningReport mentions={mentions} />}
          {page === "influencer" && <Influencer mentions={mentions} />}
          {page === "campaign_analytics" && <CampaignAnalytics mentions={mentions} />}
          {page === "pr_dashboard" && <PRDashboard mentions={mentions} cases={cases} stats={stats} onSelect={sel} />}
          {page === "content_sense" && <ContentSense mentions={mentions} sov={sov} />}
          {page === "content_performance" && <ContentPerformance mentions={mentions} />}
          {page === "marketing" && <MarketingReport mentions={mentions} sov={sov} />}
          {page === "bench_competition" && <CompetitionReport mentions={mentions} sov={sov} onScan={runCompetitorScan} scanning={compScanning} />}
          {page === "reports" && <Reports stats={stats} mentions={mentions} />}
          {page === "publish" && <Publish mentions={mentions} cases={cases} />}
          {page === "bulk" && <BulkActions cases={cases} />}
          {page === "campaign" && <Campaign mentions={mentions} />}
          {page === "compliance" && <MediaCompliance />}
          {page === "mc_settings" && <MediaComplianceSettings />}

          <div className="footnote">
            Monitors public &amp; legally authorized channels only · PII pseudonymized · PDPA / GDPR.
            Data stored from the last scan — re-scan is manual to control provider cost.
          </div>
          </>
          )}
        </main>
      </div>
      {selected && <CaseDrawer c={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
