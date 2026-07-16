/**
 * Shared types for the Prudential Assurance Singapore Media Compliance engine.
 *
 * The rule set is configuration (see config/rules/prudential-sg-v1.json). These
 * types describe the shape of that config, the normalised asset the extractors
 * produce, the hits the matcher produces, and the verdict the decision engine
 * produces. Nothing here is Prudential-specific business logic — the rules live
 * in the config, never in code.
 */

export type Severity = "High" | "Medium" | "Low";

/**
 * active         -> evaluated, feeds the decision engine, can block a post
 * advisory       -> evaluated, surfaced in the UI and audit log, NEVER feeds the decision engine
 * pending_config -> not evaluated at all; listed in admin with its dependency string
 */
export type RuleStatus = "active" | "advisory" | "pending_config";

/** prohibition: presence of the condition is a hit. requirement: absence is a hit. */
export type RuleType = "prohibition" | "requirement";

/** Canonical detection templates a compliance officer can configure without a code change. */
export type DetectionTemplate =
  | "lexicon"
  | "entity"
  | "regex"
  | "phrase_absence"
  | "metadata"
  | "vision";

export interface Detection {
  modalities: string[];
  /** Verbatim "What the engine looks for" text from the rule set document. */
  signal: string;
  template: DetectionTemplate;
  params?: Record<string, unknown>;
  /** Named phrase list this rule tests against, for phrase_absence rules. */
  phraseList?: PhraseListName;
}

export interface Rule {
  id: string;
  type: RuleType;
  title: string;
  description: string;
  severity: Severity;
  status: RuleStatus;
  /** Required when status is pending_config; null otherwise (except A-01..A-03 phrase-list rules). */
  dependency: string | null;
  detection: Detection;
  basis: string;
  reviewerNote: string;
  suggestedFix: string;
  enabled: boolean;
}

export type PhraseListName = "riskWarning" | "licensingStatement" | "pastPerformanceCaveat";

export type ConfidenceFloor = Record<Severity, number>;

export interface RuleSet {
  ruleSetId: string;
  version: string;
  effectiveFrom: string;
  confidenceFloor: ConfidenceFloor;
  phraseLists: Record<PhraseListName, string[]>;
  rules: Rule[];
}

export type ExtractionStatus = "complete" | "partial" | "failed";

/** A located piece of evidence: a frame region, or an audio/transcript timestamp. */
export interface EvidenceRegion {
  kind: "image" | "video_frame" | "transcript" | "caption" | "metadata";
  /** Frame index for video, undefined for a single image. */
  frame?: number;
  /** Normalised [x, y, w, h] in 0..1, when a bounding box is available. */
  bbox?: [number, number, number, number];
  /** Seconds into the video/audio for a transcript hit. */
  timestampSec?: number;
  /** A cropped thumbnail data URL of the region, or the source frame. */
  thumbnail?: string | null;
  /** The extracted text that matched. */
  snippet?: string;
}

/** One line of OCR text with an optional bounding box and confidence. */
export interface TextRegion {
  text: string;
  bbox?: [number, number, number, number];
  confidence?: number;
  frame?: number;
  timestampSec?: number;
}

/** The normalised object the extractors hand to the rule engine. */
export interface ExtractedAsset {
  assetId: string;
  adviserId: string;
  channel: string;
  imageText: TextRegion[];
  transcript: string;
  captionText: string;
  frames: string[];
  extractionStatus: ExtractionStatus;
  /** Submission metadata used by A-04 (date/version completeness). */
  metadata?: Record<string, unknown>;
  /**
   * Optional externally-supplied detection signals for vision-template rules the
   * browser cannot compute (e.g. messaging-UI detected, face present). A real
   * vision service populates these; absent means the signal did not fire.
   */
  signals?: Record<string, boolean>;
}

export interface RuleHit {
  ruleId: string;
  title: string;
  severity: Severity;
  status: RuleStatus;
  type: RuleType;
  confidence: number;
  region: EvidenceRegion | null;
  basis: string;
  reviewerNote: string;
  suggestedFix: string;
  /** Human-readable note about what matched. */
  detail?: string;
  /** Set by the decision engine when the hit fell below its severity confidence floor. */
  belowFloor?: boolean;
}

export interface NotEvaluated {
  ruleId: string;
  title: string;
  reason: string;
  dependency: string | null;
}

export type Outcome = "REJECT" | "MANUAL_REVIEW" | "APPROVE_WITH_ADVISORY" | "APPROVE";

/** Machine-readable reason codes attached to a verdict. */
export type ReasonCode =
  | "extraction_incomplete"
  | "high_severity_breach"
  | "low_confidence"
  | "medium_severity"
  | "three_or_more_low"
  | "one_or_two_low"
  | "no_active_hits";

export interface VerdictReason {
  code: ReasonCode;
  message: string;
}

export interface Verdict {
  outcome: Outcome;
  /** Active-status hits — these drove the outcome. */
  activeHits: RuleHit[];
  /** Advisory-status hits — shown and logged, drove nothing. */
  advisoryHits: RuleHit[];
  /** Rules skipped because a dependency was unmet. */
  notEvaluated: NotEvaluated[];
  reasons: VerdictReason[];
  /** True when at least one active hit fell below its confidence floor. */
  requiresManualReview: boolean;
  ruleSetVersion: string;
}
