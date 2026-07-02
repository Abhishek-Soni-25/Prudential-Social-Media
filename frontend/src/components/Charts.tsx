import type { Slice } from "../analytics";
import { platformColor } from "../analytics";

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

// Horizontal bar list.
export function BarList({ data, colorFor, unit }: {
  data: Slice[]; colorFor?: (name: string) => string; unit?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const color = colorFor ?? (() => "var(--pru-red)");
  if (data.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No data.</div>;
  return (
    <div>
      {data.map((d) => (
        <div className="bar-row" key={d.name}>
          <span className="bar-label cap" style={{ width: 120 }}>{d.name.replace(/_/g, " ").toLowerCase()}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: color(d.name) }} />
          </span>
          <span className="bar-val">{d.value.toLocaleString()}{unit ? ` ${unit}` : ""}</span>
        </div>
      ))}
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

// Word cloud — font size scaled by frequency.
export function WordCloud({ data }: { data: Slice[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <div className="muted" style={{ fontSize: 13 }}>Not enough text yet.</div>;
  return (
    <div className="wordcloud">
      {data.map((d) => {
        const size = 12 + Math.round((d.value / max) * 24);
        const weight = d.value / max > 0.5 ? 800 : 600;
        return (
          <span key={d.name} className="wc-word"
            style={{ fontSize: size, fontWeight: weight, opacity: 0.55 + (d.value / max) * 0.45 }}>
            {d.name}
          </span>
        );
      })}
    </div>
  );
}
