import { useRef, useState } from "react";
import { api } from "../api";
import type { ComplianceResult } from "../types";

type Mode = "image" | "video" | "link";

const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f);
});

// Grab N frames sampled across a video (file object-URL). Best-effort; returns whatever loaded.
function captureVideoFrames(src: string, count = 4): Promise<string[]> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = src;
    const frames: string[] = [];
    let targets: number[] = []; let i = 0;
    const grab = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640; c.height = v.videoHeight || 360;
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        frames.push(c.toDataURL("image/jpeg", 0.82));
      } catch { /* tainted / not ready */ }
      i += 1;
      if (i < targets.length) v.currentTime = targets[i]; else resolve(frames);
    };
    v.onloadeddata = () => {
      const d = v.duration && isFinite(v.duration) ? v.duration : 4;
      targets = Array.from({ length: count }, (_, k) => Math.min(d - 0.1, (d * (k + 1)) / (count + 1)));
      v.onseeked = grab; v.currentTime = targets[0];
    };
    v.onerror = () => resolve(frames);
    setTimeout(() => resolve(frames), 20000);
  });
}

const STATUS_ORDER = { FAIL: 0, UNCLEAR: 1, PASS: 2 } as const;

export function MediaCompliance() {
  const [mode, setMode] = useState<Mode>("image");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [imgPreview, setImgPreview] = useState<string | null>(null);   // image data-URL
  const [videoUrl, setVideoUrl] = useState<string | null>(null);       // object URL for <video>
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setResult(null); setErr(null); };

  const pick = async (f: File | null) => {
    reset(); setFile(f); setImgPreview(null); setVideoUrl(null);
    if (!f) return;
    if (f.type.startsWith("image/")) setImgPreview(await fileToDataUrl(f));
    else setVideoUrl(URL.createObjectURL(f));
  };

  const run = async () => {
    reset(); setBusy(true);
    try {
      let r: ComplianceResult;
      if (mode === "link") {
        if (!link.trim()) throw new Error("Paste a video link first.");
        r = await api.complianceLink(link.trim());
      } else if (mode === "image") {
        if (!file) throw new Error("Attach an image first.");
        r = await api.complianceCheck({ images: [await fileToDataUrl(file)], note: "Image creative." });
      } else {
        if (!file) throw new Error("Attach a video first.");
        const frames = videoUrl ? await captureVideoFrames(videoUrl, 4) : [];
        r = await api.complianceVideo(file, frames);
      }
      setResult(r);
    } catch (e) { setErr(e instanceof Error ? e.message : "Compliance check failed."); }
    finally { setBusy(false); }
  };

  const canRun = mode === "link" ? !!link.trim() : !!file;
  const sorted = result ? [...result.checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) : [];
  const flagged = sorted.filter((c) => c.status !== "PASS");
  const passed = sorted.filter((c) => c.status === "PASS");

  return (
    <div className="mc">

      <div className="panel mc-uploader">
        <div className="panel-body">
          <div className="mc-tabs">
            {(["image", "video", "link"] as Mode[]).map((m) => (
              <button key={m} className={`mc-tab ${mode === m ? "on" : ""}`}
                onClick={() => { setMode(m); setFile(null); setImgPreview(null); setVideoUrl(null); reset(); }}>
                {m === "image" ? "🖼 Image" : m === "video" ? "🎬 Video" : "🔗 Video Link"}
              </button>
            ))}
          </div>

          {mode === "link" ? (
            <input className="mc-linkinput" placeholder="Paste a video URL (YouTube, MP4, …)" value={link}
              onChange={(e) => { setLink(e.target.value); reset(); }} />
          ) : (
            <div className="mc-drop" onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0] ?? null); }}>
              <div className="mc-drop-icon">{mode === "video" ? "🎬" : "🖼"}</div>
              <div className="mc-drop-main">Drop your {mode} here or click to browse</div>
              <div className="mc-drop-sub">{mode === "image" ? "Supported: PNG, JPG, WEBP" : "Supported: MP4, WEBM, MOV"}</div>
              {file && <div className="mc-drop-file" title={file.name}>✓ {file.name}</div>}
              <input ref={inputRef} type="file" accept={mode === "video" ? "video/*" : "image/*"} style={{ display: "none" }}
                onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            </div>
          )}

          <button className="btn mc-check" disabled={!canRun || busy} onClick={run}>
            {busy ? <><span className="spinner" /> {mode === "image" ? "Checking…" : "Analyzing media…"}</> : "Check Compliance"}
          </button>
          {err && <div className="banner banner-error" style={{ marginTop: 12 }}>⚠ {err}</div>}
        </div>
      </div>

      {result && (
        <div className="mc-grid">
          <div className="panel mc-creative">
            <div className="panel-head"><h3>Creative</h3></div>
            <div className="panel-body">
              {mode === "image" && imgPreview && <img src={imgPreview} alt="creative" className="mc-media" />}
              {mode === "video" && videoUrl && <video src={videoUrl} controls className="mc-media" />}
              {mode === "link" && (result.frame
                ? <img src={result.frame} alt="thumbnail" className="mc-media" />
                : <div className="muted">Thumbnail unavailable — screened from transcript.</div>)}
            </div>
          </div>

          <div className="panel mc-verdictpanel">
            <div className="panel-head">
              <h3>Verdict</h3>
              <span className={`mc-verdict ${result.issues_found ? "bad" : "ok"}`}>
                {result.issues_found ? "ISSUES FOUND" : "REVIEW COMPLETE"}
              </span>
            </div>
            <div className="panel-body mc-verdictbody">
              <p className="mc-summary">{result.summary}</p>

              {flagged.map((c) => (
                <div className="mc-check-row" key={c.id}>
                  <div className={`mc-status ${c.status.toLowerCase()}`}>{c.status}</div>
                  <div className="mc-check-title">{c.title}</div>
                  {c.detail && <div className="mc-check-detail">{c.detail}</div>}
                </div>
              ))}

              {passed.length > 0 && (
                <details className="mc-passed" open>
                  <summary>✓ {passed.length} checks passed</summary>
                  {passed.map((c) => (
                    <div className="mc-pass-row" key={c.id}>
                      <span className="mc-status pass">PASS</span>
                      <span className="mc-check-title">{c.title}</span>
                    </div>
                  ))}
                </details>
              )}

              {(result.frames_used && result.frames_used > 0) || result.transcript ? (
                <div className="mc-note">
                  {result.frames_used && result.frames_used > 1 ? `Screened ${result.frames_used} frames sampled across the video` : ""}
                  {result.frames_used && result.frames_used > 1 && result.transcript ? " + voice-over transcript." : (result.transcript ? "Screened the thumbnail + caption transcript." : "")}
                </div>
              ) : null}

              {result.transcript && (
                <details className="mc-transcript" open>
                  <summary>Voice-over transcript</summary>
                  <div className="mc-transcript-text">{result.transcript}</div>
                </details>
              )}

              <div className="mc-foot">
                Automated screening against the SEBI advertisement code &amp; NSE / BSE / NSDL / CDSL
                norms. Final sign-off rests with the compliance officer.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
