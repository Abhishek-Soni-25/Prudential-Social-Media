import { describe, it, expect } from "vitest";
import { evaluate, DEFAULT_CONFIDENCE_FLOOR } from "./decisionEngine";
import type { RuleHit, Severity, RuleStatus, NotEvaluated } from "./types";

/** Build a hit with sensible defaults; override only what a test cares about. */
function hit(overrides: Partial<RuleHit> & { severity: Severity; status: RuleStatus }): RuleHit {
  return {
    ruleId: overrides.ruleId ?? `${overrides.severity}-${overrides.status}-${Math.random()}`,
    title: overrides.title ?? "Test rule",
    severity: overrides.severity,
    status: overrides.status,
    type: overrides.type ?? "prohibition",
    confidence: overrides.confidence ?? 0.95,
    region: overrides.region ?? null,
    basis: overrides.basis ?? "test basis",
    reviewerNote: overrides.reviewerNote ?? "test note",
    suggestedFix: overrides.suggestedFix ?? "test fix",
    detail: overrides.detail,
    belowFloor: overrides.belowFloor,
  };
}

describe("decisionEngine.evaluate", () => {
  // ---------------------------------------------------------------------------
  // THE most important test: an advisory High must never cause a REJECT.
  // Written first, deliberately.
  // ---------------------------------------------------------------------------
  describe("advisory hits never drive the outcome", () => {
    it("an ADVISORY High at full confidence does NOT cause a REJECT", () => {
      const v = evaluate([hit({ severity: "High", status: "advisory", confidence: 0.99 })], "complete");
      expect(v.outcome).not.toBe("REJECT");
      expect(v.outcome).toBe("APPROVE");
      expect(v.advisoryHits).toHaveLength(1);
      expect(v.activeHits).toHaveLength(0);
    });

    it("an ADVISORY High alongside no active hits still APPROVES", () => {
      const v = evaluate(
        [
          hit({ severity: "High", status: "advisory", confidence: 1.0 }),
          hit({ severity: "Medium", status: "advisory", confidence: 1.0 }),
        ],
        "complete",
      );
      expect(v.outcome).toBe("APPROVE");
      expect(v.advisoryHits).toHaveLength(2);
    });

    it("advisory hits are carried through for display but never counted", () => {
      const v = evaluate(
        [
          hit({ severity: "Low", status: "active", confidence: 0.9 }),
          hit({ severity: "High", status: "advisory", confidence: 0.99 }),
        ],
        "complete",
      );
      // One active Low -> approve with advisory. The advisory High is irrelevant to outcome.
      expect(v.outcome).toBe("APPROVE_WITH_ADVISORY");
      expect(v.advisoryHits).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // REJECT branch and the 0.85 boundary.
  // ---------------------------------------------------------------------------
  describe("High severity", () => {
    it("active High at confidence exactly 0.85 REJECTs (boundary is inclusive)", () => {
      const v = evaluate([hit({ severity: "High", status: "active", confidence: 0.85 })], "complete");
      expect(v.outcome).toBe("REJECT");
      expect(v.reasons.map((r) => r.code)).toContain("high_severity_breach");
    });

    it("active High just below 0.85 (0.8499) routes to MANUAL_REVIEW, not REJECT", () => {
      const v = evaluate([hit({ severity: "High", status: "active", confidence: 0.8499 })], "complete");
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("low_confidence");
      expect(v.requiresManualReview).toBe(true);
      // Kept for display, flagged below floor.
      expect(v.activeHits).toHaveLength(1);
      expect(v.activeHits[0].belowFloor).toBe(true);
    });

    it("High + Medium together -> REJECT wins (first match)", () => {
      const v = evaluate(
        [
          hit({ severity: "High", status: "active", confidence: 0.9 }),
          hit({ severity: "Medium", status: "active", confidence: 0.9 }),
        ],
        "complete",
      );
      expect(v.outcome).toBe("REJECT");
    });

    it("below-floor High takes precedence over an active Medium (low_confidence before medium)", () => {
      const v = evaluate(
        [
          hit({ severity: "High", status: "active", confidence: 0.8 }),
          hit({ severity: "Medium", status: "active", confidence: 0.9 }),
        ],
        "complete",
      );
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("low_confidence");
    });
  });

  // ---------------------------------------------------------------------------
  // Medium severity.
  // ---------------------------------------------------------------------------
  describe("Medium severity", () => {
    it("a single active Medium at/above floor -> MANUAL_REVIEW", () => {
      const v = evaluate([hit({ severity: "Medium", status: "active", confidence: 0.75 })], "complete");
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("medium_severity");
    });

    it("a Medium below its 0.75 floor -> MANUAL_REVIEW via low_confidence", () => {
      const v = evaluate([hit({ severity: "Medium", status: "active", confidence: 0.7 })], "complete");
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("low_confidence");
      expect(v.requiresManualReview).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Low tier counting — 1, 2, 3 boundaries. Counting applies to Low only.
  // ---------------------------------------------------------------------------
  describe("Low tier counting", () => {
    it("exactly 1 Low -> APPROVE_WITH_ADVISORY", () => {
      const v = evaluate([hit({ severity: "Low", status: "active", confidence: 0.9 })], "complete");
      expect(v.outcome).toBe("APPROVE_WITH_ADVISORY");
      expect(v.reasons.map((r) => r.code)).toContain("one_or_two_low");
    });

    it("exactly 2 Lows -> APPROVE_WITH_ADVISORY", () => {
      const v = evaluate(
        [
          hit({ ruleId: "L1", severity: "Low", status: "active", confidence: 0.9 }),
          hit({ ruleId: "L2", severity: "Low", status: "active", confidence: 0.9 }),
        ],
        "complete",
      );
      expect(v.outcome).toBe("APPROVE_WITH_ADVISORY");
    });

    it("exactly 3 Lows -> MANUAL_REVIEW (unreachable in today's config, still implemented)", () => {
      const v = evaluate(
        [
          hit({ ruleId: "L1", severity: "Low", status: "active", confidence: 0.9 }),
          hit({ ruleId: "L2", severity: "Low", status: "active", confidence: 0.9 }),
          hit({ ruleId: "L3", severity: "Low", status: "active", confidence: 0.9 }),
        ],
        "complete",
      );
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("three_or_more_low");
    });

    it("below-floor Lows do not count toward the >=3 threshold", () => {
      // Three Lows but all below the 0.75 floor -> none count; falls to low_confidence manual review.
      const v = evaluate(
        [
          hit({ ruleId: "L1", severity: "Low", status: "active", confidence: 0.5 }),
          hit({ ruleId: "L2", severity: "Low", status: "active", confidence: 0.5 }),
          hit({ ruleId: "L3", severity: "Low", status: "active", confidence: 0.5 }),
        ],
        "complete",
      );
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("low_confidence");
    });
  });

  // ---------------------------------------------------------------------------
  // Extraction status.
  // ---------------------------------------------------------------------------
  describe("extraction status", () => {
    it("extraction partial with ZERO hits -> MANUAL_REVIEW (never silently pass)", () => {
      const v = evaluate([], "partial");
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("extraction_incomplete");
    });

    it("extraction failed -> MANUAL_REVIEW even with no hits", () => {
      const v = evaluate([], "failed");
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("extraction_incomplete");
    });

    it("extraction incomplete beats a would-be REJECT (first match wins)", () => {
      const v = evaluate([hit({ severity: "High", status: "active", confidence: 0.99 })], "partial");
      expect(v.outcome).toBe("MANUAL_REVIEW");
      expect(v.reasons.map((r) => r.code)).toContain("extraction_incomplete");
    });
  });

  // ---------------------------------------------------------------------------
  // APPROVE and empty/disabled cases.
  // ---------------------------------------------------------------------------
  describe("APPROVE", () => {
    it("no hits, extraction complete -> APPROVE", () => {
      const v = evaluate([], "complete");
      expect(v.outcome).toBe("APPROVE");
      expect(v.reasons.map((r) => r.code)).toContain("no_active_hits");
    });

    it("all rules disabled (matcher produced no hits) -> APPROVE", () => {
      // When every rule is disabled the matcher returns [] — same as no hits.
      const v = evaluate([], "complete");
      expect(v.outcome).toBe("APPROVE");
    });

    it("only advisory/pending hits present -> APPROVE (they never drive outcome)", () => {
      const v = evaluate(
        [
          hit({ severity: "Medium", status: "advisory", confidence: 0.9 }),
          hit({ severity: "High", status: "advisory", confidence: 0.9 }),
        ],
        "complete",
      );
      expect(v.outcome).toBe("APPROVE");
    });
  });

  // ---------------------------------------------------------------------------
  // Pass-through of display data: notEvaluated, ruleSetVersion, advisory via options.
  // ---------------------------------------------------------------------------
  describe("pass-through display data", () => {
    it("a rule with an unmet dependency is carried in notEvaluated and does not affect outcome", () => {
      const notEvaluated: NotEvaluated[] = [
        {
          ruleId: "A-01",
          title: "Risk warning present where a product is named",
          reason: "awaiting approved phrase list",
          dependency: "FSG-03 Safeguard 2. Needs approved risk-warning phrase list",
        },
      ];
      const v = evaluate([], "complete", { notEvaluated, ruleSetVersion: "1.0.0" });
      expect(v.outcome).toBe("APPROVE");
      expect(v.notEvaluated).toEqual(notEvaluated);
    });

    it("stamps the rule-set version onto the verdict", () => {
      const v = evaluate([], "complete", { ruleSetVersion: "1.2.3" });
      expect(v.ruleSetVersion).toBe("1.2.3");
    });

    it("advisory hits passed via options are merged and de-duplicated with in-band advisory hits", () => {
      const advHit = hit({ ruleId: "D-07", severity: "Medium", status: "advisory", confidence: 0.9 });
      const v = evaluate([advHit], "complete", { advisoryHits: [advHit] });
      expect(v.advisoryHits).toHaveLength(1);
    });

    it("defaults ruleSetVersion to 'unknown' when not provided", () => {
      const v = evaluate([], "complete");
      expect(v.ruleSetVersion).toBe("unknown");
    });
  });

  // ---------------------------------------------------------------------------
  // Purity: same input -> same output, and input is not mutated.
  // ---------------------------------------------------------------------------
  describe("purity", () => {
    it("does not mutate the input hits array or its elements", () => {
      const input = [hit({ severity: "High", status: "active", confidence: 0.8 })];
      const snapshot = JSON.stringify(input);
      evaluate(input, "complete");
      expect(JSON.stringify(input)).toBe(snapshot);
    });

    it("is deterministic: identical inputs yield identical verdicts", () => {
      const hits = [
        hit({ ruleId: "H", severity: "High", status: "active", confidence: 0.9 }),
        hit({ ruleId: "A", severity: "Medium", status: "advisory", confidence: 0.9 }),
      ];
      const a = evaluate(hits, "complete", { ruleSetVersion: "1.0.0" });
      const b = evaluate(hits, "complete", { ruleSetVersion: "1.0.0" });
      expect(a).toEqual(b);
    });

    it("uses the provided confidence floor rather than the default", () => {
      // With a custom High floor of 0.5, a 0.6 High now REJECTs where it would
      // otherwise (default 0.85) route to manual review.
      const strict = evaluate([hit({ severity: "High", status: "active", confidence: 0.6 })], "complete", {
        confidenceFloor: { High: 0.5, Medium: 0.5, Low: 0.5 },
      });
      expect(strict.outcome).toBe("REJECT");
      const dflt = evaluate([hit({ severity: "High", status: "active", confidence: 0.6 })], "complete", {
        confidenceFloor: DEFAULT_CONFIDENCE_FLOOR,
      });
      expect(dflt.outcome).toBe("MANUAL_REVIEW");
    });
  });
});
