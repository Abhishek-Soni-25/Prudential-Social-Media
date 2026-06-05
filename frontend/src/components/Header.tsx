import { useState } from "react";

/** Prudential logo. Uses the image at /prudential-logo.png; if it's missing, falls back
 *  to the wordmark + ribbon mark so the header never looks broken. */
function PrudentialLogo() {
  const [imgOk, setImgOk] = useState(true);
  if (imgOk) {
    return (
      <div className="logo">
        <img
          src="/prudential-logo.png"
          alt="Prudential"
          className="logo-img"
          onError={() => setImgOk(false)}
        />
      </div>
    );
  }
  return (
    <div className="logo">
      <span className="wordmark">PRUDENTIAL</span>
      <svg width="34" height="28" viewBox="0 0 34 28" fill="none" aria-hidden>
        <path
          d="M2 19C10 6 20 3 30 9c-7-1-13 2-17 8 6-4 12-4 18 0-9-3-17 0-21 7-2-2-5-4-8-5z"
          fill="#ED1B2E"
        />
        <circle cx="24" cy="10" r="2.4" fill="#ED1B2E" />
      </svg>
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
