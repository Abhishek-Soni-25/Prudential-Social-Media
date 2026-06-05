import type { Channel } from "../types";

const CHANNEL_DOT: Record<string, string> = {
  telegram: "#229ED9",
  reddit: "#FF4500",
  x: "#1a1a1a",
  linkedin: "#0A66C2",
  whatsapp: "#25D366",
};

export function ChannelsStrip({ channels }: { channels: Channel[] }) {
  return (
    <div className="panel" style={{ marginBottom: 22 }}>
      <div className="panel-head">
        <h3>Monitored channels</h3>
        <span className="count">{channels.filter((c) => c.enabled).length} enabled</span>
      </div>
      <div className="panel-body">
        <div className="chan-strip">
          {channels.filter((c) => c.enabled).map((c) => (
            <div className="chan-card" key={c.name}>
              <span className="dot" style={{ background: CHANNEL_DOT[c.name] ?? "#64748b" }} />
              <span className="cn">{c.name}</span>
              <span className="mode-tag mode-live">● monitoring</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
