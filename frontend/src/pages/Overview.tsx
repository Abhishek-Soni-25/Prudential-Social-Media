import type { CaseFile, Mention, Stats } from "../types";
import type { Insights as InsightsData } from "../demo";
import { StatCards } from "../components/StatCards";
import { Insights } from "../components/Insights";
import { SentimentByPlatform } from "../components/SentimentByPlatform";
import { BarList } from "../components/Charts";
import { StackedTrend } from "../components/ReportViz";
import { engagementByPlatform, sentimentTrend, platformColor } from "../analytics";
import { CasesTable } from "../components/CasesTable";

export function Overview({
  stats, insights, mentions, cases, onSelect,
}: {
  stats: Stats; insights: InsightsData; mentions: Mention[];
  cases: CaseFile[]; onSelect: (c: CaseFile) => void;
}) {
  return (
    <>
      {(stats.by_severity.HIGH ?? 0) > 0 && (
        <div className="banner banner-error">
          🚨 {stats.by_severity.HIGH} high-severity alert{(stats.by_severity.HIGH ?? 0) > 1 ? "s" : ""} on
          negative / abusive content about Prudential Singapore require immediate review.
        </div>
      )}
      <StatCards stats={stats} />
      <Insights d={insights} />
      <div className="grid2">
        <SentimentByPlatform mentions={mentions} />
        <div className="panel">
          <div className="panel-head"><h3>Engagement by channel</h3></div>
          <div className="panel-body"><BarList data={engagementByPlatform(mentions)} colorFor={platformColor} /></div>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head"><h3>Sentiment trend over time</h3><span className="count">daily mentions stacked by sentiment · hover for the breakdown</span></div>
        <div className="panel-body"><StackedTrend data={sentimentTrend(mentions)} /></div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>Latest analysed content</h3>
          <span className="count">{cases.length} items · click a row to inspect, or “Open ↗” to verify</span>
        </div>
        <CasesTable cases={cases.slice(0, 12)} onSelect={onSelect} />
      </div>
    </>
  );
}
