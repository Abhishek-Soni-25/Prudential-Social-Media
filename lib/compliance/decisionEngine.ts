/**
 * Prudential Assurance Singapore — Media Compliance decision engine.
 *
 * Pure function. No I/O, no network, no DB, no clock. Everything it needs is
 * passed in; everything it produces is returned. This is what makes a screening
 * decision reproducible and defensible in a MAS inspection: given the same hits,
 * the same extraction status and the same rule-set version, it always returns
 * the same verdict.
 *
 * Order of operations (see README "Decision table"):
 *   1. Filter to status === 'active'. Advisory and pending_config hits never
 *      reach the outcome logic; they are carried through for display only.
 *   2. Drop any active hit whose confidence < confidenceFloor[severity]. It is
 *      not discarded silently: requiresManualReview is set, reason low_confidence
 *      is recorded, and the hit is kept for display.
 *   3. Apply the decision table, first match wins.
 *
 * Counting applies to the Low tier ONLY. Never count High or Medium.
 */

import type {
  ConfidenceFloor,
  NotEvaluated,
  Outcome,
  ReasonCode,
  RuleHit,
  Verdict,
  VerdictReason,
  ExtractionStatus,
} from "./types";

/**
 * Default confidence floor. The engine is config-driven — the app always passes
 * the floor from the active rule set. This default exists only so the pure
 * function is callable with two arguments in tests, matching the spec signature
 * evaluate(hits, extractionStatus).
 */
export const DEFAULT_CONFIDENCE_FLOOR: ConfidenceFloor = {
  High: 0.85,
  Medium: 0.75,
  Low: 0.75,
};

export interface EvaluateOptions {
  /** Per-severity confidence floor. Comes from the active rule set config. */
  confidenceFloor?: ConfidenceFloor;
  /** Advisory-status hits — displayed and logged, never drive the outcome. */
  advisoryHits?: RuleHit[];
  /** Rules skipped for an unmet dependency — carried through for display. */
  notEvaluated?: NotEvaluated[];
  /** The rule-set version applied, stamped onto the verdict for the register. */
  ruleSetVersion?: string;
}

const REASON_MESSAGES: Record<ReasonCode, string> = {
  extraction_incomplete:
    "Content extraction was incomplete — never approve on incomplete extraction.",
  high_severity_breach: "A High-severity rule was breached at or above its confidence floor.",
  low_confidence: "A hit fell below its severity confidence floor — a human confirms.",
  medium_severity: "A Medium-severity rule was breached.",
  three_or_more_low: "Three or more Low-severity defects — a training-gap signal.",
  one_or_two_low: "One or two Low-severity defects — permitted with an advisory.",
  no_active_hits: "No active rule was breached.",
};

function reason(code: ReasonCode): VerdictReason {
  return { code, message: REASON_MESSAGES[code] };
}

/**
 * Evaluate rule hits into a verdict.
 *
 * @param hits             All hits from the matcher. Each carries its own status;
 *                         only status === 'active' hits can affect the outcome.
 * @param extractionStatus 'complete' | 'partial' | 'failed'. Anything other than
 *                         'complete' routes to MANUAL_REVIEW before any rule runs.
 * @param options          Config-driven floor plus pass-through display data.
 */
export function evaluate(
  hits: RuleHit[],
  extractionStatus: ExtractionStatus,
  options: EvaluateOptions = {},
): Verdict {
  const floor = options.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const ruleSetVersion = options.ruleSetVersion ?? "unknown";

  // Advisory hits may be passed either mixed into `hits` or via options. Merge and
  // de-duplicate so the caller can do whichever is convenient.
  const advisoryFromHits = hits.filter((h) => h.status === "advisory");
  const advisoryHits = dedupeById([...(options.advisoryHits ?? []), ...advisoryFromHits]);
  const notEvaluated = options.notEvaluated ?? [];

  // 1. Only active hits reach the outcome logic.
  const activeHits = hits.filter((h) => h.status === "active");

  // 2. Split active hits at their severity confidence floor. Below-floor hits are
  //    kept for display (belowFloor flagged) but do not drive severity outcomes;
  //    their presence forces at least a manual review.
  const effective: RuleHit[] = [];
  const belowFloor: RuleHit[] = [];
  for (const hit of activeHits) {
    const threshold = floor[hit.severity];
    if (hit.confidence < threshold) {
      belowFloor.push({ ...hit, belowFloor: true });
    } else {
      effective.push({ ...hit, belowFloor: false });
    }
  }
  const requiresManualReview = belowFloor.length > 0;

  // Severity tallies over the effective (at-or-above-floor) set only.
  const highReject = effective.some((h) => h.severity === "High");
  const highBelowFloor = belowFloor.some((h) => h.severity === "High");
  const mediumPresent = effective.some((h) => h.severity === "Medium");
  const lowCount = effective.filter((h) => h.severity === "Low").length;

  // 3. Decision table — first match wins.
  let outcome: Outcome;
  const reasons: VerdictReason[] = [];

  if (extractionStatus !== "complete") {
    outcome = "MANUAL_REVIEW";
    reasons.push(reason("extraction_incomplete"));
  } else if (highReject) {
    // Effective High hits are, by definition, at or above the High floor (0.85).
    outcome = "REJECT";
    reasons.push(reason("high_severity_breach"));
  } else if (highBelowFloor) {
    // A High hit below its floor never auto-rejects — a human confirms.
    outcome = "MANUAL_REVIEW";
    reasons.push(reason("low_confidence"));
  } else if (mediumPresent) {
    outcome = "MANUAL_REVIEW";
    reasons.push(reason("medium_severity"));
  } else if (lowCount >= 3) {
    outcome = "MANUAL_REVIEW";
    reasons.push(reason("three_or_more_low"));
  } else if (requiresManualReview) {
    // Remaining below-floor hits (Medium/Low) still force a human review.
    outcome = "MANUAL_REVIEW";
    reasons.push(reason("low_confidence"));
  } else if (lowCount === 1 || lowCount === 2) {
    outcome = "APPROVE_WITH_ADVISORY";
    reasons.push(reason("one_or_two_low"));
  } else {
    outcome = "APPROVE";
    reasons.push(reason("no_active_hits"));
  }

  // activeHits in the verdict = every active-status hit (effective + below-floor),
  // so the reviewer sees the full picture of what drove — or nearly drove — the outcome.
  const verdictActiveHits = [...effective, ...belowFloor];

  return {
    outcome,
    activeHits: verdictActiveHits,
    advisoryHits,
    notEvaluated,
    reasons,
    requiresManualReview,
    ruleSetVersion,
  };
}

function dedupeById(hits: RuleHit[]): RuleHit[] {
  const seen = new Set<string>();
  const out: RuleHit[] = [];
  for (const h of hits) {
    if (seen.has(h.ruleId)) continue;
    seen.add(h.ruleId);
    out.push(h);
  }
  return out;
}
