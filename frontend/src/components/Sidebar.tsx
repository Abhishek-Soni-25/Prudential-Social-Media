import { useState } from "react";

export type Page =
  | "pinned" | "listening_overview" | "influencer" | "campaign_analytics" | "pr_dashboard"
  | "content_sense" | "content_performance" | "marketing"
  | "bench_competition"
  | "reports" | "publish" | "bulk" | "campaign" | "compliance";

type Section = "analytics" | "reports" | "publish" | "bulk" | "campaign" | "compliance";

const RAIL: { key: Section; icon: string; label: string }[] = [
  { key: "analytics", icon: "▤", label: "Analytics" },
  { key: "reports", icon: "▦", label: "Reports" },
  { key: "publish", icon: "➤", label: "Publish" },
  { key: "bulk", icon: "❑", label: "Bulk Actions" },
  { key: "campaign", icon: "◎", label: "Campaign" },
  { key: "compliance", icon: "⚖", label: "Media Compliance" },
];

const ANALYTICS: { group: string; items: { key: Page; label: string }[] }[] = [
  { group: "", items: [{ key: "pinned", label: "Overview Dashboard" }] },
  { group: "Social Listening", items: [
    { key: "listening_overview", label: "Listening Overview" },
    { key: "influencer", label: "Influencers & UGC" },
    { key: "content_sense", label: "Topics & Themes" },
    { key: "pr_dashboard", label: "PR & Reputation" },
  ] },
  { group: "Marketing", items: [
    { key: "marketing", label: "Marketing Report" },
    { key: "content_performance", label: "Content Performance" },
    { key: "campaign_analytics", label: "Campaign Analytics" },
  ] },
  { group: "Benchmarking", items: [
    { key: "bench_competition", label: "Competition Benchmarking" },
  ] },
];

const SECTION_PAGES: Record<Exclude<Section, "analytics">, { key: Page; label: string }[]> = {
  reports: [{ key: "reports", label: "Risk Report & Export" }],
  publish: [{ key: "publish", label: "Publish & Respond" }],
  bulk: [{ key: "bulk", label: "Bulk Actions" }],
  campaign: [{ key: "campaign", label: "Keyword Campaigns" }],
  compliance: [{ key: "compliance", label: "Media Compliance Analyzer" }],
};

const PAGE_SECTION: Record<Page, Section> = {
  pinned: "analytics", listening_overview: "analytics", influencer: "analytics",
  campaign_analytics: "analytics", pr_dashboard: "analytics", content_sense: "analytics",
  content_performance: "analytics", marketing: "analytics",
  bench_competition: "analytics",
  reports: "reports", publish: "publish", bulk: "bulk", campaign: "campaign", compliance: "compliance",
};

export function Sidebar({ active, onNav }: { active: Page; onNav: (p: Page) => void }) {
  const [section, setSection] = useState<Section>(PAGE_SECTION[active]);

  return (
    <div className="sidebar2">
      <div className="rail">
        <img src="/prudential-singapore.png" alt="Prudential" className="rail-logo" />
        {RAIL.map((r) => (
          <button key={r.key} className={`rail-btn ${section === r.key ? "on" : ""}`}
            title={r.label} onClick={() => {
              setSection(r.key);
              onNav(r.key === "analytics" ? "pinned" : SECTION_PAGES[r.key][0].key);
            }}>
            <span className="rail-ico">{r.icon}</span>
            <span className="rail-lbl">{r.label}</span>
          </button>
        ))}
      </div>

      <div className="subnav">
        <div className="subnav-title">{RAIL.find((r) => r.key === section)?.label}</div>
        {section === "analytics" ? (
          <div className="subnav-tree">
            <div className="subnav-alldash">▤ All Dashboards</div>
            {ANALYTICS.map((g, gi) => (
              <AnalyticsGroup key={gi} group={g.group} items={g.items} active={active} onNav={onNav} />
            ))}
          </div>
        ) : (
          <div className="subnav-tree">
            {SECTION_PAGES[section].map((it) => (
              <button key={it.key} className={`sub-item ${active === it.key ? "active" : ""}`} onClick={() => onNav(it.key)}>{it.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsGroup({ group, items, active, onNav }: {
  group: string; items: { key: Page; label: string }[]; active: Page; onNav: (p: Page) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!group) {
    return (
      <div className="subnav-flat">
        {items.map((it) => (
          <button key={it.key} className={`sub-item ${active === it.key ? "active" : ""}`} onClick={() => onNav(it.key)}>📌 {it.label}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="subnav-group">
      <button className="subnav-group-head" onClick={() => setOpen((o) => !o)}>
        <span>{group}</span><span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && items.map((it) => (
        <button key={it.key} className={`sub-item indent ${active === it.key ? "active" : ""}`} onClick={() => onNav(it.key)}>{it.label}</button>
      ))}
    </div>
  );
}
