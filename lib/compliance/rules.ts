/**
 * Rule-set loader and dependency logic.
 *
 * The default rule set ships as config/rules/prudential-sg-v1.json. This module
 * loads it, answers "is this rule's dependency met?", and provides the version
 * bump used by the admin screen. It holds no detection logic (that is ruleMatcher)
 * and no outcome logic (that is decisionEngine).
 */

import defaultRuleSet from "../../config/rules/prudential-sg-v1.json";
import type { NotEvaluated, PhraseListName, Rule, RuleSet } from "./types";

/** The rule set as shipped. Treat as immutable; the admin screen layers edits on top. */
export const DEFAULT_RULE_SET = defaultRuleSet as RuleSet;

/**
 * A rule's dependency is "met" when the engine is allowed to evaluate it.
 *
 *  - phrase_absence rules (A-01/A-02/A-03) depend on a populated phrase list.
 *    An empty list means the accepted wording has not been supplied yet, so the
 *    rule is skipped regardless of its active status.
 *  - pending_config rules are never evaluated until Prudential enables them.
 *  - everything else is met.
 */
export function isDependencyMet(rule: Rule, ruleSet: RuleSet): boolean {
  if (rule.status === "pending_config") return false;
  const listName = rule.detection.phraseList;
  if (listName) {
    const list = ruleSet.phraseLists[listName] ?? [];
    return list.length > 0;
  }
  return true;
}

/**
 * Why a rule was not evaluated, for the verdict and the "Not evaluated" UI section.
 * Returns null when the rule IS evaluated.
 */
export function notEvaluatedReason(rule: Rule, ruleSet: RuleSet): NotEvaluated | null {
  if (!rule.enabled && rule.status !== "pending_config") {
    return { ruleId: rule.id, title: rule.title, reason: "rule disabled", dependency: rule.dependency };
  }
  if (rule.status === "pending_config") {
    return {
      ruleId: rule.id,
      title: rule.title,
      reason: "pending configuration",
      dependency: rule.dependency,
    };
  }
  const listName = rule.detection.phraseList;
  if (listName && (ruleSet.phraseLists[listName]?.length ?? 0) === 0) {
    return {
      ruleId: rule.id,
      title: rule.title,
      reason: "awaiting approved phrase list",
      dependency: rule.dependency,
    };
  }
  return null;
}

/** Rules the matcher will actually evaluate against an asset. */
export function evaluableRules(ruleSet: RuleSet): Rule[] {
  return ruleSet.rules.filter(
    (r) => r.enabled && r.status !== "pending_config" && isDependencyMet(r, ruleSet),
  );
}

/** Every rule that was skipped, with the dependency named. */
export function skippedRules(ruleSet: RuleSet): NotEvaluated[] {
  return ruleSet.rules
    .map((r) => notEvaluatedReason(r, ruleSet))
    .filter((x): x is NotEvaluated => x !== null);
}

export function getRule(ruleSet: RuleSet, id: string): Rule | undefined {
  return ruleSet.rules.find((r) => r.id === id);
}

/**
 * Can a pending_config rule be promoted to active? Only if its dependency has been
 * satisfied. For phrase-list rules that means the list is populated; for the rest
 * the dependency is an external feed/policy the admin screen cannot verify, so we
 * block promotion and name the dependency. (The admin UI enforces this.)
 */
export function canActivate(rule: Rule, ruleSet: RuleSet): { ok: boolean; blockedBy: string | null } {
  const listName = rule.detection.phraseList;
  if (listName) {
    const populated = (ruleSet.phraseLists[listName]?.length ?? 0) > 0;
    return populated ? { ok: true, blockedBy: null } : { ok: false, blockedBy: rule.dependency };
  }
  if (rule.status === "pending_config" && rule.dependency) {
    return { ok: false, blockedBy: rule.dependency };
  }
  return { ok: true, blockedBy: null };
}

/** Bump a semantic version string. Every rule-set change bumps at least the patch. */
export function bumpVersion(version: string, level: "major" | "minor" | "patch" = "patch"): string {
  const parts = version.split(".").map((n) => parseInt(n, 10));
  const [major = 1, minor = 0, patch = 0] = parts;
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export const PHRASE_LIST_LABELS: Record<PhraseListName, string> = {
  riskWarning: "Approved risk warnings",
  licensingStatement: "Approved licensing / representative statements",
  pastPerformanceCaveat: "Approved past-performance caveats",
};
