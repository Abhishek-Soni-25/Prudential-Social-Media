/**
 * Prudential Assurance Singapore — image extractor.
 *
 * Extraction contract: take a single still creative (as a data URL) plus its
 * caption, send it to the backend OCR/vision endpoint, and return the normalised
 * ExtractedAsset the decision engine consumes.
 *
 * extractionStatus semantics: the backend decides complete/partial/failed and we
 * trust it (see _shared). On any transport failure we return a 'failed' asset so
 * the engine routes to MANUAL_REVIEW — we never throw past the caller silently.
 */

import type { ExtractedAsset } from "../types";
import { failedAsset, toExtractedAsset, type BackendExtraction } from "./_shared";

export interface ImageExtractInput {
  dataUrl: string;
  captionText?: string;
  adviserId: string;
  channel: string;
  metadata?: Record<string, unknown>;
}

export async function extractImage(input: ImageExtractInput): Promise<ExtractedAsset> {
  const ctx = {
    adviserId: input.adviserId,
    channel: input.channel,
    captionText: input.captionText,
    metadata: input.metadata,
  };

  try {
    const res = await fetch("/api/compliance/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: [input.dataUrl],
        captionText: input.captionText ?? "",
        adviserId: input.adviserId,
        channel: input.channel,
        metadata: input.metadata ?? {},
      }),
    });

    if (!res.ok) {
      // Surface the backend's own reason where available; else the HTTP status.
      const detail = await res
        .json()
        .then((b: { detail?: string }) => b.detail)
        .catch(() => undefined);
      return failedAsset(ctx, detail || `extract failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as BackendExtraction;
    return toExtractedAsset(data, ctx);
  } catch (e) {
    return failedAsset(ctx, e instanceof Error ? e.message : "image extraction failed");
  }
}
