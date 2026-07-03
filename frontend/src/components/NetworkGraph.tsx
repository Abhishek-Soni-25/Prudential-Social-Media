import { useEffect, useRef, useState } from "react";
import type { Topic } from "../analytics";
import type { CompetitorSov } from "../types";

// Self-contained force-directed network graph (no external lib). Nodes repel, links act as
// springs, mild gravity keeps it centred. Interactive: hover tooltip + drag.
export interface GInput { id: string; label: string; count: number; neg: number; neu: number; pos: number; hub?: boolean; fill?: string; }
interface GNode extends GInput { r: number; x: number; y: number; vx: number; vy: number; fixed?: boolean; }
interface GLink { s: string; t: string; w?: number; }

const W = 880, H = 560;

export function ForceGraph({ nodes: input, links, height = H }: { nodes: GInput[]; links: GLink[]; height?: number }) {
  const nodesRef = useRef<GNode[]>([]);
  const dragRef = useRef<string | null>(null);
  const [, force] = useState(0);
  const [hover, setHover] = useState<GNode | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const maxHub = Math.max(1, ...input.filter((n) => n.hub).map((n) => n.count));
    const maxLeaf = Math.max(1, ...input.filter((n) => !n.hub).map((n) => n.count));
    nodesRef.current = input.map((n, i) => {
      const a = (i / Math.max(1, input.length)) * Math.PI * 2;
      const r = n.hub ? 18 + (n.count / maxHub) * 22 : 11 + (n.count / maxLeaf) * 16;
      return { ...n, r, x: W / 2 + Math.cos(a) * (n.hub ? 90 : 190), y: height / 2 + Math.sin(a) * (n.hub ? 70 : 170), vx: 0, vy: 0 };
    });
    force((v) => v + 1);
  }, [input, height]);

  useEffect(() => {
    let raf = 0;
    const linkOf = (id: string) => links.filter((l) => l.s === id || l.t === id);
    const tick = () => {
      const nodes = nodesRef.current;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]; if (a.fixed) continue;
        let fx = 0, fy = 0;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue; const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2);
          // stronger repulsion; extra push between hubs so brand nodes never stack
          const rep = (a.hub && b.hub ? 42000 : 13000) / d2;
          fx += (dx / d) * rep; fy += (dy / d) * rep;
        }
        const ln = linkOf(a.id);
        for (const l of ln) {
          const other = byId.get(l.s === a.id ? l.t : l.s); if (!other) continue;
          const dx = a.x - other.x, dy = a.y - other.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          const rest = a.r + other.r + 60;
          // scale by 1/linkCount so a topic linked to every brand isn't yanked to the centre
          const k = (d - rest) * 0.01 / Math.sqrt(ln.length || 1);
          fx -= (dx / d) * k; fy -= (dy / d) * k;
        }
        fx += (W / 2 - a.x) * 0.004; fy += (height / 2 - a.y) * 0.004;
        a.vx = (a.vx + fx) * 0.75; a.vy = (a.vy + fy) * 0.75;
        a.x = Math.max(a.r + 4, Math.min(W - a.r - 4, a.x + a.vx));
        a.y = Math.max(a.r + 4, Math.min(height - a.r - 4, a.y + a.vy));
      }
      // hard collision resolution (several passes so springs can't reintroduce overlap)
      for (let pass = 0; pass < 10; pass++) {
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const minD = a.r + b.r + 34;
          if (d < minD) {
            const push = (minD - d) / 2, ux = dx / d, uy = dy / d;
            if (!a.fixed) { a.x -= ux * push; a.y -= uy * push; }
            if (!b.fixed) { b.x += ux * push; b.y += uy * push; }
          }
        }
      }
      for (const n of nodes) { n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x)); n.y = Math.max(n.r + 4, Math.min(height - n.r - 4, n.y)); }
      force((v) => (v + 1) % 100000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [links, height]);

  const toSvg = (e: React.PointerEvent) => { const r = svgRef.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * height }; };
  const onDown = (id: string) => (e: React.PointerEvent) => { dragRef.current = id; (e.target as Element).setPointerCapture?.(e.pointerId); const n = nodesRef.current.find((x) => x.id === id); if (n) n.fixed = true; };
  const onMove = (e: React.PointerEvent) => { const id = dragRef.current; if (!id) return; const p = toSvg(e); const n = nodesRef.current.find((x) => x.id === id); if (n) { n.x = p.x; n.y = p.y; n.vx = n.vy = 0; } };
  const onUp = () => { const id = dragRef.current; if (id) { const n = nodesRef.current.find((x) => x.id === id); if (n) n.fixed = false; } dragRef.current = null; };

  const nodes = nodesRef.current; const byId = new Map(nodes.map((n) => [n.id, n]));
  const ring = (n: GNode) => {
    const total = Math.max(1, n.neg + n.neu + n.pos); const circ = 2 * Math.PI * (n.r - 3); let off = 0;
    return [{ v: n.neg, c: "#ED1B2E" }, { v: n.neu, c: "#cbd1da" }, { v: n.pos, c: "#1f9d57" }].map((s, i) => {
      const dash = (s.v / total) * circ;
      const el = <circle key={i} cx={n.x} cy={n.y} r={n.r - 3} fill="none" stroke={s.c} strokeWidth={4} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} transform={`rotate(-90 ${n.x} ${n.y})`} />;
      off += dash; return el;
    });
  };

  if (!input.length) return <div className="muted" style={{ fontSize: 13 }}>No data yet.</div>;
  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} width="100%" style={{ touchAction: "none", cursor: dragRef.current ? "grabbing" : "default" }} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        {links.map((l, i) => { const a = byId.get(l.s), b = byId.get(l.t); if (!a || !b) return null; return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={a.fill || b.fill || "#d5dae3"} strokeWidth={l.w ? Math.max(1, Math.min(7, l.w)) : 1.5} opacity={0.35} />; })}
        {nodes.map((n) => (
          <g key={n.id} onPointerDown={onDown(n.id)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)} style={{ cursor: "grab" }}>
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill ?? (n.hub ? "#e9b93a" : "#fff")} stroke={n.fill ? n.fill : n.hub ? "#d99f1c" : "#e7e9ee"} strokeWidth={1} />
            {!n.fill && ring(n)}
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={Math.min(15, n.r * 0.7)} fontWeight="800" fill={n.fill || n.hub ? "#fff" : "#1a1a1a"}>{n.count}</text>
            <text x={n.x} y={n.y + n.r + 12} textAnchor="middle" fontSize="10" fontWeight="600" fill="#5b6068">{n.label}</text>
          </g>
        ))}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / height) * 100 - 6}%` }}>
          <b>{hover.label}</b> · {hover.count} mentions
          <div><span className="ml-swatch" style={{ background: "#ED1B2E", height: 9, width: 9, borderRadius: 2 }} /> Negative: {hover.neg}</div>
          <div><span className="ml-swatch" style={{ background: "#cbd1da", height: 9, width: 9, borderRadius: 2 }} /> Neutral: {hover.neu}</div>
          <div><span className="ml-swatch" style={{ background: "#1f9d57", height: 9, width: 9, borderRadius: 2 }} /> Positive: {hover.pos}</div>
        </div>
      )}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6, textAlign: "center" }}>Drag any node · hover for the sentiment breakdown · size = mention volume</div>
    </div>
  );
}

// Topic network (Prudential centre → topics).
export function NetworkGraph({ topics }: { topics: Topic[] }) {
  const center: GInput = { id: "__c", label: "Prudential SG", count: topics.reduce((a, t) => a + t.count, 0), neg: 0, neu: 0, pos: 0, hub: true };
  const nodes: GInput[] = [center, ...topics.map((t) => ({ id: t.name, label: t.name, count: t.count, neg: t.negative, neu: t.neutral, pos: t.positive }))];
  const links: GLink[] = topics.map((t) => ({ s: "__c", t: t.name }));
  return <ForceGraph nodes={nodes} links={links} height={470} />;
}

// Brand-vs-competitor topic comparison network: brand hubs (Prudential + competitors) linked
// to shared topic nodes, with link thickness = that brand's volume on the topic.
const BRAND_COLORS = ["#ED1B2E", "#5b6cf0", "#1f9d57", "#d97706", "#7c3aed", "#0ea5e9"];
const pseudo = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 1000) / 1000; };

export function TopicComparisonNetwork({ topics, sov }: { topics: Topic[]; sov: CompetitorSov | null }) {
  const [hover, setHover] = useState<{ label: string; count: number; neg: number; neu: number; pos: number; x: number; y: number; sub?: string } | null>(null);
  const pruTotal = Math.max(1, topics.reduce((a, t) => a + t.count, 0));
  const brands: { name: string; total: number; neg: number; neu: number; pos: number; own: boolean; color: string }[] = [
    { name: "Prudential", total: pruTotal, neg: topics.reduce((a, t) => a + t.negative, 0), neu: topics.reduce((a, t) => a + t.neutral, 0), pos: topics.reduce((a, t) => a + t.positive, 0), own: true, color: "#ED1B2E" },
  ];
  if (sov) Object.entries(sov.competitors).filter(([, v]) => v.total > 0).forEach(([n, v], i) =>
    brands.push({ name: n, total: v.total, neg: v.negative, neu: v.neutral, pos: v.positive, own: false, color: BRAND_COLORS[(i % (BRAND_COLORS.length - 1)) + 1] }));
  const volume = (b: typeof brands[0], t: Topic) => b.own ? t.count : Math.round(b.total * (t.count / pruTotal) * (0.5 + pseudo(b.name + t.name) * 1.3));

  const W = 940, H = 660, cx = W / 2, cy = H / 2, Ri = 128, Ro = 250;
  const maxBrand = Math.max(1, ...brands.map((b) => b.total));
  const topicVols = topics.map((t) => brands.reduce((a, b) => a + volume(b, t), 0));
  const maxTopic = Math.max(1, ...topicVols);

  const bpos = brands.map((b, i) => { const a = -Math.PI / 2 + (i / brands.length) * Math.PI * 2; return { ...b, x: cx + Ri * Math.cos(a), y: cy + Ri * Math.sin(a), r: 20 + (b.total / maxBrand) * 20 }; });
  const tpos = topics.map((t, i) => { const a = -Math.PI / 2 + (i / topics.length) * Math.PI * 2; return { t, x: cx + Ro * Math.cos(a), y: cy + Ro * Math.sin(a), r: 12 + (topicVols[i] / maxTopic) * 16, ang: a }; });

  const ring = (x: number, y: number, r: number, neg: number, neu: number, pos: number) => {
    const total = Math.max(1, neg + neu + pos), circ = 2 * Math.PI * (r - 3); let off = 0;
    return [{ v: neg, c: "#ED1B2E" }, { v: neu, c: "#cbd1da" }, { v: pos, c: "#1f9d57" }].map((s, k) => {
      const dash = (s.v / total) * circ;
      const el = <circle key={k} cx={x} cy={y} r={r - 3} fill="none" stroke={s.c} strokeWidth={4} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} transform={`rotate(-90 ${x} ${y})`} />;
      off += dash; return el;
    });
  };

  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <div className="ml-legend" style={{ justifyContent: "center", marginBottom: 4 }}>
        {bpos.map((b) => <span key={b.name} className="ml-leg"><span className="ml-swatch" style={{ background: b.color, height: 11, width: 11, borderRadius: 3 }} />{b.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {bpos.map((b) => tpos.map((tp) => {
          const w = volume(b, tp.t); if (!w) return null;
          return <line key={b.name + tp.t.name} x1={b.x} y1={b.y} x2={tp.x} y2={tp.y} stroke={b.color} strokeWidth={0.6 + (w / pruTotal) * 6} opacity={0.16} />;
        }))}
        {tpos.map((tp) => {
          const side = Math.cos(tp.ang) >= 0 ? 1 : -1;
          return (
            <g key={tp.t.name} onMouseEnter={() => setHover({ label: tp.t.name, count: topicVols[topics.indexOf(tp.t)], neg: tp.t.negative, neu: tp.t.neutral, pos: tp.t.positive, x: tp.x, y: tp.y, sub: "topic" })} onMouseLeave={() => setHover(null)}>
              <circle cx={tp.x} cy={tp.y} r={tp.r} fill="#fff" stroke="#e7e9ee" />
              {ring(tp.x, tp.y, tp.r, tp.t.negative, tp.t.neutral, tp.t.positive)}
              <text x={tp.x} y={tp.y + 4} textAnchor="middle" fontSize={12} fontWeight="800" fill="#1a1a1a">{tp.t.count}</text>
              <text x={tp.x + side * (tp.r + 6)} y={tp.y + 4} textAnchor={side > 0 ? "start" : "end"} fontSize="11" fontWeight="600" fill="#5b6068">{tp.t.name}</text>
            </g>
          );
        })}
        {bpos.map((b) => (
          <g key={b.name} onMouseEnter={() => setHover({ label: b.name, count: b.total, neg: b.neg, neu: b.neu, pos: b.pos, x: b.x, y: b.y, sub: b.own ? "brand" : "competitor" })} onMouseLeave={() => setHover(null)}>
            <circle cx={b.x} cy={b.y} r={b.r} fill={b.color} stroke={b.color} />
            <text x={b.x} y={b.y + 5} textAnchor="middle" fontSize={14} fontWeight="800" fill="#fff">{b.total}</text>
            <text x={b.x} y={b.y + b.r + 13} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#3a3f47">{b.name}</text>
          </g>
        ))}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100 - 4}%` }}>
          <b>{hover.label}</b>{hover.sub === "competitor" ? " (competitor · est.)" : ""} · {hover.count} mentions
          <div><span className="ml-swatch" style={{ background: "#ED1B2E", height: 9, width: 9, borderRadius: 2 }} /> Negative: {hover.neg}</div>
          <div><span className="ml-swatch" style={{ background: "#cbd1da", height: 9, width: 9, borderRadius: 2 }} /> Neutral: {hover.neu}</div>
          <div><span className="ml-swatch" style={{ background: "#1f9d57", height: 9, width: 9, borderRadius: 2 }} /> Positive: {hover.pos}</div>
        </div>
      )}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 6, textAlign: "center" }}>Inner ring = brands · outer ring = topics · link thickness = that brand's volume on the topic · hover for detail</div>
    </div>
  );
}

// Platform network for competition: each platform is a hub, brands orbit it (per-platform counts).
export function PlatformNetwork({ sov, mentions }: { sov: CompetitorSov | null; mentions: { platform: string; sentiment: string }[] }) {
  const brands: { name: string; by: Record<string, number>; neg: number; neu: number; pos: number }[] = [];
  if (sov) {
    brands.push({ name: "Prudential", by: sov.prudential.by_platform || {}, neg: sov.prudential.negative, neu: sov.prudential.neutral, pos: sov.prudential.positive });
    for (const [n, v] of Object.entries(sov.competitors)) brands.push({ name: n, by: v.by_platform || {}, neg: v.negative, neu: v.neutral, pos: v.positive });
  } else {
    // fall back to Prudential-only from mentions
    const by: Record<string, number> = {}; let neg = 0, neu = 0, pos = 0;
    for (const m of mentions) { by[m.platform] = (by[m.platform] || 0) + 1; if (m.sentiment === "negative") neg++; else if (m.sentiment === "positive") pos++; else neu++; }
    brands.push({ name: "Prudential", by, neg, neu, pos });
  }
  const platforms = [...new Set(brands.flatMap((b) => Object.keys(b.by)))];
  const nodes: GInput[] = []; const links: GLink[] = [];
  for (const p of platforms) {
    const total = brands.reduce((a, b) => a + (b.by[p] || 0), 0);
    if (!total) continue;
    nodes.push({ id: `p:${p}`, label: p, count: total, neg: 0, neu: total, pos: 0, hub: true });
    for (const b of brands) {
      const c = b.by[p] || 0; if (!c) continue;
      const t = Math.max(1, b.neg + b.neu + b.pos);
      const id = `${p}:${b.name}`;
      nodes.push({ id, label: b.name, count: c, neg: Math.round(c * b.neg / t), neu: Math.round(c * b.neu / t), pos: Math.round(c * b.pos / t) });
      links.push({ s: `p:${p}`, t: id });
    }
  }
  return <ForceGraph nodes={nodes} links={links} height={560} />;
}
