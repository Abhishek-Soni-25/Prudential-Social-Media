import { useEffect, useState } from "react";
import type { CaseFile } from "../types";
import type { RuleSet, ExtractedAsset } from "@compliance/types";
import { loadActiveRuleSet, runScreening } from "@compliance/screening";
import { api } from "../api";
import { CategoryChip, SeverityBadge, fmtTime } from "./ui";

/**
 * Screen the mention's text against the live MAS FSG-03 rule set and return whether it
 * is compliant plus, when it is not, the concrete reasons (which prohibited rules fired
 * and why). Only prohibition-type hits apply to a third party's social post — disclosure
 * / register requirements (risk-warning wording, metadata) don't.
 */
function screenCompliance(text: string, ruleSet: RuleSet): { compliant: boolean; reasons: string[] } {
  const asset: ExtractedAsset = {
    assetId: "m", adviserId: "", channel: "", imageText: [], transcript: "",
    captionText: text || "", frames: [], extractionStatus: "complete",
    metadata: { date: "n/a", version: "n/a" },
  };
  const hits = runScreening(asset, ruleSet).verdict.activeHits.filter((h) => h.type === "prohibition");
  const reasons = hits.map((h) => {
    const detail = h.detail ? ` — ${h.detail}` : "";
    return `${h.ruleId} · ${h.title}${detail}`;
  });
  return { compliant: hits.length === 0, reasons };
}

export function CaseDrawer({ c, onClose }: { c: CaseFile; onClose: () => void }) {
  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [notified, setNotified] = useState<string | null>(null);

  useEffect(() => {
    loadActiveRuleSet().then(setRuleSet).catch(() => setRuleSet(null));
  }, []);

  const screen = ruleSet ? screenCompliance(c.raw_content, ruleSet) : null;

  // Dummy notification action — records intent via the compliance notify endpoint and
  // shows a confirmation. No message is actually delivered to the author.
  const notifyAuthor = async () => {
    setNotifying(true);
    try {
      await api
        .complianceNotify({
          author: c.author_ref || "the author",
          status: "non_compliant",
          channel: c.platform,
          mentionId: c.case_id,
        })
        .catch(() => undefined);
      setNotified(`Notification queued for ${c.author_ref || "the author"} on ${c.platform}.`);
    } finally {
      setNotifying(false);
    }
  };

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

          {/* Media compliance: status + the concrete reason it is (non-)compliant. */}
          <div className="field">
            <div className="lbl">Media compliance</div>
            {screen === null ? (
              <div className="val muted">Screening against the rule set…</div>
            ) : screen.compliant ? (
              <>
                <span className="mc-status-chip compliant">Compliant</span>
                <div className="val" style={{ marginTop: 8 }}>
                  No prohibited advertising content detected under the active MAS FSG-03 rule set.
                </div>
              </>
            ) : (
              <>
                <span className="mc-status-chip noncompliant">Non-compliant</span>
                <div className="lbl" style={{ marginTop: 10 }}>Reason</div>
                <ul className="mc-reason-list">
                  {screen.reasons.map((r, n) => (
                    <li key={n}>{r}</li>
                  ))}
                </ul>
                <div className="val muted" style={{ marginTop: 4 }}>
                  Breaches MAS Guideline FSG-03 / Prudential advertising policy — the creative must
                  be amended or withdrawn before it can be published.
                </div>
              </>
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

        {/* Footer action — only meaningful when the post is non-compliant. */}
        {screen && !screen.compliant && (
          <div className="drawer-foot">
            {notified ? (
              <div className="mc-notify-done">🔔 {notified}</div>
            ) : (
              <button className="btn drawer-notify-btn" disabled={notifying} onClick={notifyAuthor}>
                {notifying ? (
                  <>
                    <span className="spinner" /> Sending…
                  </>
                ) : (
                  <>Send notification to author</>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
