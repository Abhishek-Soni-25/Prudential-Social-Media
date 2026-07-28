import { useEffect, useRef, useState } from "react";
import type { ExtractedAsset, Outcome, RuleSet } from "@compliance/types";
import { loadActiveRuleSet, runScreening, type Check } from "@compliance/screening";
import { extractImage, extractVideo } from "@compliance/extractors";
import { buildAuditRecord, appendAudit } from "@compliance/auditLog";

type Mode = "content" | "image" | "video";

const fileToDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });

const OUTCOME_LABEL: Record<Outcome, string> = {
  REJECT: "Rejected",
  MANUAL_REVIEW: "Manual review",
  APPROVE_WITH_ADVISORY: "Approved with advisory",
  APPROVE: "Approved",
};

const OUTCOME_CLASS: Record<Outcome, string> = {
  REJECT: "reject",
  MANUAL_REVIEW: "manual",
  APPROVE_WITH_ADVISORY: "advisory",
  APPROVE: "approve",
};

const nowIso = () => new Date().toISOString();

export function MediaCompliance() {
  const [mode, setMode] = useState<Mode>("content");
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState("");
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);
  const [asset, setAsset] = useState<ExtractedAsset | null>(null);
  const [result, setResult] = useState<ReturnType<typeof runScreening> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadActiveRuleSet().then(setRuleSet).catch(() => setRuleSet(null));
  }, []);

  const reset = () => {
    setResult(null);
    setAsset(null);
    setErr(null);
  };

  const pick = async (f: File | null) => {
    reset();
    setFile(f);
    setImgPreview(null);
    setVideoUrl(null);
    if (!f) return;
    if (f.type.startsWith("image/")) setImgPreview(await fileToDataUrl(f));
    else setVideoUrl(URL.createObjectURL(f));
  };

  const run = async () => {
    reset();
    setBusy(true);
    try {
      const rs = ruleSet ?? (await loadActiveRuleSet());
      if (!ruleSet) setRuleSet(rs);

      const submittedAt = nowIso();
      // Adviser/channel are captured elsewhere in the register workflow; screening
      // itself only needs the creative.
      const ctx = { adviserId: "unattributed", channel: "n/a", metadata: { date: submittedAt, version: rs.version } };

      let extracted: ExtractedAsset;
      if (mode === "content") {
        if (!content.trim()) throw new Error("Type or paste some content first.");
        extracted = {
          assetId: `content-${submittedAt}`,
          adviserId: ctx.adviserId,
          channel: ctx.channel,
          imageText: [],
          transcript: "",
          captionText: content.trim(),
          frames: [],
          extractionStatus: "complete",
          metadata: ctx.metadata,
        };
      } else if (mode === "image") {
        if (!file) throw new Error("Attach an image first.");
        extracted = await extractImage({ dataUrl: await fileToDataUrl(file), ...ctx });
      } else {
        if (!file) throw new Error("Attach a video first.");
        extracted = await extractVideo({ file, ...ctx });
      }

      const screened = runScreening(extracted, rs);
      const rec = buildAuditRecord({ asset: extracted, verdict: screened.verdict, submittedAt });
      void appendAudit(rec);

      setAsset(extracted);
      setResult(screened);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Screening failed.");
    } finally {
      setBusy(false);
    }
  };

  const canRun = mode === "content" ? !!content.trim() : !!file;

  return (
    <div className="mc">
      <div className="panel mc-uploader">
        <div className="panel-body">
          <div className="mc-tabs">
            {(["content", "image", "video"] as Mode[]).map((m) => (
              <button
                key={m}
                className={`mc-tab ${mode === m ? "on" : ""}`}
                onClick={() => {
                  setMode(m);
                  setFile(null);
                  setImgPreview(null);
                  setVideoUrl(null);
                  setContent("");
                  reset();
                }}
              >
                {m === "content" ? "📝 Content" : m === "image" ? "🖼 Image" : "🎬 Video"}
              </button>
            ))}
          </div>

          {mode === "content" ? (
            <textarea
              className="mc-content-input"
              placeholder="Type or paste the post copy / caption to screen against the rules…"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                reset();
              }}
            />
          ) : (
            <div
              className="mc-drop"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pick(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <div className="mc-drop-icon">{mode === "video" ? "🎬" : "🖼"}</div>
              <div className="mc-drop-main">Drop your {mode} here or click to browse</div>
              <div className="mc-drop-sub">{mode === "image" ? "Supported: PNG, JPG, WEBP" : "Supported: MP4, WEBM, MOV"}</div>
              {file && (
                <div className="mc-drop-file" title={file.name}>
                  ✓ {file.name}
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={mode === "video" ? "video/*" : "image/*"}
                style={{ display: "none" }}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          <button className="btn mc-check" disabled={!canRun || busy} onClick={run}>
            {busy ? (
              <>
                <span className="spinner" /> {mode === "video" ? "Extracting & screening…" : "Screening…"}
              </>
            ) : (
              "Check Compliance"
            )}
          </button>
          {err && (
            <div className="banner banner-error" style={{ marginTop: 12 }}>
              ⚠ {err}
            </div>
          )}
        </div>
      </div>

      {result && asset && (
        <div className="mc-grid">
          <div className="panel mc-creative">
            <div className="panel-head">
              <h3>Creative</h3>
            </div>
            <div className="panel-body">
              {mode === "content" && <div className="mc-content-preview">{asset.captionText || "—"}</div>}
              {mode === "image" && imgPreview && <img src={imgPreview} alt="creative" className="mc-media" />}
              {mode === "video" && videoUrl && <video src={videoUrl} controls className="mc-media" />}
            </div>
          </div>

          <div className="panel mc-verdictpanel">
            <div className="panel-body mc-verdictbody">
              <ResultsView result={result} asset={asset} />
            </div>
          </div>
        </div>
      )}

      <div className="mc-foot">
        Automated screening against MAS FSG-03 and Prudential advertising policy. Rule set{" "}
        <strong>{ruleSet ? `v${ruleSet.version}` : "…"}</strong>. Final sign-off rests with the compliance officer.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple results view: status + reason, then a pass/flag checklist.
// ---------------------------------------------------------------------------

function ResultsView({ result, asset }: { result: ReturnType<typeof runScreening>; asset: ExtractedAsset }) {
  const { verdict, checks } = result;
  const reason = verdict.reasons[0]?.message ?? "";

  const flagged = checks.filter((c) => !c.passed);
  const passed = checks.filter((c) => c.passed);
  const extractionOk = asset.extractionStatus === "complete";

  return (
    <div>
      <div className={`mc-banner mc-banner-${OUTCOME_CLASS[verdict.outcome]}`}>
        <div className="mc-banner-outcome">{OUTCOME_LABEL[verdict.outcome]}</div>
        <div className="mc-banner-reason">{reason}</div>
      </div>

      {!extractionOk ? (
        <div className="mc-empty">
          The creative could not be fully read ({asset.extractionStatus}) — checks were not run. A compliance officer
          must review.
        </div>
      ) : (
        <>
          {/* Summary line: how many checks passed / flagged. */}
          <div className="mc-summaryline">
            <span className="mc-summary-pass">✓ {passed.length} passed</span>
            {flagged.length > 0 && <span className="mc-summary-flag">✗ {flagged.length} flagged</span>}
          </div>

          {/* Flagged checks first, then passed — a simple checklist. */}
          <div className="mc-checklist">
            {flagged.map((c) => (
              <CheckRow key={c.ruleId} check={c} />
            ))}
            {passed.map((c) => (
              <CheckRow key={c.ruleId} check={c} />
            ))}
          </div>

          {verdict.notEvaluated.length > 0 && (
            <div className="mc-noteval-line">
              {verdict.notEvaluated.length} rules not evaluated — awaiting configuration.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: Check }) {
  const flagged = !check.passed;
  const advisory = check.status === "advisory";
  return (
    <div className={`mc-checkrow ${flagged ? "flag" : "pass"}`}>
      <span className="mc-checkicon">{flagged ? "✗" : "✓"}</span>
      <span className="mc-checkid">{check.ruleId}</span>
      <span className="mc-checktitle">{check.title}</span>
      {flagged && !advisory && <span className={`mc-chip mc-chip-sev sev-${check.severity}`}>{check.severity}</span>}
      {flagged && advisory && <span className="mc-tag-advisory">advisory · didn’t block</span>}
      {flagged && check.detail && <span className="mc-checkdetail">{check.detail}</span>}
    </div>
  );
}
