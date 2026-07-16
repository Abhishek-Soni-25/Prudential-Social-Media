/**
 * Screening orchestrator — the one call the UI makes to go from a normalised
 * asset to a verdict, using the rule set that is live right now.
 *
 * Pipeline:  ExtractedAsset --matchRules--> hits + notEvaluated
 *                            --evaluate---->  Verdict (outcome + citations)
 *
 * The rule set is loaded from the backend overlay (an admin edit) when present,
 * else the bundled default. Every verdict is stamped with the version applied so
 * a historical decision can be replayed against the rules that were live at the
 * time — a MAS inspector asking in November why a post passed in March needs
 * March's rule set, not today's.
 */

import type { RuleStatus, RuleType, Severity, ExtractedAsset, RuleSet, Verdict } from "./types";
import { DEFAULT_RULE_SET, bumpVersion, evaluableRules } from "./rules";
import { matchRules } from "./ruleMatcher";
import { evaluate } from "./decisionEngine";

/** One evaluated rule, shown in the results as a simple pass / flag check. */
export interface Check {
  ruleId: string;
  title: string;
  severity: Severity;
  status: RuleStatus;
  type: RuleType;
  passed: boolean;
  /** Short one-line reason, only when flagged. */
  detail?: string;
}

export interface ScreeningResult {
  verdict: Verdict;
  checks: Check[];
}

/** Run the full screen for one asset against a rule set. Deterministic. */
export function screen(asset: ExtractedAsset, ruleSet: RuleSet): Verdict {
  return runScreening(asset, ruleSet).verdict;
}

/**
 * Full screen plus the per-rule pass/flag checklist the results UI shows. Every
 * rule that was actually evaluated appears as a Check — passed when it produced
 * no hit, flagged (with a short reason) when it did.
 */
export function runScreening(asset: ExtractedAsset, ruleSet: RuleSet): ScreeningResult {
  const { hits, notEvaluated } = matchRules(asset, ruleSet);
  const verdict = evaluate(hits, asset.extractionStatus, {
    confidenceFloor: ruleSet.confidenceFloor,
    notEvaluated,
    ruleSetVersion: ruleSet.version,
  });

  const hitById = new Map(hits.map((h) => [h.ruleId, h]));
  const checks: Check[] = evaluableRules(ruleSet).map((r) => {
    const hit = hitById.get(r.id);
    return {
      ruleId: r.id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      type: r.type,
      passed: !hit,
      detail: hit?.detail,
    };
  });

  return { verdict, checks };
}

/** Load the live rule set: backend overlay if available, else the bundled default. */
export async function loadActiveRuleSet(): Promise<RuleSet> {
  try {
    const res = await fetch("/api/compliance/ruleset");
    if (res.ok) {
      const data = (await res.json()) as RuleSet;
      if (data && Array.isArray(data.rules) && data.rules.length > 0) return data;
    }
  } catch {
    /* fall through to bundled default */
  }
  return DEFAULT_RULE_SET;
}

/**
 * Persist an edited rule set. Bumps the version (every change bumps at least the
 * patch) and records the actor so the change lands in the audit log. Returns the
 * saved rule set (with the new version) so the UI can reflect it immediately.
 */
export async function saveActiveRuleSet(
  ruleSet: RuleSet,
  actor: string,
  level: "major" | "minor" | "patch" = "patch",
): Promise<RuleSet> {
  const next: RuleSet = { ...ruleSet, version: bumpVersion(ruleSet.version, level) };
  const body = { ...next, _actor: actor };
  const res = await fetch("/api/compliance/ruleset", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Backend unavailable: keep the bumped version locally so the session stays consistent.
    try {
      localStorage.setItem("prudential_compliance_ruleset", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return next;
  }
  return (await res.json()) as RuleSet;
}
