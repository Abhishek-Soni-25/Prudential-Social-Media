export function TopBar({
  title, subtitle, count, running, live, onScan, onMenu,
}: {
  title: string; subtitle: string; count: number; running: boolean; live: boolean; onScan: () => void; onMenu?: () => void;
}) {
  return (
    <div className="topbar">
      <div className="tb-left">
        {onMenu && <button className="hamburger" onClick={onMenu} aria-label="Menu">☰</button>}
        <div>
          <div className="tb-title">{title}</div>
          <div className="tb-sub">{subtitle}</div>
        </div>
      </div>
      <div className="tb-right">
        <span className={`data-badge ${live ? "live" : "demo"}`}>
          {live ? `● ${count} stored mentions` : "○ prototype data"}
        </span>
        <button className="btn" onClick={onScan} disabled={running} title="Runs a fresh (billable) collection across all channels">
          {running ? <><span className="spinner" /> Scanning…</> : <>▶ Run Scan</>}
        </button>
      </div>
    </div>
  );
}
