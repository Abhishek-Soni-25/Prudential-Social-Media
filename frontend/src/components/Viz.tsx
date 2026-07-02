import type { Topic, VocalUser } from "../analytics";
import { platformColor } from "../analytics";

// A sentiment mini-donut used inside bubble nodes (green=pos, grey=neu, red=neg).
function SentiRing({ pos, neu, neg, size }: { pos: number; neu: number; neg: number; size: number }) {
  const total = Math.max(1, pos + neu + neg);
  const r = size / 2, radius = r - 3, circ = 2 * Math.PI * radius;
  let off = 0;
  const segs = [
    { v: neg, c: "var(--high)" }, { v: neu, c: "#cbd1da" }, { v: pos, c: "var(--ok)" },
  ];
  return (
    <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
      <g transform={`rotate(-90 ${r} ${r})`}>
        {segs.map((s, i) => {
          const dash = (s.v / total) * circ;
          const el = <circle key={i} cx={r} cy={r} r={radius} fill="none" stroke={s.c}
            strokeWidth={5} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} />;
          off += dash;
          return el;
        })}
      </g>
    </svg>
  );
}

// "Most Talked" bubble cluster — bubble size ∝ volume, ring ∝ sentiment split.
export function BubbleCluster({ topics, selectable }: { topics: Topic[]; selectable?: boolean }) {
  const max = Math.max(1, ...topics.map((t) => t.count));
  if (!topics.length) return <div className="muted" style={{ fontSize: 13 }}>No topics detected yet.</div>;
  return (
    <div className="bubble-cluster">
      {topics.map((t) => {
        const size = 74 + Math.round((t.count / max) * 96);
        return (
          <div className={`bubble-node ${selectable ? "clickable" : ""}`} data-name={t.name} key={t.name} style={{ width: size, height: size }} title={`${t.name}: ${t.count}`}>
            <SentiRing pos={t.positive} neu={t.neutral} neg={t.negative} size={size} />
            <div className="bubble-inner">
              <div className="bubble-count">{t.count}</div>
              <div className="bubble-name">{t.name}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Treemap of topics — tile area ∝ share, colored by dominant sentiment.
export function Treemap({ topics }: { topics: Topic[] }) {
  const total = Math.max(1, topics.reduce((a, t) => a + t.count, 0));
  if (!topics.length) return <div className="muted" style={{ fontSize: 13 }}>No topics detected yet.</div>;
  const tone = (t: Topic) => {
    if (t.negative >= t.positive && t.negative >= t.neutral) return "#fbe4e6";
    if (t.positive >= t.neutral) return "#e4f6ec";
    return "#eef1f6";
  };
  return (
    <div className="treemap">
      {topics.map((t) => {
        const pct = (t.count / total) * 100;
        const grow = 1 + (t.count / total) * 3;
        return (
          <div className="tm-tile" key={t.name} style={{ flexGrow: grow, background: tone(t) }} title={`${t.name}: ${t.count} (${pct.toFixed(1)}%)`}>
            <div className="tm-name">{t.name}</div>
            <div className="tm-val">{t.count} · {pct.toFixed(1)}%</div>
            <div className="tm-sent">
              <span style={{ color: "var(--high)" }}>{t.negative}▾</span>{" "}
              <span style={{ color: "var(--ok)" }}>{t.positive}▴</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Top Vocal Users — author cards with engagement metrics (Locobuzz Influencer view).
export function VocalUsers({ users }: { users: VocalUser[] }) {
  if (!users.length) return <div className="empty">No accounts yet. Run a scan to collect mentions.</div>;
  return (
    <div className="vocal-grid">
      {users.slice(0, 12).map((u) => {
        const dominant = u.negative >= u.positive ? "negative" : "positive";
        return (
          <div className="vocal-card" key={`${u.platform}:${u.author}`}>
            <div className="vc-head">
              <span className="vc-avatar" style={{ background: platformColor(u.platform) }}>
                {(u.author || "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="vc-id">
                <div className="vc-name">{u.author}</div>
                <div className="vc-plat cap">{u.platform}</div>
              </div>
              <span className={`vc-tag ${dominant}`}>{dominant}</span>
            </div>
            <div className="vc-metrics">
              <Metric label="Posts" v={u.posts} />
              <Metric label="Engagement" v={u.engagement.toLocaleString()} />
              <Metric label="Negative" v={u.negative} />
              <Metric label="Positive" v={u.positive} />
            </div>
            {u.latestUrl && (
              <a className="link vc-open" href={u.latestUrl} target="_blank" rel="noreferrer">Open latest post ↗</a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, v }: { label: string; v: number | string }) {
  return <div className="vc-metric"><div className="vcm-v">{v}</div><div className="vcm-l">{label}</div></div>;
}

// Share-of-Voice summary tiles (Group average vs Your count) — Locobuzz competitive view.
export function SovSummary({ yourCount, groupAvg, sharePct }: {
  yourCount: number; groupAvg: number; sharePct: number;
}) {
  return (
    <div className="sov-summary">
      <div className="sov-stat"><div className="sov-stat-l">Group's Average</div><div className="sov-stat-v">{groupAvg}</div></div>
      <div className="sov-stat you"><div className="sov-stat-l">Your Count</div>
        <div className="sov-stat-v">{yourCount} <span className="sov-share">| {sharePct.toFixed(1)}%</span></div>
      </div>
    </div>
  );
}
