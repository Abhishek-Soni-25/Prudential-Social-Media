import { useState } from "react";
import type { ChangeStat } from "../reportData";
import { kfmt } from "../reportData";
import { platformColor } from "../analytics";

const CH_TINT: Record<string, string> = {
  linkedin: "#dbe7fb", instagram: "#fbe0ef", youtube: "#fbdede", reddit: "#ffe6d8",
  quora: "#f3dede", telegram: "#dceffb", facebook: "#dbe4fb", twitter: "#dfeefb", x: "#e6e8ec",
};
const CH_ICON: Record<string, string> = {
  linkedin: "in", instagram: "◉", youtube: "▶", reddit: "🐡", quora: "Q", telegram: "✈", facebook: "f", twitter: "𝕏", x: "𝕏",
};

export function ChangePct({ v }: { v: number }) {
  const up = v >= 0;
  return <span className="chg" style={{ color: up ? "var(--ok)" : "var(--high)" }}>{up ? "▲" : "▼"} {Math.abs(v)}%</span>;
}

// Pastel channel stat card (Channel-Wise Follower Count).
export function FollowerCards({ title, data, onCard }: { title: string; data: ChangeStat[]; onCard?: (label: string) => void }) {
  return (
    <div className="panel">
      <div className="panel-head"><h3>{title}</h3>{onCard && <span className="count">click a card for detail</span>}</div>
      <div className="panel-body">
        <div className="fc-grid">
          {data.map((d) => (
            <div className={`fc-card ${onCard ? "fc-click" : ""}`} key={d.label} onClick={() => onCard?.(d.label)} style={{ background: `linear-gradient(180deg,#fff, ${CH_TINT[d.label] ?? "#eef1f6"})`, borderColor: platformColor(d.label) }}>
              <div className="fc-head"><span className="fc-ico" style={{ background: platformColor(d.label) }}>{CH_ICON[d.label] ?? d.label[0]?.toUpperCase()}</span><span className="cap fc-name">{d.label}</span></div>
              <div className="fc-val">{kfmt(d.value)} {d.sharePct !== undefined && <span className="fc-share">◔ {d.sharePct}%</span>}</div>
              <ChangePct v={d.changePct} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Sentiment split cards (Total / Negative / Neutral / Positive).
const SPLIT_TINT: Record<string, string> = { "Total Mentions": "#eef1f6", Negative: "#fbe4e6", Neutral: "#fdf3d9", Positive: "#e4f6ec" };
const SPLIT_INK: Record<string, string> = { "Total Mentions": "#1a1a1a", Negative: "var(--high)", Neutral: "#b8860b", Positive: "var(--ok)" };
export function SplitCards({ data }: { data: ChangeStat[] }) {
  return (
    <div className="fc-grid">
      {data.map((d) => (
        <div className="split-card" key={d.label} style={{ background: SPLIT_TINT[d.label] ?? "#f4f5f7" }}>
          <div className="split-label">{d.label}</div>
          <div className="split-val" style={{ color: SPLIT_INK[d.label] }}>{kfmt(d.value)} {d.sharePct !== undefined && <span className="split-share">◔ {d.sharePct}%</span>}</div>
          <ChangePct v={d.changePct} />
        </div>
      ))}
    </div>
  );
}

// Simple KPI with change (Mentions Count, Avg/Day, etc.)
export function StatRow({ items }: { items: { label: string; value: string | number; changePct?: number }[] }) {
  return (
    <div className="statrow">
      {items.map((it) => (
        <div className="statrow-item" key={it.label}>
          <div className="statrow-label">{it.label}</div>
          <div className="statrow-value">{it.value} {it.changePct !== undefined && <ChangePct v={it.changePct} />}</div>
        </div>
      ))}
    </div>
  );
}

// Area-line trend chart (Total Mentions over time) — interactive: hover shows a tooltip.
export function AreaTrend({ data, height = 260 }: { data: { day: string; total: number }[]; height?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  if (data.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No dated items yet.</div>;
  const W = 900, H = height, pad = 34;
  const max = Math.max(1, ...data.map((d) => d.total));
  const n = data.length;
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.total).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1)},${H - pad} L${x(0)},${H - pad} Z`;
  return (
    <div className="chart-wrap" style={{ position: "relative", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ minWidth: 520 }}>
        <defs><linearGradient id="at" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7b8cff" stopOpacity="0.45" /><stop offset="1" stopColor="#7b8cff" stopOpacity="0.03" /></linearGradient></defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={W - pad} y1={pad + f * (H - pad * 2)} y2={pad + f * (H - pad * 2)} stroke="#eef0f4" />)}
        <path d={area} fill="url(#at)" />
        <path d={line} fill="none" stroke="#5b6cf0" strokeWidth="2.5" />
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={pad} y2={H - pad} stroke="#5b6cf0" strokeDasharray="4 3" opacity="0.5" />}
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.total)} r={hi === i ? 5.5 : 3.5} fill={hi === i ? "#5b6cf0" : "#fff"} stroke="#5b6cf0" strokeWidth="2" />)}
        {data.map((d, i) => (n <= 16 || i % 2 === 0) && <text key={i} x={x(i)} y={H - 10} fontSize="9" fill="#9aa0a8" textAnchor="middle">{d.day.slice(5)}</text>)}
        <text x={pad} y={pad - 12} fontSize="10" fill="#9aa0a8">Mentions</text>
        {data.map((_, i) => <rect key={i} x={x(i) - (W / n) / 2} y={0} width={W / n} height={H} fill="transparent" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />)}
      </svg>
      {hi !== null && (
        <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <b>{data[hi].day}</b><br />{data[hi].total} mentions
        </div>
      )}
    </div>
  );
}

// Interactive stacked sentiment trend — legend, y-axis, chronological, hover tooltip.
export function StackedTrend({ data, height = 240 }: {
  data: { day: string; positive: number; neutral: number; negative: number; total: number }[]; height?: number;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const rows = [...data].sort((a, b) => a.day.localeCompare(b.day));
  if (rows.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No dated items yet.</div>;
  const W = 900, H = height, padL = 34, padB = 30, padT = 10;
  const max = Math.max(1, ...rows.map((d) => d.total));
  const n = rows.length;
  const bw = Math.min(46, ((W - padL - 10) / n) * 0.62);
  const x = (i: number) => padL + (i + 0.5) * ((W - padL - 10) / n);
  const yScale = (v: number) => (v / max) * (H - padT - padB);
  const ticks = [0, .25, .5, .75, 1];
  return (
    <div className="chart-wrap" style={{ position: "relative", overflowX: "auto" }}>
      <div className="ml-legend">
        <span className="ml-leg"><span className="ml-swatch" style={{ background: "var(--ok)", height: 10, width: 10, borderRadius: 3 }} />Positive</span>
        <span className="ml-leg"><span className="ml-swatch" style={{ background: "#cbd1da", height: 10, width: 10, borderRadius: 3 }} />Neutral</span>
        <span className="ml-leg"><span className="ml-swatch" style={{ background: "var(--high)", height: 10, width: 10, borderRadius: 3 }} />Negative</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ minWidth: 560 }}>
        {ticks.map((f) => {
          const yy = padT + (1 - f) * (H - padT - padB);
          return <g key={f}><line x1={padL} x2={W - 10} y1={yy} y2={yy} stroke="#eef0f4" /><text x={padL - 6} y={yy + 3} fontSize="9" fill="#9aa0a8" textAnchor="end">{Math.round(max * f)}</text></g>;
        })}
        {rows.map((d, i) => {
          const base = H - padB;
          const hN = yScale(d.negative), hU = yScale(d.neutral), hP = yScale(d.positive);
          return (
            <g key={d.day} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ cursor: "pointer" }} opacity={hi === null || hi === i ? 1 : 0.5}>
              <rect x={x(i) - bw / 2} y={base - hN} width={bw} height={hN} fill="var(--high)" rx="2" />
              <rect x={x(i) - bw / 2} y={base - hN - hU} width={bw} height={hU} fill="#cbd1da" />
              <rect x={x(i) - bw / 2} y={base - hN - hU - hP} width={bw} height={hP} fill="var(--ok)" rx="2" />
              {(n <= 16 || i % 2 === 0) && <text x={x(i)} y={H - 12} fontSize="9" fill="#9aa0a8" textAnchor="middle">{d.day.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      {hi !== null && (
        <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <b>{rows[hi].day}</b> · {rows[hi].total} total
          <div><span className="ml-swatch" style={{ background: "var(--high)", height: 9, width: 9, borderRadius: 2 }} /> Negative: {rows[hi].negative}</div>
          <div><span className="ml-swatch" style={{ background: "#cbd1da", height: 9, width: 9, borderRadius: 2 }} /> Neutral: {rows[hi].neutral}</div>
          <div><span className="ml-swatch" style={{ background: "var(--ok)", height: 9, width: 9, borderRadius: 2 }} /> Positive: {rows[hi].positive}</div>
        </div>
      )}
    </div>
  );
}

// Interactive multi-series line chart (brands / sentiment over time) with legend + hover.
export function MultiLineTrend({ series, labels, height = 300 }: {
  series: { name: string; color: string; points: number[] }[]; labels: string[]; height?: number;
}) {
  const [hi, setHi] = useState<number | null>(null);
  if (!series.length || !labels.length) return <div className="muted" style={{ fontSize: 13 }}>No data.</div>;
  const W = 920, H = height, pad = 42, n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  return (
    <div className="chart-wrap" style={{ position: "relative", overflowX: "auto" }}>
      <div className="ml-legend">
        {series.map((s) => <span key={s.name} className="ml-leg"><span className="ml-swatch" style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ minWidth: 560 }}>
        {[0, .25, .5, .75, 1].map((f) => <line key={f} x1={pad} x2={W - pad} y1={pad + f * (H - pad * 2)} y2={pad + f * (H - pad * 2)} stroke="#eef0f4" />)}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={pad} y2={H - pad} stroke="#94a3b8" strokeDasharray="4 3" opacity="0.6" />}
        {series.map((s) => (
          <g key={s.name}>
            <path d={s.points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2.2" />
            {s.points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hi === i ? 4.5 : 2.6} fill="#fff" stroke={s.color} strokeWidth="2" />)}
          </g>
        ))}
        {labels.map((l, i) => (n <= 16 || i % 2 === 0) && <text key={i} x={x(i)} y={H - 12} fontSize="9" fill="#9aa0a8" textAnchor="middle">{l.slice(5)}</text>)}
        {labels.map((_, i) => <rect key={i} x={x(i) - (W / n) / 2} y={0} width={W / n} height={H} fill="transparent" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />)}
      </svg>
      {hi !== null && (
        <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <b>{labels[hi]}</b>
          {series.map((s) => <div key={s.name}><span className="ml-swatch" style={{ background: s.color }} /> {s.name}: {s.points[hi]}</div>)}
        </div>
      )}
    </div>
  );
}

// Horizontal comparison bars (response time, engagement across brands) — coloured fills.
export function HBarCompare({ data, fmt, colorOwn }: { data: { name: string; value: number; own?: boolean }[]; fmt?: (v: number) => string; colorOwn?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hbars">
      {data.map((d) => {
        const c = colorOwn && d.own ? "#ED1B2E" : "#5b6cf0";
        return (
          <div className="hbar" key={d.name}>
            <span className="hbar-name" style={{ width: 168 }}>{d.name}</span>
            <span className="hbar-track" style={{ background: `${c}1f` }}>
              <span className="hbar-fill" style={{ width: `${Math.max(5, (d.value / max) * 100)}%`, background: `linear-gradient(90deg, ${c}, ${c}bb)` }} />
            </span>
            <span className="hbar-num" style={{ width: 90, color: c }}>{fmt ? fmt(d.value) : d.value.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

export const durfmt = (secs: number) => { const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60); return `${d ? d + "D " : ""}${h}H ${m}m`; };

// 100%-stacked horizontal bars (Top Countries) — interactive hover, legend.
export function StackedBarH({ rows, brands }: {
  rows: { country: string; byBrand: Record<string, number>; total: number }[];
  brands: { name: string; color: string }[];
}) {
  const [hi, setHi] = useState<{ r: number; b: string } | null>(null);
  if (!rows.length) return <div className="muted" style={{ fontSize: 13 }}>No data.</div>;
  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <div className="cbar-rows">
        {rows.map((r, ri) => (
          <div className="cbar-row" key={r.country}>
            <span className="cbar-country">{r.country}</span>
            <span className="cbar-track">
              {brands.map((b) => {
                const v = r.byBrand[b.name] || 0; if (!v) return null;
                const pct = (v / r.total) * 100;
                return (
                  <span key={b.name} className="cbar-seg" style={{ width: `${pct}%`, background: b.color, opacity: !hi || (hi.r === ri && hi.b === b.name) ? 1 : 0.45 }}
                    onMouseEnter={() => setHi({ r: ri, b: b.name })} onMouseLeave={() => setHi(null)}
                    title={`${b.name} · ${r.country}: ${v} (${pct.toFixed(1)}%)`}>
                    {pct > 9 && <span className="cbar-pct">{pct.toFixed(0)}%</span>}
                  </span>
                );
              })}
            </span>
          </div>
        ))}
      </div>
      <div className="ml-legend" style={{ marginTop: 12, justifyContent: "center" }}>
        {brands.map((b) => <span key={b.name} className="ml-leg"><span className="ml-swatch" style={{ background: b.color, height: 11, width: 11, borderRadius: 3 }} />{b.name}</span>)}
      </div>
    </div>
  );
}

// Section banner like the report section dividers.
export function SectionBanner({ n, title }: { n: number; title: string }) {
  return <div className="rep-banner"><div className="rep-banner-n">Section {n}</div><h2 className="rep-banner-title">{title}</h2></div>;
}
