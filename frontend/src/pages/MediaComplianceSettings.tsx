import { useEffect, useMemo, useState } from "react";
import type { Rule, RuleSet, Severity } from "@compliance/types";
import { loadActiveRuleSet, saveActiveRuleSet } from "@compliance/screening";

const SEVERITIES: Severity[] = ["High", "Medium", "Low"];

/**
 * Media Compliance → Settings. Lists every Do (requirement) and Don't (prohibition)
 * and lets a compliance officer add a new one by typing a word/phrase. New rules are
 * persisted to the live rule set (overlay) and are applied to every subsequent
 * content / image / video screening — no deploy.
 */
export function MediaComplianceSettings() {
  const [rs, setRs] = useState<RuleSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add-rule form
  const [kind, setKind] = useState<"dont" | "do">("dont");
  const [phrase, setPhrase] = useState("");
  const [severity, setSeverity] = useState<Severity>("High");

  useEffect(() => {
    loadActiveRuleSet().then(setRs);
  }, []);

  const donts = useMemo(() => (rs?.rules ?? []).filter((r) => r.type === "prohibition"), [rs]);
  const dos = useMemo(() => (rs?.rules ?? []).filter((r) => r.type === "requirement"), [rs]);

  const persist = async (nextRs: RuleSet, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveActiveRuleSet(nextRs, "compliance-officer");
      setRs(saved);
      setSavedMsg(msg.replace("{v}", saved.version));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const addRule = () => {
    if (!rs) return;
    const terms = phrase.split(",").map((s) => s.trim()).filter(Boolean);
    if (terms.length === 0) {
      setError("Enter a word or phrase to add.");
      return;
    }
    setError(null);
    const n = rs.rules.filter((r) => r.id.startsWith("X-")).length + 1;
    const id = `X-${String(n).padStart(2, "0")}`;
    const isDont = kind === "dont";
    const rule: Rule = {
      id,
      type: isDont ? "prohibition" : "requirement",
      title: isDont ? `Prohibited: "${terms[0]}"` : `Required: "${terms[0]}"`,
      description: isDont
        ? `Content must not contain: ${terms.join(", ")}`
        : `Content must contain one of: ${terms.join(", ")}`,
      severity,
      status: "active",
      dependency: null,
      detection: {
        modalities: ["content_text", "image_text", "video_frame_text", "transcript", "caption"],
        signal: `Custom ${isDont ? "don't" : "do"} — lexicon: ${terms.join(", ")}`,
        template: "lexicon",
        params: { terms },
      },
      basis: "Custom rule (Media Compliance Settings)",
      reviewerNote: isDont
        ? `Added in Settings: this wording is not permitted.`
        : `Added in Settings: this wording is required.`,
      suggestedFix: isDont ? `Remove "${terms[0]}" from the content.` : `Include the required wording.`,
      enabled: true,
    };
    setPhrase("");
    void persist(
      { ...rs, rules: [...rs.rules, rule] },
      `Added ${id} to the ${isDont ? "Don'ts" : "Do's"} — it now applies to every screening (v{v}).`,
    );
  };

  const removeRule = (id: string) => {
    if (!rs) return;
    void persist({ ...rs, rules: rs.rules.filter((r) => r.id !== id) }, `Removed ${id} (v{v}).`);
  };

  if (!rs) return <div className="muted">Loading rules…</div>;

  return (
    <div className="mcs">
      <div className="panel">
        <div className="panel-head">
          <h3>Add a Do or a Don't</h3>
          <span className="count">applies to content, images &amp; videos</span>
        </div>
        <div className="panel-body">
          <div className="mcs-add">
            <select value={kind} onChange={(e) => setKind(e.target.value as "dont" | "do")}>
              <option value="dont">Don't — must NOT appear</option>
              <option value="do">Do — must appear</option>
            </select>
            <input
              className="mcs-phrase"
              placeholder='Word or phrase, e.g. "financial advisor"  (comma-separate variants)'
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRule()}
            />
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="btn" onClick={addRule} disabled={busy}>{busy ? "Adding…" : "Add"}</button>
          </div>
          <div className="mcs-hint">
            A <strong>Don't</strong> flags/blocks when the phrase appears; a <strong>Do</strong> flags when it's missing.
            High-severity Don'ts reject the post. Adding saves instantly — it applies to the next screening.
          </div>
          {error && <div className="banner banner-error" style={{ marginTop: 12 }}>⚠ {error}</div>}
          {savedMsg && <div className="banner banner-info" style={{ marginTop: 12 }}>✓ {savedMsg}</div>}
        </div>
      </div>

      <div className="mcs-cols">
        <RuleColumn title="Don'ts (prohibitions)" rules={donts} onRemove={removeRule} tone="dont" />
        <RuleColumn title="Do's (required disclosures)" rules={dos} onRemove={removeRule} tone="do" />
      </div>

      <div className="mc-foot">
        Rule set <strong>{rs.ruleSetId} · v{rs.version}</strong>. Custom rules are marked X-##. Every save bumps the
        version and is recorded in the audit register.
      </div>
    </div>
  );
}

function RuleColumn({
  title,
  rules,
  onRemove,
  tone,
}: {
  title: string;
  rules: Rule[];
  onRemove: (id: string) => void;
  tone: "do" | "dont";
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="count">{rules.length}</span>
      </div>
      <div className="panel-body mcs-list">
        {rules.map((r) => {
          const custom = r.id.startsWith("X-");
          return (
            <div className={`mcs-rule ${tone}`} key={r.id}>
              <span className="mc-chip mc-chip-id">{r.id}</span>
              <span className="mcs-rule-title">{r.title}</span>
              <span className={`mc-chip mc-chip-sev sev-${r.severity}`}>{r.severity}</span>
              <span className={`mc-chip mc-chip-status status-${r.status}`}>{r.status}</span>
              {custom && (
                <button className="mcs-remove" title="Remove custom rule" onClick={() => onRemove(r.id)}>
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
