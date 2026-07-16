/**
 * Prudential Assurance Singapore — extractor barrel.
 *
 * The three extractors turn a user-supplied creative (still image, uploaded
 * video, or video link) into the normalised ExtractedAsset the decision engine
 * consumes. They share one mapping helper (see _shared) so the ExtractedAsset
 * shape is produced in exactly one place. All three degrade to an
 * extractionStatus 'failed' asset on error rather than throwing — the engine
 * then routes to MANUAL_REVIEW.
 */

export { extractImage, type ImageExtractInput } from "./image";
export { extractVideo, type VideoExtractInput } from "./video";
export { extractVideoLink, type VideoLinkExtractInput } from "./videoLink";
