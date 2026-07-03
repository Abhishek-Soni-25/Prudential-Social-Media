import { useState } from "react";
import { pieLayout } from "../chartSvg";

// Labeled donut/pie with leader lines (image-2 style). Interactive: hover highlights a slice.
export function PieChart({ data, colorFor }: { data: { name: string; value: number }[]; colorFor?: (n: string) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  const rows = data.filter((d) => d.value > 0);
  if (rows.length === 0) return <div className="muted" style={{ fontSize: 13 }}>No data.</div>;
  const L = pieLayout(rows, colorFor);
  return (
    <svg width="100%" viewBox={`0 0 ${L.W} ${L.H}`} style={{ display: "block", maxWidth: 620, margin: "0 auto" }}>
      {L.arcs.map((a, i) => (
        <path key={i} d={a.path} fill={a.color} opacity={hi === null || hi === i ? 1 : 0.35}
          onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ cursor: "pointer", transition: "opacity .15s" }} />
      ))}
      <text x={L.cx} y={L.cy - 2} textAnchor="middle" fontSize="28" fontWeight="800">{L.total}</text>
      <text x={L.cx} y={L.cy + 16} textAnchor="middle" fontSize="11" fill="#9aa0a8">mentions</text>
      {L.labels.map((l, i) => (
        <g key={l.name} opacity={hi === null || hi === i ? 1 : 0.4} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ cursor: "pointer" }}>
          <polyline points={l.poly} fill="none" stroke="#c2c8d2" strokeWidth={hi === i ? 1.8 : 1} />
          <text x={l.x} y={l.y - 3} textAnchor={l.anchor} fontSize="12.5" fontWeight="700" fill="#1a1a1a" className="cap">{l.name}</text>
          <text x={l.x} y={l.y + 13} textAnchor={l.anchor} fontSize="11.5" fontWeight="600" fill={l.color}>{l.count} | {l.pct}%</text>
        </g>
      ))}
    </svg>
  );
}
