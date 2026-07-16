/**
 * Prudential Assurance Singapore — extraction contract & shared mapping.
 *
 * The three extractors (image / video / videoLink) all hit different backend
 * endpoints but must all hand the decision engine the SAME normalised shape:
 * `ExtractedAsset`. This module owns the single source of truth for that
 * mapping so the extractors stay DRY and can never drift apart.
 *
 * extractionStatus semantics (mirrors decisionEngine):
 *   complete -> extraction is trustworthy; the engine evaluates the rules.
 *   partial  -> some modality was missed (e.g. undersampled frames, no audio).
 *   failed   -> nothing usable was extracted (network/500, private link, etc).
 * The decision engine treats ANY non-'complete' status as MANUAL_REVIEW, so an
 * extractor must NEVER report 'complete' when it is not sure — and must NEVER
 * throw past the caller silently. On any error we return a well-formed asset
 * with extractionStatus 'failed' (carrying a `detail` in metadata) so the pipe
 * degrades to human review instead of blowing up.
 */

import type { ExtractedAsset, ExtractionStatus, TextRegion } from "../types";

/**
 * Loose shape of the JSON the backend `/compliance/extract*` endpoints return.
 * Everything is optional because a partial/failed backend response, or a body
 * we couldn't fully parse, must still map cleanly onto defaults.
 */
export interface BackendExtraction {
  assetId?: string;
  adviserId?: string;
  channel?: string;
  imageText?: Array<{
    text?: string;
    frame?: number;
    bbox?: [number, number, number, number];
    confidence?: number;
    timestampSec?: number;
  }>;
  transcript?: string;
  captionText?: string;
  frames?: string[];
  extractionStatus?: string;
  metadata?: Record<string, unknown>;
  signals?: Record<string, boolean>;
  /** Some error paths return a human-readable reason rather than the shape. */
  detail?: string;
}

/** Fields the caller supplies up-front; used as fallbacks when the backend echoes nothing. */
export interface AssetContext {
  adviserId: string;
  channel: string;
  captionText?: string;
  metadata?: Record<string, unknown>;
}

const VALID_STATUS: ReadonlySet<string> = new Set<ExtractionStatus>([
  "complete",
  "partial",
  "failed",
]);

/** Only accept a status the engine understands; anything else is untrustworthy -> 'failed'. */
function coerceStatus(raw: string | undefined): ExtractionStatus {
  return raw && VALID_STATUS.has(raw) ? (raw as ExtractionStatus) : "failed";
}

/** Drop empty OCR lines and coerce each into a fully-typed TextRegion. */
function toTextRegions(raw: BackendExtraction["imageText"]): TextRegion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is NonNullable<typeof r> => !!r && typeof r.text === "string" && r.text.length > 0)
    .map((r) => {
      const region: TextRegion = { text: r.text as string };
      if (r.bbox) region.bbox = r.bbox;
      if (typeof r.confidence === "number") region.confidence = r.confidence;
      if (typeof r.frame === "number") region.frame = r.frame;
      if (typeof r.timestampSec === "number") region.timestampSec = r.timestampSec;
      return region;
    });
}

/**
 * Normalise a backend response into a fully-typed ExtractedAsset.
 *
 * We NEVER upgrade the backend's status: if it reported 'partial'/'failed' we
 * keep it (the backend knows what it missed). We only *downgrade* to 'failed'
 * when the status is missing/unrecognised. Caller-supplied captionText/metadata
 * win when the backend echoes nothing back, so submission context is preserved.
 */
export function toExtractedAsset(
  data: BackendExtraction,
  ctx: AssetContext,
  fallbackFrames: string[] = [],
): ExtractedAsset {
  const metadata: Record<string, unknown> = {
    ...(ctx.metadata ?? {}),
    ...(data.metadata ?? {}),
  };
  // Surface any backend error reason so the reviewer can see WHY it degraded.
  if (data.detail && metadata.detail === undefined) metadata.detail = data.detail;

  const asset: ExtractedAsset = {
    assetId: data.assetId || cryptoRandomId(),
    adviserId: data.adviserId || ctx.adviserId,
    channel: data.channel || ctx.channel,
    imageText: toTextRegions(data.imageText),
    transcript: typeof data.transcript === "string" ? data.transcript : "",
    // Prefer the backend's caption (it may have OCR'd/cleaned it), else the caller's.
    captionText:
      typeof data.captionText === "string" && data.captionText.length > 0
        ? data.captionText
        : ctx.captionText ?? "",
    frames: Array.isArray(data.frames) && data.frames.length > 0 ? data.frames : fallbackFrames,
    extractionStatus: coerceStatus(data.extractionStatus),
  };

  if (Object.keys(metadata).length > 0) asset.metadata = metadata;
  if (data.signals && Object.keys(data.signals).length > 0) asset.signals = data.signals;
  return asset;
}

/**
 * Build a 'failed' asset when the request never produced a usable body (network
 * error, 500, unparseable JSON). Guarantees the caller still gets a valid
 * ExtractedAsset that routes to MANUAL_REVIEW rather than a thrown exception.
 */
export function failedAsset(
  ctx: AssetContext,
  detail: string,
  fallbackFrames: string[] = [],
): ExtractedAsset {
  const metadata: Record<string, unknown> = { ...(ctx.metadata ?? {}), detail };
  return {
    assetId: cryptoRandomId(),
    adviserId: ctx.adviserId,
    channel: ctx.channel,
    imageText: [],
    transcript: "",
    captionText: ctx.captionText ?? "",
    frames: fallbackFrames,
    extractionStatus: "failed",
    metadata,
  };
}

/** Best-effort client id so a failed/echoless asset is still individually addressable. */
function cryptoRandomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
