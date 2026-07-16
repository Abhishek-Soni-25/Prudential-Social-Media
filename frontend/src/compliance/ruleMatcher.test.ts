import { describe, it, expect } from "vitest";
import { matchRules } from "./ruleMatcher";
import { DEFAULT_RULE_SET } from "./rules";
import type { ExtractedAsset, RuleSet } from "./types";

function asset(over: Partial<ExtractedAsset>): ExtractedAsset {
  return {
    assetId: "a1",
    adviserId: "adv1",
    channel: "instagram",
    imageText: [],
    transcript: "",
    captionText: "",
    frames: [],
    extractionStatus: "complete",
    metadata: { date: "2026-07-16", version: "1" },
    ...over,
  };
}

describe("ruleMatcher against the shipped rule set", () => {
  it("D-04: fires on a guaranteed-returns lexicon match (High/active)", () => {
    const { hits } = matchRules(asset({ captionText: "Our new plan offers guaranteed returns for life." }), DEFAULT_RULE_SET);
    const d04 = hits.find((h) => h.ruleId === "D-04");
    expect(d04).toBeTruthy();
    expect(d04!.severity).toBe("High");
    expect(d04!.status).toBe("active");
  });

  it("D-03: fires when a percentage sits alongside a return term", () => {
    const { hits } = matchRules(asset({ captionText: "Historically this fund delivered 8% p.a. growth." }), DEFAULT_RULE_SET);
    expect(hits.some((h) => h.ruleId === "D-03")).toBe(true);
  });

  it("D-03: does NOT fire on a percentage with no return context", () => {
    const { hits } = matchRules(asset({ captionText: "80% of Singaporeans want peace of mind." }), DEFAULT_RULE_SET);
    expect(hits.some((h) => h.ruleId === "D-03")).toBe(false);
  });

  it("D-01: fires when two or more policy field labels appear in one frame", () => {
    const { hits } = matchRules(
      asset({ imageText: [{ text: "Policy Number: 123  Sum Assured: $100,000  Surrender Value: $2,000", frame: 0 }], frames: ["data:img"] }),
      DEFAULT_RULE_SET,
    );
    expect(hits.some((h) => h.ruleId === "D-01")).toBe(true);
  });

  it("D-01: does NOT fire on a single field label", () => {
    const { hits } = matchRules(asset({ imageText: [{ text: "Plan Type: Whole Life", frame: 0 }], frames: ["x"] }), DEFAULT_RULE_SET);
    expect(hits.some((h) => h.ruleId === "D-01")).toBe(false);
  });

  it("D-02: fires on an NRIC in a product context", () => {
    const { hits } = matchRules(asset({ captionText: "Congrats to policyholder S1234567D on your PRUShield plan!" }), DEFAULT_RULE_SET);
    expect(hits.some((h) => h.ruleId === "D-02")).toBe(true);
  });

  it("A-01/A-02/A-03: are NOT evaluated while phrase lists are empty (day-one behaviour)", () => {
    const { hits, notEvaluated } = matchRules(asset({ captionText: "Check out our PRUWealth savings plan." }), DEFAULT_RULE_SET);
    for (const id of ["A-01", "A-02", "A-03"]) {
      expect(hits.some((h) => h.ruleId === id)).toBe(false);
      const ne = notEvaluated.find((n) => n.ruleId === id);
      expect(ne).toBeTruthy();
      expect(ne!.reason).toBe("awaiting approved phrase list");
    }
  });

  it("A-01: evaluates and fires once its phrase list is populated but the phrase is absent", () => {
    const populated: RuleSet = {
      ...DEFAULT_RULE_SET,
      phraseLists: { ...DEFAULT_RULE_SET.phraseLists, riskWarning: ["Buying a life insurance policy is a long-term commitment"] },
    };
    const { hits, notEvaluated } = matchRules(asset({ captionText: "Check out our PRUWealth savings plan." }), populated);
    expect(hits.some((h) => h.ruleId === "A-01")).toBe(true);
    expect(notEvaluated.some((n) => n.ruleId === "A-01")).toBe(false);
  });

  it("A-01: does NOT fire when the approved risk warning is present", () => {
    const populated: RuleSet = {
      ...DEFAULT_RULE_SET,
      phraseLists: { ...DEFAULT_RULE_SET.phraseLists, riskWarning: ["long-term commitment"] },
    };
    const { hits } = matchRules(asset({ captionText: "PRUWealth savings plan. Buying insurance is a long-term commitment." }), populated);
    expect(hits.some((h) => h.ruleId === "A-01")).toBe(false);
  });

  it("A-04: fires when register metadata (date/version) is missing", () => {
    const { hits } = matchRules(asset({ metadata: {} }), DEFAULT_RULE_SET);
    const a04 = hits.find((h) => h.ruleId === "A-04");
    expect(a04).toBeTruthy();
    expect(a04!.severity).toBe("Low");
  });

  it("pending_config rules never produce hits and are all reported as not evaluated", () => {
    const { hits, notEvaluated } = matchRules(asset({ captionText: "join our agency, earn $10,000 a month #hashtag" }), DEFAULT_RULE_SET);
    const pending = ["D-09", "D-11", "D-12", "A-07", "A-08", "A-09", "A-10", "A-11", "A-12"];
    for (const id of pending) {
      expect(hits.some((h) => h.ruleId === id)).toBe(false);
      expect(notEvaluated.some((n) => n.ruleId === id && n.reason === "pending configuration")).toBe(true);
    }
  });

  it("a clean asset produces no hits", () => {
    const { hits } = matchRules(asset({ captionText: "Wishing everyone a happy National Day from our team." }), DEFAULT_RULE_SET);
    expect(hits).toHaveLength(0);
  });
});
