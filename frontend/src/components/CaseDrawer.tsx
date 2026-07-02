import type { CaseFile } from "../types";
import { CategoryChip, SeverityBadge, fmtTime } from "./ui";

export function CaseDrawer({ c, onClose }: { c: CaseFile; onClose: () => void }) {
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="row">
            <SeverityBadge severity={c.severity} />
            <button className="close-x" onClick={onClose} aria-label="Close">×</button>
          </div>
          <h3>{c.risk_category.replace(/_/g, " ")}</h3>
          <div className="mono" style={{ marginTop: 6 }}>{c.case_id}</div>
        </div>

        <div className="drawer-body">
          <div className="field">
            <div className="lbl">Rationale</div>
            <div className="val">{c.rationale}</div>
          </div>

          {c.indicators?.length > 0 && (
            <div className="field">
              <div className="lbl">Detected indicators</div>
              <div className="indicators">
                {c.indicators.map((i, n) => (
                  <span className="indicator" key={n}>{i}</span>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <div className="lbl">Raw content</div>
            <div className="content-box">{c.raw_content}</div>
            {String(c.author_ref).length === 16 && (
              <span className="synthetic-flag">author pseudonymized (SHA-256)</span>
            )}
          </div>

          <div className="field">
            <div className="kv">
              <div>
                <div className="lbl">Platform</div>
                <div className="val cap">{c.platform}</div>
              </div>
              <div>
                <div className="lbl">Source</div>
                <div className="val mono">{c.source}</div>
              </div>
              <div>
                <div className="lbl">Category</div>
                <div className="val"><CategoryChip category={c.risk_category} /></div>
              </div>
              <div>
                <div className="lbl">Confidence</div>
                <div className="val">{Math.round(c.confidence * 100)}%</div>
              </div>
              <div>
                <div className="lbl">Sentiment</div>
                <div className="val">{c.sentiment_polarity} ({c.sentiment_score})</div>
              </div>
              <div>
                <div className="lbl">Urgency</div>
                <div className="val">{c.mitigation_urgency}</div>
              </div>
              <div>
                <div className="lbl">RACM control</div>
                <div className="val mono">{c.racm_ref}</div>
              </div>
              <div>
                <div className="lbl">KRI</div>
                <div className="val mono">{c.kri_ref}</div>
              </div>
            </div>
          </div>

          <div className="field">
            <div className="lbl">Original post</div>
            <div className="val">
              {c.url ? (
                <>
                  <a className="open-post-btn" href={c.url} target="_blank" rel="noreferrer">
                    Open original post ↗
                  </a>
                  <div className="mono muted" style={{ marginTop: 6, wordBreak: "break-all" }}>{c.url}</div>
                </>
              ) : (
                <span className="muted">No public link available for this item.</span>
              )}
            </div>
          </div>

          <div className="field">
            <div className="lbl">Detected at</div>
            <div className="val">{fmtTime(c.created_at)}</div>
          </div>
        </div>
      </div>
    </>
  );
}
