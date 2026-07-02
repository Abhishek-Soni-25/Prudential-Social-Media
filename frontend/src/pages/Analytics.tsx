import { useState } from "react";
import type { Mention } from "../types";
import {
  channelwise, engagementByPlatform, riskByCategory, sentimentTrend,
  shareOfVoice, topHashtags, wordCloud, platformColor,
} from "../analytics";
import { BarList, Donut, TrendColumns, WordCloud } from "../components/Charts";

const TABS = ["Overview", "Trend & Sentiment", "Channelwise", "Engagement", "Words & Hashtags"] as const;
type Tab = typeof TABS[number];

const CAT_COLOR: Record<string, string> = {
  REPUTATIONAL: "#ED1B2E", COMPLIANCE_CONDUCT: "#d97706", MARKET_ABUSE: "#7c3aed", CYBER_OPERATIONAL: "#2563eb",
};

export function Analytics({ mentions }: { mentions: Mention[] }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const cw = channelwise(mentions);

  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "tab-on" : ""}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid2">
          <div className="panel">
            <div className="panel-head"><h3>Share of voice by channel</h3></div>
            <div className="panel-body"><Donut data={shareOfVoice(mentions)} /></div>
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Alerts by risk category</h3></div>
            <div className="panel-body"><BarList data={riskByCategory(mentions)} colorFor={(n) => CAT_COLOR[n] ?? "var(--pru-red)"} /></div>
          </div>
        </div>
      )}

      {tab === "Trend & Sentiment" && (
        <div className="panel">
          <div className="panel-head">
            <h3>Sentiment trend over time</h3>
            <span className="sent-legend" style={{ display: "flex", gap: 14 }}>
              <span><span className="dot" style={{ background: "var(--high)" }} /> Negative</span>
              <span><span className="dot" style={{ background: "#cbd1da" }} /> Neutral</span>
              <span><span className="dot" style={{ background: "var(--ok)" }} /> Positive</span>
            </span>
          </div>
          <div className="panel-body"><TrendColumns data={sentimentTrend(mentions)} /></div>
        </div>
      )}

      {tab === "Channelwise" && (
        <div className="panel">
          <div className="panel-head"><h3>Channelwise sentiment analysis</h3></div>
          <div className="panel-body">
            <table>
              <thead><tr><th>Channel</th><th>Mentions</th><th>Negative</th><th>Neutral</th><th>Positive</th><th>Sentiment mix</th></tr></thead>
              <tbody>
                {cw.map((c) => (
                  <tr key={c.platform}>
                    <td><span className="dot" style={{ background: platformColor(c.platform) }} /> <span className="cap">{c.platform}</span></td>
                    <td><b>{c.total}</b></td>
                    <td style={{ color: "var(--high)" }}>{c.negative}</td>
                    <td className="muted">{c.neutral}</td>
                    <td style={{ color: "var(--ok)" }}>{c.positive}</td>
                    <td style={{ width: 220 }}>
                      <span className="stacked" style={{ marginBottom: 0 }}>
                        <span className="seg" style={{ width: `${(c.negative / c.total) * 100}%`, background: "var(--high)" }} />
                        <span className="seg" style={{ width: `${(c.neutral / c.total) * 100}%`, background: "#cbd1da" }} />
                        <span className="seg" style={{ width: `${(c.positive / c.total) * 100}%`, background: "var(--ok)" }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Engagement" && (
        <div className="panel">
          <div className="panel-head"><h3>Total engagement by channel</h3><span className="count">likes · comments · views · upvotes · shares</span></div>
          <div className="panel-body"><BarList data={engagementByPlatform(mentions)} colorFor={platformColor} /></div>
        </div>
      )}

      {tab === "Words & Hashtags" && (
        <div className="grid2">
          <div className="panel">
            <div className="panel-head"><h3>Top hashtags</h3></div>
            <div className="panel-body"><BarList data={topHashtags(mentions)} /></div>
          </div>
          <div className="panel">
            <div className="panel-head"><h3>Word cloud</h3></div>
            <div className="panel-body"><WordCloud data={wordCloud(mentions)} /></div>
          </div>
        </div>
      )}
    </>
  );
}
