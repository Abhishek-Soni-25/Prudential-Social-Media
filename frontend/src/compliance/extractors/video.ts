/**
 * Prudential Assurance Singapore — video extractor.
 *
 * Extraction contract: sample frames CLIENT-SIDE (~1/sec, capped) so the backend
 * only OCRs what matters, upload the file so the backend can transcribe the audio
 * (Whisper), and return ONE normalised ExtractedAsset unioning frames + transcript
 * + caption. The backend performs the union; we just supply the parts.
 *
 * extractionStatus semantics: we NEVER upgrade the backend's verdict. If it
 * reports 'partial'/'failed' (e.g. it noticed we undersampled, or audio failed)
 * we keep it, which routes to MANUAL_REVIEW. Any transport failure -> 'failed'.
 */

import type { ExtractedAsset } from "../types";
import { failedAsset, toExtractedAsset, type BackendExtraction } from "./_shared";

export interface VideoExtractInput {
  file: File;
  captionText?: string;
  adviserId: string;
  channel: string;
  metadata?: Record<string, unknown>;
  frameCount?: number;
}

/** Hard ceiling on sampled frames — OCR cost is per-frame, so we cap even long clips. */
const MAX_FRAMES = 12;

/**
 * Sample ~1 frame per second across the clip (capped at MAX_FRAMES). Adapted from
 * MediaCompliance's captureVideoFrames, but the frame count derives from duration
 * instead of being fixed, so short clips aren't over-sampled and long ones aren't
 * under-sampled beyond the cost cap. Best-effort: returns whatever frames loaded.
 */
function captureVideoFrames(src: string, cap = MAX_FRAMES): Promise<string[]> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = src;
    const frames: string[] = [];
    let targets: number[] = [];
    let i = 0;
    const grab = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640;
        c.height = v.videoHeight || 360;
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        frames.push(c.toDataURL("image/jpeg", 0.82));
      } catch {
        /* tainted / not ready — skip this target */
      }
      i += 1;
      if (i < targets.length) v.currentTime = targets[i];
      else resolve(frames);
    };
    v.onloadeddata = () => {
      const d = v.duration && isFinite(v.duration) ? v.duration : 4;
      // ~1 frame/sec, at least 1, never more than the cost cap.
      const count = Math.max(1, Math.min(cap, Math.round(d)));
      targets = Array.from({ length: count }, (_, k) => Math.min(d - 0.1, (d * (k + 1)) / (count + 1)));
      v.onseeked = grab;
      v.currentTime = targets[0];
    };
    v.onerror = () => resolve(frames);
    // Safety valve: never hang the pipeline on a video that won't seek.
    setTimeout(() => resolve(frames), 20000);
  });
}

export async function extractVideo(input: VideoExtractInput): Promise<ExtractedAsset> {
  const ctx = {
    adviserId: input.adviserId,
    channel: input.channel,
    captionText: input.captionText,
    metadata: input.metadata,
  };

  // Sample client-side. If this yields 0 frames we still POST — the backend can
  // transcribe audio alone and will downgrade the status itself.
  let frames: string[] = [];
  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(input.file);
    frames = await captureVideoFrames(objectUrl, input.frameCount ?? MAX_FRAMES);
  } catch {
    frames = [];
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }

  try {
    const fd = new FormData();
    fd.append("file", input.file);
    fd.append("frames", JSON.stringify(frames));
    fd.append("captionText", input.captionText ?? "");
    fd.append("adviserId", input.adviserId);
    fd.append("channel", input.channel);
    fd.append("metadata", JSON.stringify(input.metadata ?? {}));

    const res = await fetch("/api/compliance/extract/video", { method: "POST", body: fd });

    if (!res.ok) {
      const detail = await res
        .json()
        .then((b: { detail?: string }) => b.detail)
        .catch(() => undefined);
      // Carry the frames we did sample so the reviewer still has evidence.
      return failedAsset(ctx, detail || `video extract failed: ${res.status} ${res.statusText}`, frames);
    }

    const data = (await res.json()) as BackendExtraction;
    // fallbackFrames = client frames, used only if the backend echoes none.
    return toExtractedAsset(data, ctx, frames);
  } catch (e) {
    return failedAsset(ctx, e instanceof Error ? e.message : "video extraction failed", frames);
  }
}
