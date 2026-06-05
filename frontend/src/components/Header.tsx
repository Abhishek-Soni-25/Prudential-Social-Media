/** Prudential logo — image only (frontend/public/prudential-singapore.png). */
function PrudentialLogo() {
  return (
    <div className="logo">
      <img src="/prudential-singapore.png" alt="Prudential Singapore" className="logo-img" />
    </div>
  );
}

export function Header({
  running,
  onScan,
}: {
  running: boolean;
  onScan: () => void;
}) {
  return (
    <header className="pru-header">
      <PrudentialLogo />
      <div className="header-actions">
        <button className="btn" onClick={onScan} disabled={running}>
          {running ? (
            <>
              <span className="spinner" /> Scanning…
            </>
          ) : (
            <>▶ Run Scan</>
          )}
        </button>
      </div>
    </header>
  );
}
