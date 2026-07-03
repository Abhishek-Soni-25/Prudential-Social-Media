// Print-ready HTML report generators — mirror the on-screen sections, with REAL embedded
// charts (donuts, area/line, colourful word cloud). window.print() → PDF.
import { kfmt } from "./reportData";
import { svgPie, svgArea, svgMultiLine, wordCloudHtml, svgPlatformNetwork, svgStackedBarH } from "./chartSvg";

const sentColor = (n: string) => n === "negative" || n === "Negative" ? "#ED1B2E" : n === "positive" || n === "Positive" ? "#1f9d57" : "#94a3b8";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const arrow = (v: number) => `<span style="color:${v >= 0 ? "#1f9d57" : "#ED1B2E"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v)}%</span>`;

const shell = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
 body{font-family:Inter,Arial,sans-serif;color:#1a1a1a;max-width:1000px;margin:0 auto;padding:0 26px 40px;}
 .cover{background:linear-gradient(120deg,#ED1B2E,#c2121f);color:#fff;padding:46px 34px;border-radius:0 0 40px 40px;margin:0 -26px 26px;}
 .cover h1{margin:0;font-size:30px;} .cover .d{opacity:.9;margin-top:6px;}
 h2{color:#ED1B2E;border-bottom:2px solid #ED1B2E;padding-bottom:6px;margin-top:34px;font-size:19px;}
 h3{font-size:14px;margin:22px 0 8px;}
 .cards{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;}
 .card{border:1px solid #e5e7eb;border-radius:12px;padding:14px 18px;min-width:150px;flex:1;}
 .card .l{font-size:12px;color:#666;} .card .v{font-size:24px;font-weight:800;margin:4px 0;}
 table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px;}
 th{background:#faf0f1;text-align:left;padding:8px;font-size:11px;text-transform:uppercase;color:#888;border-bottom:2px solid #eee;}
 td{padding:8px;border-bottom:1px solid #f0f0f0;} .bar{height:9px;background:#eef0f4;border-radius:9px;overflow:hidden;}
 .bar span{display:block;height:100%;background:#5b6cf0;} .wc{line-height:1.9;}
 .wc span{margin-right:10px;color:#c2121f;} .foot{margin-top:40px;color:#999;font-size:11px;border-top:1px solid #eee;padding-top:12px;}
 .btn{background:#ED1B2E;color:#fff;border:0;padding:10px 20px;border-radius:8px;font-weight:700;cursor:pointer;margin:14px 0;}
 @media print{.noprint{display:none;} .cover{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
<button class="btn noprint" onclick="window.print()">🖶 Save as PDF / Print</button>
<div class="cover"><h1>${esc(title)}</h1><div class="d">Prudential Singapore · ORM Risk Surveillance · Jun 2026</div></div>
${body}
<div class="foot">Prudential ORM &amp; Risk Surveillance Platform · Public &amp; authorized channels · PII pseudonymized · PDPA / GDPR. Fields marked “sample” populate from real data once collected.</div>
</body></html>`;

const cards = (items: { l: string; v: string; c?: number }[]) =>
  `<div class="cards">${items.map((i) => `<div class="card"><div class="l">${esc(i.l)}</div><div class="v">${esc(i.v)}</div>${i.c !== undefined ? arrow(i.c) : ""}</div>`).join("")}</div>`;
const barTable = (rows: { name: string; value: number }[], unit = "") => {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<table><tbody>${rows.map((r) => `<tr><td style="width:180px">${esc(r.name)}</td><td><div class="bar"><span style="width:${(r.value / max) * 100}%"></span></div></td><td style="width:90px;text-align:right;font-weight:700">${r.value.toLocaleString()}${unit}</td></tr>`).join("")}</tbody></table>`;
};
const open = (html: string) => { const w = window.open("", "_blank"); if (w) { w.document.write(html); w.document.close(); } };

export function downloadMarketing(d: ReturnType<typeof import("./reportData").marketingData>) {
  const body = `
  <h2>Section 1 · Overall Brand Summary</h2>
  <h3>Channel-Wise Follower Count</h3>${cards(d.followers.map((f) => ({ l: f.label, v: `${kfmt(f.value)} · ${f.sharePct}%`, c: f.changePct })))}
  <h3>Channel-Wise New Page Followers</h3>${cards(d.newFollowers.map((f) => ({ l: f.label, v: kfmt(f.value), c: f.changePct })))}
  <h3>Total Mentions &amp; Sentiment Split</h3>${cards(d.sentimentSplit.map((s) => ({ l: s.label, v: `${kfmt(s.value)}${s.sharePct !== undefined ? " · " + s.sharePct + "%" : ""}`, c: s.changePct })))}
  <h3>Mentions Trend</h3>${svgArea(d.trend)}
  <div style="display:flex;gap:20px;flex-wrap:wrap"><div style="flex:1;min-width:320px"><h3>Mentions Distribution</h3>${svgPie(d.distribution, sentColor)}</div><div style="flex:1;min-width:320px"><h3>Gender Distribution <small style="color:#999">(sample)</small></h3>${svgPie(d.gender)}</div></div>
  <h2>Section 2 · Voice &amp; Influencers</h2>
  <h3>Positive Word Cloud</h3>${wordCloudHtml(d.posWords)}
  <h3>Negative Word Cloud</h3>${wordCloudHtml(d.negWords)}
  <h3>Top Influencers</h3><table><thead><tr><th>Account</th><th>Platform</th><th>Posts</th><th>Engagement</th></tr></thead><tbody>${d.influencers.map((u) => `<tr><td>${esc(u.author)}</td><td>${esc(u.platform)}</td><td>${u.posts}</td><td>${u.engagement.toLocaleString()}</td></tr>`).join("")}</tbody></table>
  <h3>Top Hashtags</h3>${barTable(d.hashtags.map((h) => ({ name: h.name, value: h.value })))}
  <h2>Section 3 · Share of Voice</h2>${barTable(d.sov.map((b) => ({ name: b.name, value: b.value })))}`;
  open(shell("Marketing Report", body));
}

export function downloadListening(d: ReturnType<typeof import("./reportData").listeningData>) {
  const body = `
  <h2>Section 1 · Mentions Overview</h2>
  ${cards([{ l: "Mentions Count", v: kfmt(d.mentionsCount) }, { l: "Average Mentions/Day", v: String(d.avgPerDay) }, { l: "Incoming", v: kfmt(d.incoming) }, { l: "Outgoing", v: kfmt(d.outgoing) }, { l: "Unique Users", v: kfmt(d.uniqueUsers) }])}
  <h3>Sentiment Distribution</h3>${cards(d.sentiment.map((s) => ({ l: s.label, v: `${kfmt(s.value)} · ${s.sharePct}%`, c: s.changePct })))}
  <h3>Mentions Trend with Engagement</h3>${svgMultiLine(d.sentSeries.series, d.sentSeries.labels)}
  <div style="display:flex;gap:20px;flex-wrap:wrap"><div style="flex:1;min-width:320px"><h3>Channel-Wise Distribution</h3>${svgPie(d.channelDist)}</div>
  <div style="flex:1;min-width:320px"><h3>Channel-Wise Sentiment</h3><table><thead><tr><th>Channel</th><th>Neu</th><th>Pos</th><th>Neg</th><th>Total</th></tr></thead><tbody>${d.channelTable.map((c) => `<tr><td>${esc(c.platform)}</td><td>${c.neutral}</td><td>${c.positive}</td><td>${c.negative}</td><td><b>${c.total}</b></td></tr>`).join("")}</tbody></table></div></div>
  <h2>Section 2 · Audience &amp; Engagement</h2>
  <h3>Influencer Categories <small style="color:#999">(sample split)</small></h3>${barTable(d.influencerCategories)}
  <h3>Media Type by Engagement <small style="color:#999">(sample split)</small></h3>${barTable(d.mediaTypes)}
  <h3>Devices &amp; Sources <small style="color:#999">(sample)</small></h3>${barTable(d.devices, "%")}
  <h3>Gender Distribution <small style="color:#999">(sample)</small></h3>${svgPie(d.gender)}
  <h3>Word Cloud</h3>${wordCloudHtml(d.words)}
  <h2>Section 3 · Geography</h2>
  <h3>Top Countries <small style="color:#999">(sample)</small></h3><p style="color:#666;font-size:12px">Geographic distribution of brand &amp; competitor mentions by country.</p>${svgStackedBarH(d.countries.rows, d.countries.brands)}`;
  open(shell("Listening Overview", body));
}

export function downloadCompetition(d: ReturnType<typeof import("./reportData").competitionData>) {
  const body = `
  <h2>Section 1 · Overview Summary</h2>
  <div style="display:flex;gap:20px;flex-wrap:wrap"><div style="flex:1;min-width:320px"><h3>Share of Voice — Overall</h3>${svgPie(d.sovOverall.map((b) => ({ name: b.name, value: b.value })))}</div>
  <div style="flex:1;min-width:320px"><h3>Share of Voice — Unique Users <small style="color:#999">(sample)</small></h3>${svgPie(d.sovUnique.map((b) => ({ name: b.name, value: b.value })))}</div></div>
  <h3>Mentions Trend by Brand</h3>${svgMultiLine(d.brandTrend.series, d.brandTrend.labels)}
  <h3>Avg First-Level Response Time <small style="color:#999">(sample)</small></h3>${barTable(d.responseTimes.map((r) => ({ name: r.name, value: r.seconds })), "s")}
  <h3>Channel × Brand Network</h3><p style="color:#666;font-size:12px">Platforms as hubs; brands orbit each hub, sized by mentions, ringed by sentiment.</p>${svgPlatformNetwork(d.network)}
  <h3>Channel × Brand — mentions by platform</h3>${(() => {
    const plats = [...new Set(d.channelwise.flatMap((b) => Object.keys(b.by)))];
    return `<table><thead><tr><th>Brand</th>${plats.map((p) => `<th>${esc(p)}</th>`).join("")}</tr></thead><tbody>${d.channelwise.map((b) => `<tr><td><b>${esc(b.name)}</b></td>${plats.map((p) => `<td>${b.by[p] ?? 0}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  })()}
  <h2>Section 2 · Engagement Analysis</h2>
  <h3>Total Engagement by Brand</h3>${barTable(d.engagement.map((e) => ({ name: e.name, value: e.total })))}
  <div style="display:flex;gap:20px;flex-wrap:wrap"><div style="flex:1;min-width:320px"><h3>Likes by Brand</h3>${barTable(d.engagement.map((e) => ({ name: e.name, value: e.likes })))}</div>
  <div style="flex:1;min-width:320px"><h3>Comments by Brand</h3>${barTable(d.engagement.map((e) => ({ name: e.name, value: e.comments })))}</div></div>
  <h2>Section 3 · Word Clouds &amp; Language</h2>
  <h3>Word Cloud</h3>${wordCloudHtml(d.words)}
  <h3>Language Distribution <small style="color:#999">(sample)</small></h3>${barTable(d.language, "%")}`;
  open(shell("Competition Benchmarking", body));
}
