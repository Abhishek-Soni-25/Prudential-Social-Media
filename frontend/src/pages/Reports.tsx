import type { Mention, Stats } from "../types";
import { channelwise, topics } from "../analytics";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const eng = (m: Mention) => Object.values(m.engagement || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const priority = (m: Mention) =>
  m.severity === "HIGH" ? "High" : m.severity === "MEDIUM" || m.sentiment === "negative" ? "Medium" : "Low";

function buildReport(mentions: Mention[], stats: Stats): string {
  const cw = channelwise(mentions);
  const tp = topics(mentions);
  const neg = mentions.filter((m) => m.sentiment === "negative").length;
  const rows = [...mentions]
    .sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[priority(a)] - { High: 0, Medium: 1, Low: 2 }[priority(b)]) || eng(b) - eng(a))
    .map((m) => `
      <tr class="p-${priority(m).toLowerCase()}">
        <td><b>${esc(priority(m))}</b></td>
        <td>${esc(m.platform)}</td>
        <td>${esc(m.author)}</td>
        <td class="s-${esc(m.sentiment)}">${esc(m.sentiment)}</td>
        <td>${esc(m.severity)}${m.risk_category && m.risk_category !== "NONE" ? " · " + esc(m.risk_category.replace(/_/g, " ")) : ""}</td>
        <td>${eng(m).toLocaleString()}</td>
        <td>${esc(m.text.slice(0, 220))}${m.text.length > 220 ? "…" : ""}</td>
        <td>${m.url ? `<a href="${esc(m.url)}">source</a>` : "—"}</td>
      </tr>`).join("");

  const chan = cw.map((c) => `<tr><td>${esc(c.platform)}</td><td>${c.total}</td><td>${c.negative}</td><td>${c.neutral}</td><td>${c.positive}</td></tr>`).join("");
  const top = tp.slice(0, 8).map((t) => `<tr><td>${esc(t.name)}</td><td>${t.count}</td><td>${t.negative}</td><td>${t.positive}</td></tr>`).join("");
  const now = new Date().toLocaleString();

  return `<!doctype html><html><head><meta charset="utf-8"><title>Prudential ORM Risk Surveillance Report</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;color:#1a1a1a;max-width:960px;margin:32px auto;padding:0 24px;}
    h1{color:#ED1B2E;font-size:26px;margin-bottom:2px;} .sub{color:#666;margin-bottom:24px;}
    h2{border-bottom:2px solid #ED1B2E;padding-bottom:6px;margin-top:34px;font-size:18px;}
    .kpis{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0;}
    .kpi{border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;min-width:130px;}
    .kpi .v{font-size:26px;font-weight:800;} .kpi .l{font-size:12px;color:#666;text-transform:uppercase;}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12.5px;}
    th{background:#faf0f1;text-align:left;padding:8px;border-bottom:2px solid #eee;font-size:11px;text-transform:uppercase;color:#888;}
    td{padding:8px;border-bottom:1px solid #f0f0f0;vertical-align:top;}
    .p-high td:first-child{color:#ED1B2E;} .p-medium td:first-child{color:#e08600;}
    .s-negative{color:#ED1B2E;font-weight:600;} .s-positive{color:#1f9d57;font-weight:600;}
    a{color:#ED1B2E;} .foot{margin-top:40px;color:#999;font-size:11px;border-top:1px solid #eee;padding-top:12px;}
    @media print{.noprint{display:none;}}
    .btn{background:#ED1B2E;color:#fff;border:0;padding:10px 20px;border-radius:8px;font-weight:700;cursor:pointer;}
  </style></head><body>
  <button class="btn noprint" onclick="window.print()">🖶 Save as PDF / Print</button>
  <h1>Prudential Singapore — ORM Risk Surveillance Report</h1>
  <div class="sub">Generated ${esc(now)} · Confidential · For internal compliance use</div>

  <h2>Executive summary</h2>
  <p>This report covers <b>${stats.total_cases}</b> public mentions of Prudential Singapore analysed across
  <b>${cw.length}</b> channels. Of these, <b>${stats.by_severity.HIGH ?? 0}</b> were high-severity and
  <b>${stats.by_severity.MEDIUM ?? 0}</b> medium-severity, and <b>${neg}</b> carried negative sentiment.
  Every flagged item is mapped to the RACM / KRI framework. Items below are ordered by priority (High → Low).</p>

  <div class="kpis">
    <div class="kpi"><div class="v">${stats.total_cases}</div><div class="l">Items analysed</div></div>
    <div class="kpi"><div class="v" style="color:#ED1B2E">${stats.by_severity.HIGH ?? 0}</div><div class="l">High severity</div></div>
    <div class="kpi"><div class="v" style="color:#e08600">${stats.by_severity.MEDIUM ?? 0}</div><div class="l">Medium severity</div></div>
    <div class="kpi"><div class="v">${neg}</div><div class="l">Negative sentiment</div></div>
  </div>

  <h2>Channel breakdown</h2>
  <table><thead><tr><th>Channel</th><th>Mentions</th><th>Negative</th><th>Neutral</th><th>Positive</th></tr></thead><tbody>${chan}</tbody></table>

  <h2>Most-talked topics</h2>
  <table><thead><tr><th>Topic</th><th>Mentions</th><th>Negative</th><th>Positive</th></tr></thead><tbody>${top}</tbody></table>

  <h2>Detailed mention log (${mentions.length})</h2>
  <table><thead><tr><th>Priority</th><th>Channel</th><th>Author</th><th>Sentiment</th><th>Severity / Risk</th><th>Engagement</th><th>Content</th><th>Link</th></tr></thead><tbody>${rows}</tbody></table>

  <div class="foot">Prudential ORM &amp; Risk Surveillance Platform · Data collected from public &amp; authorized channels · PII pseudonymized · PDPA / GDPR compliant.</div>
  </body></html>`;
}

export function Reports({ stats, mentions }: { stats: Stats; mentions: Mention[] }) {
  const cw = channelwise(mentions);

  const generate = () => {
    const html = buildReport(mentions, stats);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  const exportCsv = () => {
    const head = ["priority", "platform", "author", "sentiment", "severity", "risk_category", "engagement", "timestamp", "url", "text"];
    const rows = mentions.map((m) => head.map((k) =>
      `"${String(k === "priority" ? priority(m) : k === "engagement" ? eng(m) : (m as any)[k] ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([head.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "prudential-mentions.csv"; a.click();
  };

  return (
    <>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h3>Reports &amp; export</h3>
          <div className="filters">
            <button className="btn" onClick={generate}>📄 Generate report</button>
            <button className="btn-ghost" onClick={exportCsv}>⭳ Export CSV</button>
          </div>
        </div>
        <div className="panel-body">
          <p className="report-summary">
            <b>Generate report</b> opens a full, print-ready surveillance report — executive summary,
            channel breakdown, most-talked topics, and a detailed log of every mention with its
            <b> priority, author, engagement, sentiment and severity</b>, ordered High → Low, each linked to source.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Channel breakdown (preview)</h3></div>
        <div className="panel-body">
          <table>
            <thead><tr><th>Channel</th><th>Mentions</th><th>Negative</th><th>Neutral</th><th>Positive</th></tr></thead>
            <tbody>{cw.map((c) => (
              <tr key={c.platform}><td className="cap">{c.platform}</td><td><b>{c.total}</b></td>
                <td style={{ color: "var(--high)" }}>{c.negative}</td><td className="muted">{c.neutral}</td><td style={{ color: "var(--ok)" }}>{c.positive}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}
