/**
 * Prudential Assurance Singapore — video-link extractor.
 *
 * Extraction contract: hand a URL (YouTube, hosted MP4, …) to the backend, which
 * fetches, transcribes and OCRs it server-side, and return the normalised
 * ExtractedAsset. Nothing is downloaded client-side.
 *
 * extractionStatus semantics: a private / expired / paywalled / unfetchable link
 * comes back from the backend as extractionStatus 'failed' — we pass it straight
 * through (routes to MANUAL_REVIEW). We never silently swallow that: a transport
 * failure also yields a 'failed' asset carrying a `detail`.
 */

import type { ExtractedAsset } from "../types";
import { failedAsset, toExtractedAsset, type BackendExtraction } from "./_shared";

export interface VideoLinkExtractInput {
  url: string;
  adviserId: string;
  channel: string;
  metadata?: Record<string, unknown>;
}

export async function extractVideoLink(input: VideoLinkExtractInput): Promise<ExtractedAsset> {
  const ctx = {
    adviserId: input.adviserId,
    channel: input.channel,
    metadata: input.metadata,
  };

  try {
    const res = await fetch("/api/compliance/extract/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: input.url,
        adviserId: input.adviserId,
        channel: input.channel,
        metadata: input.metadata ?? {},
      }),
    });

    if (!res.ok) {
      const detail = await res
        .json()
        .then((b: { detail?: string }) => b.detail)
        .catch(() => undefined);
      return failedAsset(ctx, detail || `link extract failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as BackendExtraction;
    // Pass the backend's status through verbatim — a private link surfaces as 'failed'.
    return toExtractedAsset(data, ctx);
  } catch (e) {
    return failedAsset(ctx, e instanceof Error ? e.message : "video-link extraction failed");
  }
}
