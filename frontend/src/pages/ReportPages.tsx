import { useMemo } from "react";
import type { CompetitorSov, Mention } from "../types";
import { marketingData, listeningData, competitionData, sentimentSeries, brandTrendSeries, platformColor } from "../reportData";
import { downloadMarketing, downloadListening, downloadCompetition } from "../reportBuilders";
import { FollowerCards, SplitCards, StatRow, AreaTrend, MultiLineTrend, HBarCompare, StackedBarH, durfmt, SectionBanner } from "../components/ReportViz";
import { BarList, WordCloud } from "../components/Charts";
import { PieChart } from "../components/Pie";
import { VocalUsers, SovSummary } from "../components/Viz";
import { PlatformNetwork } from "../components/NetworkGraph";
import { MetricDrawer, type MetricDetail } from "../components/MetricDrawer";
import { Competitors } from "./Competitors";
import { useState } from "react";

const Panel = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="panel"><div className="panel-head"><h3>{title}</h3>{right}</div><div className="panel-body">{children}</div></div>
);
const DownloadBar = ({ label, onClick, sample }: { label: string; onClick: () => void; sample: boolean }) => (
  <div className="report-toolbar">
    {sample && <span className="sample-tag">Showing sample data — run a scan for live figures</span>}
    <span style={{ flex: 1 }} />
    <button className="btn" onClick={onClick}>⬇ {label}</button>
  </div>
);
const sentColor = (n: string) => n === "negative" ? "var(--high)" : n === "positive" ? "var(--ok)" : "#cbd1da";

/* ================= MARKETING ================= */
export function MarketingReport({ mentions, sov }: { mentions: Mention[]; sov: CompetitorSov | null }) {
  const d = useMemo(() => marketingData(mentions, sov), [mentions, sov]);
  const [detail, setDetail] = useState<MetricDetail | null>(null);
  const channelDetail = (label: string) => {
    const ch = mentions.filter((m) => m.platform === label);
    const e = (m: Mention) => Object.values(m.engagement || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    setDetail({
      title: `${label} — channel detail`,
      subtitle: `${ch.length} tracked mentions on ${label}`,
      stats: [
        { label: "Mentions", value: ch.length },
        { label: "Engagement", value: ch.reduce((a, m) => a + e(m), 0).toLocaleString() },
        { label: "Negative", value: ch.filter((m) => m.sentiment === "negative").length },
        { label: "Positive", value: ch.filter((m) => m.sentiment === "positive").length },
      ],
      items: ch.sort((a, b) => e(b) - e(a)).slice(0, 6).map((m) => ({ platform: m.platform, text: m.text, url: m.url, sentiment: m.sentiment })),
    });
  };
  return (
    <>
      {detail && <MetricDrawer d={detail} onClose={() => setDetail(null)} />}
      <DownloadBar label="Download Marketing Report" onClick={() => downloadMarketing(d)} sample={d.sample} />
      <SectionBanner n={1} title="Overall Brand Summary" />
      <FollowerCards title="Channel-Wise Follower Count" data={d.followers} onCard={channelDetail} />
      <div style={{ height: 16 }} />
      <FollowerCards title="Channel-Wise New Page Followers / Subscribers" data={d.newFollowers} onCard={channelDetail} />
      <div style={{ height: 16 }} />
      <Panel title="Total Mentions & Sentiment Split">
        <SplitCards data={d.sentimentSplit} />
        <div style={{ height: 14 }} />
        <AreaTrend data={d.trend} />
      </Panel>
      <div style={{ height: 16 }} />
      <div className="grid2">
        <Panel title="Mentions Distribution"><PieChart data={d.distribution} colorFor={sentColor} /></Panel>
        <Panel title="Gender Distribution"><PieChart data={d.gender} colorFor={(n) => n === "Male" ? "#5b6cf0" : n === "Female" ? "#ED1B2E" : "#cbd1da"} /></Panel>
      </div>
      <div className="grid2">
        <Panel title="Positive Word Cloud"><WordCloud data={d.posWords} /></Panel>
        <Panel title="Negative Word Cloud"><WordCloud data={d.negWords} /></Panel>
      </div>
      <SectionBanner n={2} title="Voice & Influencers" />
      <Panel title="Top Influencers"><VocalUsers users={d.influencers} /></Panel>
      <div style={{ height: 16 }} />
      <div className="grid2">
        <Panel title="Top Hashtags"><BarList data={d.hashtags} /></Panel>
        <Panel title="Share of Voice"><BarList data={d.sov.map((b) => ({ name: b.name, value: b.value }))} colorFor={(n) => n.includes("Prudential") ? "var(--pru-red)" : "#5b6cf0"} /></Panel>
      </div>
    </>
  );
}

/* ================= LISTENING ================= */
export function ListeningReport({ mentions }: { mentions: Mention[] }) {
  const d = useMemo(() => listeningData(mentions), [mentions]);
  return (
    <>
      <DownloadBar label="Download Listening Report" onClick={() => downloadListening(d)} sample={d.sample} />
      <SectionBanner n={1} title="Mentions Overview" />
      <StatRow items={[
        { label: "Mentions Count", value: d.mentionsCount.toLocaleString() },
        { label: "Average Mentions / Day", value: d.avgPerDay },
        { label: "Incoming Mentions", value: d.incoming.toLocaleString() },
        { label: "Outgoing Mentions", value: d.outgoing.toLocaleString() },
        { label: "Unique Users", value: d.uniqueUsers.toLocaleString() },
      ]} />
      <Panel title="Sentiment Distribution"><SplitCards data={d.sentiment} /></Panel>
      <div style={{ height: 16 }} />
      <Panel title="Mentions Trend with Engagement" right={<span className="count">hover for daily values</span>}>
        <MultiLineTrend {...sentimentSeries(mentions)} />
      </Panel>
      <div style={{ height: 16 }} />
      <div className="grid2">
        <Panel title="Channel-Wise Distribution"><PieChart data={d.channelDist} /></Panel>
        <Panel title="Channel-Wise Sentiment">
          <table>
            <thead><tr><th>Channel</th><th>Neutral</th><th>Positive</th><th>Negative</th><th>Mentions</th></tr></thead>
            <tbody>{d.channelTable.map((c) => (
              <tr key={c.platform}><td className="cap">{c.platform}</td><td className="muted">{c.neutral}</td>
                <td style={{ color: "var(--ok)" }}>{c.positive}</td><td style={{ color: "var(--high)" }}>{c.negative}</td><td><b>{c.total}</b></td></tr>
            ))}</tbody>
          </table>
        </Panel>
      </div>
      <SectionBanner n={2} title="Audience & Engagement" />
      <div className="grid2">
        <Panel title="Influencer Categories" right={<span className="sample-tag">sample split</span>}><BarList data={d.influencerCategories} colorFor={() => "#5b6cf0"} /></Panel>
        <Panel title="Media Type by Engagement" right={<span className="sample-tag">sample split</span>}><BarList data={d.mediaTypes} colorFor={() => "#7c3aed"} /></Panel>
      </div>
      <div className="grid2">
        <Panel title="Devices & Sources" right={<span className="sample-tag">sample</span>}><PieChart data={d.devices} colorFor={(n) => n === "Mobile" ? "#5b6cf0" : n === "Desktop" ? "#ED1B2E" : "#cbd1da"} /></Panel>
        <Panel title="Gender Distribution" right={<span className="sample-tag">sample</span>}><PieChart data={d.gender} colorFor={(n) => n === "Male" ? "#5b6cf0" : n === "Female" ? "#ED1B2E" : "#cbd1da"} /></Panel>
      </div>
      <Panel title="Word Cloud"><WordCloud data={d.words} /></Panel>
      <div style={{ height: 16 }} />
      <Panel title="Top Countries" right={<span className="sample-tag">sample</span>}>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Geographic distribution of mentions by country, split by the channel they came from.</div>
        <StackedBarH {...d.countries} />
      </Panel>
    </>
  );
}

/* ================= COMPETITION ================= */
export function CompetitionReport({ mentions, sov, onScan, scanning }: {
  mentions: Mention[]; sov: CompetitorSov | null; onScan: () => void; scanning: boolean;
}) {
  const d = useMemo(() => competitionData(sov, mentions), [sov, mentions]);
  const pru = d.sovOverall.find((b) => b.own)?.value ?? mentions.length;
  const total = Math.max(1, d.sovOverall.reduce((a, b) => a + b.value, 0));
  return (
    <>
      <DownloadBar label="Download Competition Report" onClick={() => downloadCompetition(d)} sample={d.sample} />
      <SectionBanner n={1} title="Overview Summary" />
      <SovSummary yourCount={pru} groupAvg={Math.round(total / Math.max(1, d.sovOverall.length))} sharePct={(pru / total) * 100} />
      <div className="grid2">
        <Panel title="Share of Voice — Overall"><PieChart data={d.sovOverall.map((b) => ({ name: b.name, value: b.value }))} colorFor={(n) => n.includes("Prudential") ? "var(--pru-red)" : "#5b6cf0"} /></Panel>
        <Panel title="Share of Voice — Unique Users" right={<span className="sample-tag">sample</span>}><PieChart data={d.sovUnique.map((b) => ({ name: b.name, value: b.value }))} colorFor={(n) => n.includes("Prudential") ? "var(--pru-red)" : "#5b6cf0"} /></Panel>
      </div>
      <Panel title="Avg First-Level Response Time" right={<span className="sample-tag">sample</span>}>
        <HBarCompare data={d.responseTimes.map((r) => ({ name: r.name, value: r.seconds, own: r.name.includes("Prudential") }))} fmt={durfmt} colorOwn />
      </Panel>
      <div style={{ height: 16 }} />
      <Panel title="Mentions Trend by Brand" right={<span className="count">hover for per-brand daily values</span>}>
        <MultiLineTrend {...brandTrendSeries(sov, mentions)} />
      </Panel>
      <div style={{ height: 16 }} />
      <Panel title="Channel × Brand Network" right={<span className="count">platforms as hubs · brands orbit · drag &amp; hover</span>}>
        <PlatformNetwork sov={sov} mentions={mentions} />
      </Panel>
      <SectionBanner n={2} title="Engagement Analysis" />
      <div className="grid2">
        <Panel title="Total Engagement by Brand"><HBarCompare data={d.engagement.map((e) => ({ name: e.name, value: e.total, own: e.name.includes("Prudential") }))} colorOwn /></Panel>
        <Panel title="Likes by Brand"><HBarCompare data={d.engagement.map((e) => ({ name: e.name, value: e.likes, own: e.name.includes("Prudential") }))} colorOwn /></Panel>
      </div>
      <Panel title="Comments by Brand"><HBarCompare data={d.engagement.map((e) => ({ name: e.name, value: e.comments, own: e.name.includes("Prudential") }))} colorOwn /></Panel>
      <div style={{ height: 16 }} />
      <Panel title="Channelwise Mentions by Brand">
        <table>
          <thead><tr><th>Brand</th>{[...new Set(d.channelwise.flatMap((b) => Object.keys(b.by)))].map((p) => <th key={p} className="cap">{p}</th>)}</tr></thead>
          <tbody>{d.channelwise.map((b) => (
            <tr key={b.name} style={b.own ? { background: "var(--pru-red-soft)" } : {}}>
              <td><b>{b.name}</b></td>
              {[...new Set(d.channelwise.flatMap((x) => Object.keys(x.by)))].map((p) => <td key={p}>{b.by[p] ?? 0}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      <SectionBanner n={3} title="Voice, Words & Language" />
      <Panel title="Top Influencers"><VocalUsers users={d.influencers} /></Panel>
      <div style={{ height: 16 }} />
      <div className="grid2">
        <Panel title="Word Cloud"><WordCloud data={d.words} /></Panel>
        <Panel title="Language Distribution" right={<span className="sample-tag">sample</span>}><BarList data={d.language} unit="%" colorFor={() => "#5b6cf0"} /></Panel>
      </div>
      <div style={{ height: 16 }} />
      <Competitors mentions={mentions} sov={sov} onScan={onScan} scanning={scanning} />
    </>
  );
}

export { platformColor };
