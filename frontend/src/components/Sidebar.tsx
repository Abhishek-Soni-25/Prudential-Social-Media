import { useState } from "react";

export type Page =
  | "pinned" | "listening_overview" | "influencer" | "campaign_analytics" | "pr_dashboard"
  | "brand_intelligence" | "competitive_intelligence"
  | "content_performance" | "content_sense"
  | "bench_competition" | "bench_content"
  | "reports"
  | "publish" | "bulk" | "campaign";

type Section = "analytics" | "reports" | "publish" | "bulk" | "campaign";

const RAIL: { key: Section; icon: string; label: string }[] = [
  { key: "analytics", icon: "▤", label: "Analytics" },
  { key: "reports", icon: "▦", label: "Reports" },
  { key: "publish", icon: "➤", label: "Publish" },
  { key: "bulk", icon: "❑", label: "Bulk Actions" },
  { key: "campaign", icon: "◎", label: "Campaign" },
];

const ANALYTICS: { group: string; items: { key: Page; label: string }[] }[] = [
  { group: "", items: [{ key: "pinned", label: "Pinned Dashboard" }] },
  { group: "Listening Insights", items: [
    { key: "listening_overview", label: "Listening Overview" },
    { key: "influencer", label: "Influencer & UGC" },
    { key: "campaign_analytics", label: "Campaign Analytics" },
    { key: "pr_dashboard", label: "PR Dashboard" },
  ] },
  { group: "Contextual Pulse™", items: [
    { key: "brand_intelligence", label: "Brand Intelligence" },
    { key: "competitive_intelligence", label: "Competitive Intelligence" },
  ] },
  { group: "Marketing Pulse", items: [
    { key: "content_performance", label: "Content Performance" },
    { key: "content_sense", label: "Content Sense" },
  ] },
  { group: "Benchmarking", items: [
    { key: "bench_competition", label: "Competition Benchmarking" },
    { key: "bench_content", label: "Content Benchmarking" },
  ] },
];

const SECTION_PAGES: Record<Exclude<Section, "analytics">, { key: Page; label: string }[]> = {
  reports: [{ key: "reports", label: "Reports & Export" }],
  publish: [{ key: "publish", label: "Publish & Respond" }],
  bulk: [{ key: "bulk", label: "Bulk Actions" }],
  campaign: [{ key: "campaign", label: "Keyword Campaigns" }],
};

const PAGE_SECTION: Record<Page, Section> = {
  pinned: "analytics", listening_overview: "analytics", influencer: "analytics",
  campaign_analytics: "analytics", pr_dashboard: "analytics",
  brand_intelligence: "analytics", competitive_intelligence: "analytics",
  content_performance: "analytics", content_sense: "analytics",
  bench_competition: "analytics", bench_content: "analytics",
  reports: "reports", publish: "publish", bulk: "bulk", campaign: "campaign",
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
              <button key={it.key} className={`sub-item ${active === it.key ? "active" : ""}`} onClick={() => onNav(it.key)}>
                {it.label}
              </button>
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
          <button key={it.key} className={`sub-item ${active === it.key ? "active" : ""}`} onClick={() => onNav(it.key)}>
            📌 {it.label}
          </button>
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
        <button key={it.key} className={`sub-item indent ${active === it.key ? "active" : ""}`} onClick={() => onNav(it.key)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}
