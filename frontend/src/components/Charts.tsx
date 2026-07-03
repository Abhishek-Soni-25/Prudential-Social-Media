import type { Slice } from "../analytics";
import { platformColor } from "../analytics";
import { wordCloudLayout } from "../chartSvg";

// A lightweight SVG donut chart — no chart library needed.
export function Donut({ data, colorFor, size = 190 }: {
  data: Slice[]; colorFor?: (name: string) => string; size?: number;
}) {
  const total = Math.max(1, data.reduce((a, s) => a + s.value, 0));
  const color = colorFor ?? platformColor;
  const r = size / 2;
  const stroke = size * 0.22;
  const radius = r - stroke / 2;
  const circ = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${r} ${r})`}>
          {data.map((s) => {
            const frac = s.value / total;
            const dash = frac * circ;
            const el = (
              <circle key={s.name} cx={r} cy={r} r={radius} fill="none"
                stroke={color(s.name)} strokeWidth={stroke}
                strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset} />
            );
            offset += dash;
            return el;
          })}
        </g>
        <text x={r} y={r - 4} textAnchor="middle" className="donut-total">{total}</text>
        <text x={r} y={r + 14} textAnchor="middle" className="donut-label">mentions</text>
      </svg>
      <div className="donut-legend">
        {data.map((s) => (
          <div key={s.name} className="dl-row">
            <span className="dot" style={{ background: color(s.name) }} />
            <span className="cap dl-name">{s.name}</span>
            <span className="dl-val">{s.value}<span className="muted"> · {Math.round((s.value / total) * 100)}%</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal bar list — polished: gradient fills, rounded, value chip, clean rows.
export function BarList({ data, colorFor, unit }: {
  data: Slice[]; colorFor?: (name: string) => string; unit?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const color = colorFor ?? (() => "#5b6cf0");
  if (data.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No data.</div>;
  return (
    <div className="hbars">
      {data.map((d) => {
        const c = color(d.name);
        return (
          <div className="hbar" key={d.name}>
            <span className="hbar-name cap">{d.name.replace(/_/g, " ").toLowerCase()}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${Math.max(d.value ? 4 : 0, (d.value / max) * 100)}%`, background: `linear-gradient(90deg, ${c}, ${c}bb)` }} />
            </span>
            <span className="hbar-num">{d.value.toLocaleString()}{unit ? ` ${unit}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

// Stacked daily sentiment trend (columns).
export function TrendColumns({ data }: {
  data: { day: string; positive: number; neutral: number; negative: number; total: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.total));
  if (data.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No dated items.</div>;
  return (
    <div className="trend">
      {data.map((d) => (
        <div className="trend-col" key={d.day} title={`${d.day} — ${d.total} mentions`}>
          <div className="trend-bar" style={{ height: `${(d.total / max) * 140}px` }}>
            <span style={{ height: `${(d.negative / d.total) * 100}%`, background: "var(--high)" }} />
            <span style={{ height: `${(d.neutral / d.total) * 100}%`, background: "#cbd1da" }} />
            <span style={{ height: `${(d.positive / d.total) * 100}%`, background: "var(--ok)" }} />
          </div>
          <div className="trend-day">{d.day.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

// Word cloud — circular spiral layout, colourful, hover-highlights.
export function WordCloud({ data }: { data: Slice[] }) {
  if (data.length === 0) return <div className="muted" style={{ fontSize: 13 }}>Not enough text yet.</div>;
  const W = 620, H = 340;
  const nodes = wordCloudLayout(data, W, H);
  const byName = new Map(data.map((d) => [d.name, d.value]));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: 660, margin: "0 auto" }}>
      {nodes.map((p) => (
        <text key={p.name} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
          fontSize={p.size} fontWeight={p.weight} fill={p.color} className="wc-svg-word">
          <title>{`${p.name} · ${byName.get(p.name)}`}</title>
          {p.name}
        </text>
      ))}
    </svg>
  );
}
