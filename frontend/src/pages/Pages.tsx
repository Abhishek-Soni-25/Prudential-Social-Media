import { useEffect, useState } from "react";
import { api } from "../api";
import type { CaseFile, CompetitorSov, Mention, Stats } from "../types";
import {
  engagementByPlatform, riskByCategory, sentimentTrend, shareOfVoice,
  topHashtags, wordCloud, topics, topicMentions, vocalUsers, platformColor,
} from "../analytics";
import { BarList, TrendColumns, WordCloud } from "../components/Charts";
import { PieChart } from "../components/Pie";
import { BubbleCluster, Treemap, VocalUsers, SovSummary } from "../components/Viz";
import { CasesTable } from "../components/CasesTable";
import { SentimentByPlatform } from "../components/SentimentByPlatform";
import { MetricDrawer, type MetricDetail } from "../components/MetricDrawer";
import { TopicComparisonNetwork } from "../components/NetworkGraph";

const CAT_COLOR: Record<string, string> = {
  REPUTATIONAL: "#ED1B2E", COMPLIANCE_CONDUCT: "#d97706", MARKET_ABUSE: "#7c3aed", CYBER_OPERATIONAL: "#2563eb",
};
const OFFICIAL = /prudential/i;
const eng = (m: Mention) => Object.values(m.engagement || {}).reduce((a, b) => a + (Number(b) || 0), 0);

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => <button key={t} className={`tab ${active === t ? "tab-on" : ""}`} onClick={() => onChange(t)}>{t}</button>)}
    </div>
  );
}

const Panel = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="panel"><div className="panel-head"><h3>{title}</h3>{right}</div><div className="panel-body">{children}</div></div>
);
const Kpi = ({ k, v, accent, sub, onClick }: { k: string; v: number | string; accent: string; sub?: string; onClick?: () => void }) => (
  <div className={`card ${onClick ? "card-click" : ""}`} onClick={onClick}>
    <div className="k"><span className="accent" style={{ background: accent }} />{k}</div>
    <div className="v" style={{ color: accent }}>{v}</div>
    {sub && <div className="ic-sub">{sub}</div>}
    {onClick && <div className="card-more">View detail →</div>}
  </div>
);

/* ---------------- Listening Overview (no SoV donut here) ---------------- */
export function ListeningOverview({ mentions, cases, onSelect }: { mentions: Mention[]; cases: CaseFile[]; onSelect: (c: CaseFile) => void }) {
  return (
    <>
      <SentimentByPlatform mentions={mentions} />
      <div style={{ height: 16 }} />
      <Panel title="Sentiment trend over time" right={<span className="count">daily volume, split by sentiment</span>}>
        <TrendColumns data={sentimentTrend(mentions)} />
      </Panel>
      <div style={{ height: 16 }} />
      <Panel title="Latest mentions" right={<span className="count">{cases.length} items</span>}>
        <div style={{ margin: "-16px -18px" }}><CasesTable cases={cases.slice(0, 15)} onSelect={onSelect} /></div>
      </Panel>
    </>
  );
}

/* ---------------- Influencer + UGC (merged) ---------------- */
export function Influencer({ mentions }: { mentions: Mention[] }) {
  const [tab, setTab] = useState("Top Vocal Users");
  const ugc = mentions.filter((m) => m.url);
  return (
    <>
      <Tabs tabs={["Top Vocal Users", "UGC Gallery"]} active={tab} onChange={setTab} />
      {tab === "Top Vocal Users" && (
        <Panel title="Top Vocal Users" right={<span className="count">accounts driving the conversation, by engagement</span>}>
          <VocalUsers users={vocalUsers(mentions)} />
        </Panel>
      )}
      {tab === "UGC Gallery" && (
        <Panel title="User-generated content" right={<span className="count">{ugc.length} public posts</span>}>
          <div className="ugc-grid">
            {ugc.map((m) => (
              <a className="ugc-card" key={m.id} href={m.url!} target="_blank" rel="noreferrer">
                <div className="ugc-top"><span className="cap" style={{ color: platformColor(m.platform) }}>{m.platform}</span>
                  <span className={`vc-tag ${m.sentiment}`}>{m.sentiment}</span></div>
                <div className="ugc-text">{m.text.slice(0, 150)}</div>
                <div className="ugc-foot mono">{m.author} · ♥ {eng(m).toLocaleString()} · open ↗</div>
              </a>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

/* ---------------- Campaign Analytics ---------------- */
export function CampaignAnalytics({ mentions }: { mentions: Mention[] }) {
  const kw = new Map<string, { total: number; neg: number; pos: number }>();
  for (const m of mentions) {
    const k = m.keyword || "Prudential Singapore";
    const d = kw.get(k) ?? { total: 0, neg: 0, pos: 0 };
    d.total += 1; if (m.sentiment === "negative") d.neg += 1; if (m.sentiment === "positive") d.pos += 1;
    kw.set(k, d);
  }
  return (
    <>
      <Panel title="Keyword campaign performance">
        <table>
          <thead><tr><th>Keyword</th><th>Mentions</th><th>Positive</th><th>Negative</th></tr></thead>
          <tbody>{[...kw.entries()].map(([k, d]) => (
            <tr key={k}><td>{k}</td><td><b>{d.total}</b></td><td style={{ color: "var(--ok)" }}>{d.pos}</td><td style={{ color: "var(--high)" }}>{d.neg}</td></tr>
          ))}</tbody>
        </table>
      </Panel>
      <div style={{ height: 16 }} />
      <Panel title="Reach by channel (mention volume)"><BarList data={shareOfVoice(mentions)} colorFor={platformColor} /></Panel>
    </>
  );
}

/* ---------------- PR Dashboard ---------------- */
export function PRDashboard({ mentions, cases, stats, onSelect }: { mentions: Mention[]; cases: CaseFile[]; stats: Stats; onSelect: (c: CaseFile) => void }) {
  const flagged = cases.filter((c) => c.risk_category && c.risk_category !== "NONE" && c.risk_category !== "GENERAL");
  return (
    <>
      <div className="cards">
        <Kpi k="Reputation items" v={flagged.length} accent="var(--pru-red)" />
        <Kpi k="High severity" v={stats.by_severity.HIGH ?? 0} accent="var(--high)" />
        <Kpi k="Negative mentions" v={mentions.filter((m) => m.sentiment === "negative").length} accent="var(--medium)" />
        <Kpi k="Channels" v={new Set(mentions.map((m) => m.platform)).size} accent="var(--brand)" />
      </div>
      <div className="grid2">
        <Panel title="Reputation risk by category"><BarList data={riskByCategory(mentions)} colorFor={(n) => CAT_COLOR[n] ?? "var(--pru-red)"} /></Panel>
        <Panel title="Sentiment split"><PieChart data={[
          { name: "negative", value: mentions.filter((m) => m.sentiment === "negative").length },
          { name: "neutral", value: mentions.filter((m) => m.sentiment === "neutral").length },
          { name: "positive", value: mentions.filter((m) => m.sentiment === "positive").length },
        ]} colorFor={(n) => n === "negative" ? "var(--high)" : n === "positive" ? "var(--ok)" : "#cbd1da"} /></Panel>
      </div>
      <Panel title="Flagged reputation items" right={<span className="count">mapped to RACM / KRI</span>}>
        <div style={{ margin: "-16px -18px" }}><CasesTable cases={flagged.length ? flagged : cases.slice(0, 10)} onSelect={onSelect} /></div>
      </Panel>
    </>
  );
}

/* ---------------- Brand Intelligence — improved Most Talked Topics ---------------- */
export function BrandIntelligence({ mentions }: { mentions: Mention[] }) {
  const t = topics(mentions);
  const [sel, setSel] = useState<string>(t[0]?.name ?? "");
  const selTopic = t.find((x) => x.name === sel);
  const examples = sel ? topicMentions(mentions, sel).sort((a, b) => eng(b) - eng(a)).slice(0, 5) : [];

  return (
    <>
      <div className="cards">
        <Kpi k="Topics detected" v={t.length} accent="var(--brand)" />
        <Kpi k="Most discussed" v={t[0]?.name ?? "—"} accent="#7c3aed" />
        <Kpi k="Most negative" v={[...t].sort((a, b) => b.negative - a.negative)[0]?.name ?? "—"} accent="var(--high)" />
        <Kpi k="Most positive" v={[...t].sort((a, b) => b.positive - a.positive)[0]?.name ?? "—"} accent="var(--ok)" />
      </div>

      <Panel title="Most talked topics" right={<span className="count">bubble size = volume · ring = sentiment · click to drill in</span>}>
        <div onClick={(e) => { const n = (e.target as HTMLElement).closest(".bubble-node")?.getAttribute("data-name"); if (n) setSel(n); }}>
          <BubbleCluster topics={t} selectable />
        </div>
      </Panel>

      <div style={{ height: 16 }} />
      <div className="grid2">
        <Panel title={`Topic detail — ${sel || "—"}`}>
          {selTopic ? (
            <>
              <div className="stacked" style={{ height: 18 }}>
                <span className="seg" style={{ width: `${(selTopic.negative / Math.max(1, selTopic.count)) * 100}%`, background: "var(--high)" }} />
                <span className="seg" style={{ width: `${(selTopic.neutral / Math.max(1, selTopic.count)) * 100}%`, background: "#cbd1da" }} />
                <span className="seg" style={{ width: `${(selTopic.positive / Math.max(1, selTopic.count)) * 100}%`, background: "var(--ok)" }} />
              </div>
              <div className="sent-legend" style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
                <span><span className="dot" style={{ background: "var(--high)" }} /> {selTopic.negative} negative</span>
                <span><span className="dot" style={{ background: "#cbd1da" }} /> {selTopic.neutral} neutral</span>
                <span><span className="dot" style={{ background: "var(--ok)" }} /> {selTopic.positive} positive</span>
              </div>
              <div className="topic-examples">
                {examples.map((m) => (
                  <a className="topic-ex" key={m.id} href={m.url || "#"} target="_blank" rel="noreferrer">
                    <span className="cap te-plat" style={{ color: platformColor(m.platform) }}>{m.platform}</span>
                    <span className="te-text">{m.text.slice(0, 130)}…</span>
                    <span className={`vc-tag ${m.sentiment}`}>{m.sentiment}</span>
                  </a>
                ))}
              </div>
            </>
          ) : <div className="muted">No topic selected.</div>}
        </Panel>
        <Panel title="Topic share of conversation"><Treemap topics={t} /></Panel>
      </div>
    </>
  );
}

/* ---------------- Content Performance ---------------- */
export function ContentPerformance({ mentions }: { mentions: Mention[] }) {
  const top = [...mentions].sort((a, b) => eng(b) - eng(a)).slice(0, 10);
  return (
    <>
      <Panel title="Total engagement by channel"><BarList data={engagementByPlatform(mentions)} colorFor={platformColor} /></Panel>
      <div style={{ height: 16 }} />
      <Panel title="Top posts by engagement">
        <table>
          <thead><tr><th>Channel</th><th>Author</th><th>Engagement</th><th>Sentiment</th><th>Open</th></tr></thead>
          <tbody>{top.map((m) => (
            <tr key={m.id}><td className="cap">{m.platform}</td><td className="mono">{m.author}</td>
              <td><b>{eng(m).toLocaleString()}</b></td>
              <td style={{ color: m.sentiment === "negative" ? "var(--high)" : m.sentiment === "positive" ? "var(--ok)" : "var(--ink-faint)" }}>{m.sentiment}</td>
              <td>{m.url ? <a className="link" href={m.url} target="_blank" rel="noreferrer">↗</a> : "—"}</td></tr>
          ))}</tbody>
        </table>
      </Panel>
    </>
  );
}

/* ---------------- Topics & Themes (Content Sense) ---------------- */
export function ContentSense({ mentions, sov }: { mentions: Mention[]; sov: CompetitorSov | null }) {
  const t = topics(mentions);
  const [sel, setSel] = useState<string>(t[0]?.name ?? "");
  const [detail, setDetail] = useState<MetricDetail | null>(null);
  const selTopic = t.find((x) => x.name === sel);
  const examples = sel ? topicMentions(mentions, sel).sort((a, b) => eng(b) - eng(a)).slice(0, 5) : [];

  // Distinct, meaningful KPIs: discussed = highest volume; criticised = highest NEGATIVE share;
  // praised = highest POSITIVE share (so they don't all collapse to the biggest topic).
  const mostDiscussed = t[0];
  const mostCriticised = [...t].filter((x) => x.negative > 0).sort((a, b) => (b.negative / b.count) - (a.negative / a.count) || b.negative - a.negative)[0];
  const mostPraised = [...t].filter((x) => x.positive > 0).sort((a, b) => (b.positive / b.count) - (a.positive / a.count) || b.positive - a.positive)[0];
  const detailFor = (x?: typeof t[0]) => x && setDetail({
    title: x.name, subtitle: `${x.count} mentions on this topic`,
    stats: [{ label: "Negative", value: x.negative }, { label: "Neutral", value: x.neutral }, { label: "Positive", value: x.positive }],
    items: topicMentions(mentions, x.name).sort((a, b) => eng(b) - eng(a)).slice(0, 6).map((m) => ({ platform: m.platform, text: m.text, url: m.url, sentiment: m.sentiment })),
  });

  return (
    <>
      <div className="cards">
        <Kpi k="Topics detected" v={t.length} accent="var(--brand)" sub={`${mentions.length} mentions analysed`} onClick={() => setDetail({ title: "All topics", stats: t.map((x) => ({ label: x.name, value: x.count })) })} />
        <Kpi k="Most discussed" v={mostDiscussed?.name ?? "—"} accent="#7c3aed" sub={mostDiscussed ? `${mostDiscussed.count} mentions` : ""} onClick={() => detailFor(mostDiscussed)} />
        <Kpi k="Most criticised" v={mostCriticised?.name ?? "—"} accent="var(--high)" sub={mostCriticised ? `${Math.round((mostCriticised.negative / mostCriticised.count) * 100)}% negative` : "no negatives"} onClick={() => detailFor(mostCriticised)} />
        <Kpi k="Most praised" v={mostPraised?.name ?? "—"} accent="var(--ok)" sub={mostPraised ? `${Math.round((mostPraised.positive / mostPraised.count) * 100)}% positive` : ""} onClick={() => detailFor(mostPraised)} />
      </div>
      {detail && <MetricDrawer d={detail} onClose={() => setDetail(null)} />}
      <Panel title="Topic network — Prudential vs competitors" right={<span className="count">brand hubs → shared topics · link thickness = volume · drag &amp; hover</span>}>
        <TopicComparisonNetwork topics={t} sov={sov} />
      </Panel>
      <div style={{ height: 16 }} />
      <Panel title="Most talked topics" right={<span className="count">bubble size = volume · ring = sentiment · click to drill in</span>}>
        <div onClick={(e) => { const n = (e.target as HTMLElement).closest(".bubble-node")?.getAttribute("data-name"); if (n) setSel(n); }}>
          <BubbleCluster topics={t} selectable />
        </div>
      </Panel>
      <div style={{ height: 16 }} />
      <div className="grid2">
        <Panel title={`Topic detail — ${sel || "—"}`} right={selTopic && <span className="count">top {examples.length} of {selTopic.count} mentions</span>}>
          {selTopic ? (
            <>
              <div className="stacked" style={{ height: 18 }}>
                <span className="seg" style={{ width: `${(selTopic.negative / Math.max(1, selTopic.count)) * 100}%`, background: "var(--high)" }} />
                <span className="seg" style={{ width: `${(selTopic.neutral / Math.max(1, selTopic.count)) * 100}%`, background: "#cbd1da" }} />
                <span className="seg" style={{ width: `${(selTopic.positive / Math.max(1, selTopic.count)) * 100}%`, background: "var(--ok)" }} />
              </div>
              <div className="muted" style={{ fontSize: 12, margin: "8px 0 2px" }}>
                The bubble counts all {selTopic.count} mentions on this topic; below are the top {examples.length} by engagement. Open the KPI card above for the full list.
              </div>
              <div className="topic-examples">
                {examples.map((m) => (
                  <a className="topic-ex" key={m.id} href={m.url || "#"} target="_blank" rel="noreferrer">
                    <span className="cap te-plat" style={{ color: platformColor(m.platform) }}>{m.platform}</span>
                    <span className="te-text">{m.text.slice(0, 130)}…</span>
                    <span className={`vc-tag ${m.sentiment}`}>{m.sentiment}</span>
                  </a>
                ))}
              </div>
            </>
          ) : <div className="muted">No topic selected.</div>}
        </Panel>
        <Panel title="Topic share of conversation"><Treemap topics={t} /></Panel>
      </div>
      <div style={{ height: 16 }} />
      <div className="grid2">
        <Panel title="Word cloud"><WordCloud data={wordCloud(mentions)} /></Panel>
        <Panel title="Top hashtags"><BarList data={topHashtags(mentions)} /></Panel>
      </div>
    </>
  );
}

/* ---------------- Benchmarking (combined, chart-rich) ---------------- */
export function Benchmarking({ mentions, sov, kind }: { mentions: Mention[]; sov: CompetitorSov | null; kind: "competition" | "content" }) {
  if (kind === "content") {
    const t = topics(mentions);
    return (
      <>
        <Panel title="Content Benchmarking — topic share of Prudential conversation"><Treemap topics={t} /></Panel>
        <div style={{ height: 16 }} />
        <Panel title="Topic sentiment mix"><BubbleCluster topics={t} /></Panel>
      </>
    );
  }

  const rows: { name: string; total: number; neg: number; neu: number; pos: number; own?: boolean }[] = [];
  if (sov) {
    rows.push({ name: "Prudential", total: sov.prudential.total, neg: sov.prudential.negative, neu: sov.prudential.neutral, pos: sov.prudential.positive, own: true });
    for (const [k, v] of Object.entries(sov.competitors)) rows.push({ name: k, total: v.total, neg: v.negative, neu: v.neutral, pos: v.positive });
  }
  rows.sort((a, b) => b.total - a.total);
  const donut = rows.map((r) => ({ name: r.name, value: r.total }));
  const hasComp = rows.some((r) => !r.own && r.total > 0);

  return (
    <>
      {!hasComp && <div className="banner banner-info" style={{ marginBottom: 16 }}>ℹ Run the competitor scan (Competitive Intelligence page) to populate the benchmark.</div>}
      <div className="grid2">
        <Panel title="Share of voice — mention volume">
          <BarList data={donut} colorFor={(n) => n === "Prudential" ? "var(--pru-red)" : "#0A66C2"} />
        </Panel>
        <Panel title="Share of voice — distribution">
          <PieChart data={donut} colorFor={(n) => n === "Prudential" ? "var(--pru-red)" : platformColor(n) || "#0A66C2"} />
        </Panel>
      </div>
      <Panel title="Sentiment comparison across brands">
        <table>
          <thead><tr><th>Brand</th><th>Mentions</th><th>Sentiment mix</th><th>Neg</th><th>Neu</th><th>Pos</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.name} style={r.own ? { background: "var(--pru-red-soft)" } : {}}>
              <td><b>{r.name}</b></td><td>{r.total}</td>
              <td style={{ width: 220 }}><span className="stacked" style={{ marginBottom: 0 }}>
                <span className="seg" style={{ width: `${(r.neg / Math.max(1, r.total)) * 100}%`, background: "var(--high)" }} />
                <span className="seg" style={{ width: `${(r.neu / Math.max(1, r.total)) * 100}%`, background: "#cbd1da" }} />
                <span className="seg" style={{ width: `${(r.pos / Math.max(1, r.total)) * 100}%`, background: "var(--ok)" }} />
              </span></td>
              <td style={{ color: "var(--high)" }}>{r.neg}</td><td className="muted">{r.neu}</td><td style={{ color: "var(--ok)" }}>{r.pos}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    </>
  );
}

/* ---------------- Competitive Intelligence (SoV donuts belong here) ---------------- */
export function CompetitiveIntelligence({ mentions, sov }: { mentions: Mention[]; sov: CompetitorSov | null }) {
  const comp = sov ? Object.entries(sov.competitors).map(([name, v]) => ({ name, value: v.total })) : [];
  const pru = sov?.prudential.total ?? mentions.length;
  const all = [{ name: "Prudential", value: pru }, ...comp];
  const total = Math.max(1, all.reduce((a, s) => a + s.value, 0));
  const colorFor = (n: string) => n === "Prudential" ? "var(--pru-red)" : "#0A66C2";
  return (
    <>
      <SovSummary yourCount={pru} groupAvg={Math.round(total / Math.max(1, all.length))} sharePct={(pru / total) * 100} />
      <div className="grid2">
        <Panel title="Share of Voice — Overall" right={<span className="count">mention volume by brand</span>}><PieChart data={all} colorFor={colorFor} /></Panel>
        <Panel title="Prudential — channel mix"><PieChart data={shareOfVoice(mentions)} /></Panel>
      </div>
    </>
  );
}

/* ---------------- Publish & Respond (tabs) ---------------- */
export function Publish({ mentions, cases }: { mentions: Mention[]; cases: CaseFile[] }) {
  const [tab, setTab] = useState("Assisted Responses");
  return (
    <>
      <Tabs tabs={["Assisted Responses", "Create Post", "Our Accounts"]} active={tab} onChange={setTab} />
      {tab === "Assisted Responses" && <AssistedResponses cases={cases} mentions={mentions} />}
      {tab === "Create Post" && <CreatePost />}
      {tab === "Our Accounts" && <OurAccounts mentions={mentions} />}
    </>
  );
}

function AssistedResponses({ cases, mentions }: { cases: CaseFile[]; mentions: Mention[] }) {
  const engOf = (url: string | null) => { const m = mentions.find((x) => x.url === url); return m ? eng(m) : 0; };
  const targets = cases.filter((c) => (c.sentiment_polarity || "").toLowerCase() === "negative" || c.severity === "HIGH" || c.severity === "MEDIUM");
  return (
    <Panel title="Assisted Responses" right={<span className="count">reply directly to items that need attention</span>}>
      {targets.length === 0 && <div className="muted">No items currently need a response.</div>}
      {targets.slice(0, 10).map((c) => <ReplyRow key={c.case_id} c={c} engagement={engOf(c.url)} />)}
    </Panel>
  );
}

function ReplyRow({ c, engagement }: { c: CaseFile; engagement: number }) {
  const [reply, setReply] = useState(`Hi, thank you for flagging this. We take feedback about Prudential Singapore seriously and have shared your concern with the right team — we'll follow up until it's resolved.`);
  const [status, setStatus] = useState<string | null>(null);
  const send = async () => {
    setStatus("Sending…");
    try { await api.publishReply({ platform: c.platform, author: c.author_ref, in_reply_to: c.url, reply }); setStatus("✓ Queued to " + c.platform); }
    catch { setStatus("✗ Failed"); }
  };
  return (
    <div className="assist-row">
      <div className="assist-post">
        <div className="assist-meta"><span className="cap" style={{ color: platformColor(c.platform) }}>{c.platform}</span>
          <span className="muted">· {c.author_ref}</span>
          <span className={`vc-tag ${(c.sentiment_polarity || "neutral").toLowerCase()}`}>{c.sentiment_polarity}</span>
          <span className="assist-eng">♥ {engagement.toLocaleString()} engagement</span></div>
        <div className="assist-src">{c.raw_content.slice(0, 200)}</div>
      </div>
      <textarea className="assist-text" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} />
      <div className="assist-actions">
        {c.url && <a className="btn-ghost" href={c.url} target="_blank" rel="noreferrer">Open post ↗</a>}
        <button className="btn" onClick={send}>➤ Send reply</button>
        {status && <span className="assist-status">{status}</span>}
      </div>
    </div>
  );
}

function CreatePost() {
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState("linkedin");
  const [file, setFile] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const send = async () => {
    if (!text.trim()) return;
    setStatus("Publishing…");
    try { await api.publishPost({ platform, text, attachment: file }); setStatus(`✓ Queued to Prudential's ${platform} account`); setText(""); setFile(null); }
    catch { setStatus("✗ Failed"); }
  };
  return (
    <Panel title="Create a post from Prudential's account" right={<span className="count">draft · attach · publish</span>}>
      <div className="compose">
        <div className="compose-row">
          <label>Account / platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {["linkedin", "instagram", "youtube", "reddit", "telegram", "quora"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <textarea className="compose-text" rows={6} placeholder="Write your post…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="compose-actions">
          <label className="btn-ghost">📎 Attach document
            <input type="file" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
          </label>
          {file && <span className="muted">{file}</span>}
          <span style={{ flex: 1 }} />
          <span className="muted">{text.length} chars</span>
          <button className="btn" onClick={send} disabled={!text.trim()}>➤ Publish</button>
        </div>
        {status && <div className="assist-status" style={{ marginTop: 10 }}>{status}</div>}
      </div>
    </Panel>
  );
}

function OurAccounts({ mentions }: { mentions: Mention[] }) {
  const own = mentions.filter((m) => OFFICIAL.test(m.author || ""));
  const totalEng = own.reduce((a, m) => a + eng(m), 0);
  return (
    <>
      <div className="cards">
        <Kpi k="Own posts tracked" v={own.length} accent="var(--brand)" />
        <Kpi k="Total engagement" v={totalEng.toLocaleString()} accent="#0A66C2" />
        <Kpi k="Avg / post" v={own.length ? Math.round(totalEng / own.length).toLocaleString() : 0} accent="var(--ok)" />
        <Kpi k="Channels" v={new Set(own.map((m) => m.platform)).size} accent="var(--medium)" />
      </div>
      <Panel title="Prudential's own posts — engagement" right={<span className="count">from official handles</span>}>
        {own.length === 0 ? <div className="muted">No posts from official Prudential handles in the current data.</div> : (
          <table>
            <thead><tr><th>Channel</th><th>Post</th><th>Engagement</th><th>Sentiment</th><th>Open</th></tr></thead>
            <tbody>{[...own].sort((a, b) => eng(b) - eng(a)).map((m) => (
              <tr key={m.id}><td className="cap">{m.platform}</td><td className="rationale-cell">{m.text.slice(0, 90)}</td>
                <td><b>{eng(m).toLocaleString()}</b></td><td>{m.sentiment}</td>
                <td>{m.url ? <a className="link" href={m.url} target="_blank" rel="noreferrer">↗</a> : "—"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

/* ---------------- Bulk Actions — priority column, sorted ---------------- */
const PRIORITY = (c: CaseFile): "High" | "Medium" | "Low" =>
  c.severity === "HIGH" ? "High" : (c.severity === "MEDIUM" || (c.sentiment_polarity || "").toLowerCase() === "negative") ? "Medium" : "Low";
const PRANK = { High: 0, Medium: 1, Low: 2 };

export function BulkActions({ cases }: { cases: CaseFile[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const rows = [...cases].sort((a, b) => PRANK[PRIORITY(a)] - PRANK[PRIORITY(b)]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Panel title="Bulk Actions" right={<span className="count">{sel.size} selected · sorted High → Low priority</span>}>
      <div className="filters" style={{ marginBottom: 12 }}>
        <button className="btn-ghost" disabled={!sel.size} onClick={() => { alert(`${sel.size} items marked reviewed`); setSel(new Set()); }}>Mark reviewed</button>
        <button className="btn-ghost" disabled={!sel.size} onClick={() => { alert(`${sel.size} items escalated`); setSel(new Set()); }}>Escalate</button>
        <button className="btn-ghost" disabled={!sel.size} onClick={() => { alert(`${sel.size} items dismissed`); setSel(new Set()); }}>Dismiss</button>
        <button className="btn-ghost" disabled={!sel.size} onClick={() => setSel(new Set())}>Clear</button>
      </div>
      <table>
        <thead><tr><th></th><th>Priority</th><th>Channel</th><th>Sentiment</th><th>Content</th></tr></thead>
        <tbody>{rows.slice(0, 50).map((c) => {
          const p = PRIORITY(c);
          return (
            <tr key={c.case_id} onClick={() => toggle(c.case_id)}>
              <td><input type="checkbox" checked={sel.has(c.case_id)} readOnly /></td>
              <td><span className={`prio prio-${p.toLowerCase()}`}>{p}</span></td>
              <td className="cap">{c.platform}</td><td>{c.sentiment_polarity}</td>
              <td className="rationale-cell">{c.raw_content.slice(0, 90)}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </Panel>
  );
}

/* ---------------- Campaign — add your own keywords ---------------- */
export function Campaign({ mentions }: { mentions: Mention[] }) {
  const [base, setBase] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const channels = [...new Set(mentions.map((m) => m.platform))];

  useEffect(() => { api.keywords().then((k) => { setBase(k.base); setCustom(k.custom); }).catch(() => {}); }, []);

  const add = async () => {
    const v = input.trim(); if (!v || custom.includes(v)) return;
    const next = [...custom, v]; setCustom(next); setInput("");
    try { const r = await api.saveKeywords(next); setCustom(r.custom); setSaved("Saved — included in the next scan"); } catch { setSaved("✗ Save failed"); }
  };
  const remove = async (k: string) => {
    const next = custom.filter((x) => x !== k); setCustom(next);
    try { await api.saveKeywords(next); setSaved("Saved"); } catch { /* ignore */ }
  };

  return (
    <>
      <Panel title="Add your own keywords" right={saved ? <span className="assist-status">{saved}</span> : undefined}>
        <div className="filters" style={{ marginBottom: 14 }}>
          <input className="search-input" placeholder="e.g. PRUShield, Prudential claim…" value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} style={{ minWidth: 280 }} />
          <button className="btn" onClick={add}>+ Add keyword</button>
        </div>
        <div className="kw-row">
          {custom.length === 0 && <span className="muted">No custom keywords yet. Add one above — it’s merged into every scan.</span>}
          {custom.map((k) => (
            <span key={k} className="kw-tag custom">{k} <button className="kw-x" onClick={() => remove(k)}>×</button></span>
          ))}
        </div>
      </Panel>
      <div style={{ height: 16 }} />
      <Panel title="Base keywords (config.yaml)"><div className="kw-row">{base.map((k) => <span key={k} className="kw-tag">{k}</span>)}</div>
        <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Monitored across {channels.length} live channels: {channels.join(", ") || "—"}.</div>
      </Panel>
      <div style={{ height: 16 }} />
      <Panel title="Competitor keyword set"><div className="kw-row">
        {["AIA Singapore", "Great Eastern Life", "Income Insurance", "Manulife Singapore"].map((k) => <span key={k} className="kw-tag comp">{k}</span>)}
      </div></Panel>
    </>
  );
}
