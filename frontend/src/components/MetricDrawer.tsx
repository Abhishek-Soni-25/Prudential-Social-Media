import { BarList } from "./Charts";
import { platformColor } from "../analytics";

export interface MetricDetail {
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string | number }[];
  bars?: { name: string; value: number }[];
  items?: { platform: string; text: string; url: string | null; sentiment: string }[];
}

// A right-side drawer that explains a clicked metric card in detail.
export function MetricDrawer({ d, onClose }: { d: MetricDetail; onClose: () => void }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="row"><span className="badge sev-NONE"><span className="pip" style={{ background: "var(--brand)" }} />DETAIL</span>
            <button className="close-x" onClick={onClose} aria-label="Close">×</button></div>
          <h3>{d.title}</h3>
          {d.subtitle && <div className="mono" style={{ marginTop: 6 }}>{d.subtitle}</div>}
        </div>
        <div className="drawer-body">
          {d.stats && d.stats.length > 0 && (
            <div className="field"><div className="lbl">Breakdown</div>
              <div className="kv">{d.stats.map((s) => (
                <div key={s.label}><div className="lbl">{s.label}</div><div className="val">{s.value}</div></div>
              ))}</div>
            </div>
          )}
          {d.bars && d.bars.length > 0 && (
            <div className="field"><div className="lbl">Distribution</div><BarList data={d.bars} /></div>
          )}
          {d.items && d.items.length > 0 && (
            <div className="field"><div className="lbl">Related posts</div>
              <div className="topic-examples">
                {d.items.map((m, i) => (
                  <a className="topic-ex" key={i} href={m.url || "#"} target="_blank" rel="noreferrer">
                    <span className="cap te-plat" style={{ color: platformColor(m.platform) }}>{m.platform}</span>
                    <span className="te-text">{m.text.slice(0, 130)}…</span>
                    <span className={`vc-tag ${m.sentiment}`}>{m.sentiment}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
