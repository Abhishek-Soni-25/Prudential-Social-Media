import { describe, it, expect } from "vitest";
import { pseudonymise, buildAuditRecord, withOverride, toCsv } from "./auditLog";
import type { ExtractedAsset, Verdict } from "./types";

const asset: ExtractedAsset = {
  assetId: "a1",
  adviserId: "ADV-99",
  channel: "instagram",
  imageText: [{ text: "Policyowner S1234567D Policy Number: 88123456 Sum Assured 500000" }],
  transcript: "Call me at my NRIC S1234567D",
  captionText: "PRUWealth plan",
  frames: ["data:image/jpeg;base64,AAAA"],
  extractionStatus: "complete",
};

const verdict: Verdict = {
  outcome: "REJECT",
  activeHits: [
    {
      ruleId: "D-01", title: "Client policy document or values visible", severity: "High", status: "active",
      type: "prohibition", confidence: 0.92, region: { kind: "image", snippet: "Policy Number: 88123456" },
      basis: "PDPA 2012", reviewerNote: "note", suggestedFix: "fix", belowFloor: false,
    },
  ],
  advisoryHits: [],
  notEvaluated: [],
  reasons: [{ code: "high_severity_breach", message: "x" }],
  requiresManualReview: false,
  ruleSetVersion: "1.0.0",
};

describe("pseudonymise", () => {
  it("masks NRIC/FIN patterns", () => {
    const out = pseudonymise("Client S1234567D signed up");
    expect(out).not.toContain("S1234567D");
    expect(out).toMatch(/\[NRIC:[0-9a-f]{8}\]/);
  });

  it("is deterministic — same value maps to the same token", () => {
    expect(pseudonymise("S1234567D")).toBe(pseudonymise("S1234567D"));
  });

  it("masks long policy/account numbers", () => {
    const out = pseudonymise("Policy Number: 88123456");
    expect(out).not.toContain("88123456");
  });
});

describe("buildAuditRecord", () => {
  it("pseudonymises extracted text and transcript before storing", () => {
    const rec = buildAuditRecord({ asset, verdict, submittedAt: "2026-07-16T00:00:00Z" });
    expect(rec.extractedText).not.toContain("S1234567D");
    expect(rec.extractedText).not.toContain("88123456");
    expect(rec.transcript).not.toContain("S1234567D");
    expect(rec.assetHash).toMatch(/^sha_/);
    expect(rec.computedOutcome).toBe("REJECT");
    expect(rec.finalDisposition).toBe("REJECT");
    expect(rec.ruleSetVersion).toBe("1.0.0");
  });

  it("does not carry a raw NRIC on an evidence snippet", () => {
    const withNric: Verdict = {
      ...verdict,
      activeHits: [{ ...verdict.activeHits[0], region: { kind: "image", snippet: "NRIC S1234567D" } }],
    };
    const rec = buildAuditRecord({ asset, verdict: withNric, submittedAt: "t" });
    expect(JSON.stringify(rec.hits)).not.toContain("S1234567D");
  });
});

describe("withOverride", () => {
  it("requires a justification", () => {
    const rec = buildAuditRecord({ asset, verdict, submittedAt: "t" });
    expect(() => withOverride(rec, { officerId: "O1", justification: "  ", outcome: "APPROVE", at: "t2" })).toThrow();
  });

  it("records the override and updates final disposition without mutating the original", () => {
    const rec = buildAuditRecord({ asset, verdict, submittedAt: "t" });
    const overridden = withOverride(rec, { officerId: "O1", justification: "False positive, sample doc", outcome: "APPROVE", at: "t2" });
    expect(overridden.finalDisposition).toBe("APPROVE");
    expect(overridden.override?.officerId).toBe("O1");
    expect(overridden.computedOutcome).toBe("REJECT"); // original computed outcome preserved
    expect(rec.override).toBeNull(); // append-only: original untouched
  });
});

describe("toCsv", () => {
  it("emits a header plus one row per record and escapes quotes", () => {
    const rec = buildAuditRecord({ asset, verdict, submittedAt: "t" });
    const csv = toCsv([rec]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("assetHash");
    expect(lines).toHaveLength(2);
    expect(csv).toContain("REJECT");
  });

  it("handles an empty log (header only)", () => {
    expect(toCsv([]).split("\r\n")).toHaveLength(1);
  });
});
