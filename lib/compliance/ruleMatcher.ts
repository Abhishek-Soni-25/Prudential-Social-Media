/**
 * Rule matcher — turns a normalised ExtractedAsset into RuleHits.
 *
 * This is the detection layer. It runs the four self-service detection templates
 * a compliance officer can configure (lexicon, entity, regex, phrase_absence)
 * plus metadata completeness, against the text the extractors pulled from the
 * asset. Rules whose signal needs a vision service the browser cannot run
 * (template "vision") only fire when the extractor supplied an explicit signal.
 *
 * It does NOT decide the outcome — it produces hits and the list of rules that
 * were skipped for an unmet dependency. decisionEngine.evaluate() takes it from
 * there. Confidence values are deterministic and documented per template so a
 * decision can be reproduced exactly.
 */

import type {
  EvidenceRegion,
  ExtractedAsset,
  NotEvaluated,
  Rule,
  RuleHit,
  RuleSet,
} from "./types";
import { evaluableRules, skippedRules } from "./rules";

export interface MatchResult {
  hits: RuleHit[];
  notEvaluated: NotEvaluated[];
}

/** One searchable unit of extracted text, tagged with where it came from. */
interface TextBlock {
  text: string;
  kind: EvidenceRegion["kind"];
  frame?: number;
  timestampSec?: number;
  bbox?: [number, number, number, number];
  thumbnail?: string | null;
}

// --- Detection lexicons the browser-side matcher needs. These are matcher
// constants, not rules; the rules reference them by template + params. A later
// version can move product/competitor lexicons into the config feeds named in
// the pending_config dependencies (approved-product register, etc.).
const PRODUCT_TERMS = [
  "prushield", "pruactive", "prulink", "pruwealth", "pruvantage", "prusaver",
  "prucash", "prulife", "pruterm", "pruearly", "endowment", "annuity",
  "investment-linked", "ilp", "whole life", "term life", "unit trust",
  "insurance plan", "savings plan", "retirement plan", "policy",
];

const HISTORICAL_TERMS = [
  "past performance", "historical", "track record", "annualised", "annualized",
  "since inception", "past returns", "last 3 years", "last 5 years", "5-year return",
  "3-year return", "fund performance", "historical returns",
];

const COMPARATIVE_TERMS = [
  "better than", "beats", "outperforms", "compared to", "versus", " vs ", "vs.",
  "cheaper than", "higher than", "lower than", "more than", "unlike",
];

const DISCLOSURE_LABEL_TERMS = [
  "#ad", "#sponsored", "sponsored", "paid partnership", "paid promotion",
  "advertisement", "in partnership with", "#affiliate", "affiliate disclosure",
];

const PERCENTAGE_RE = /\b\d{1,3}(?:\.\d+)?\s?%/;
const FOUR_DIGIT_YEAR_RE = /\b(?:19|20)\d{2}\b/;
// Singapore NRIC/FIN: letter, 7 digits, letter (e.g. S1234567D).
const NRIC_RE = /\b[STFGM]\d{7}[A-Z]\b/i;
const SG_PHONE_RE = /\b(?:\+65[\s-]?)?[689]\d{3}[\s-]?\d{4}\b/;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const REFERRAL_RE = /\b(?:ref(?:erral)?\s*code|promo\s*code|use\s*code|affiliate)\b/i;
const PROMO_LINK_RE = /\b(?:bit\.ly|linktr\.ee|tinyurl|promo|ref=|utm_)/i;

/** Confidence assigned per template — deterministic, documented, tuneable. */
const CONFIDENCE = {
  lexicon: 0.9,
  entity: 0.82,
  regex_pii: 0.92,
  regex_return: 0.88,
  phrase_absence: 0.85,
  metadata: 0.95,
  award: 0.8,
  disclosure_absence: 0.8,
  vision_signal: 0.9,
} as const;

export function matchRules(asset: ExtractedAsset, ruleSet: RuleSet): MatchResult {
  const blocks = buildBlocks(asset);
  const haystack = blocks.map((b) => b.text).join("\n").toLowerCase();

  const hits: RuleHit[] = [];
  for (const rule of evaluableRules(ruleSet)) {
    const hit = evaluateRule(rule, asset, blocks, haystack, ruleSet);
    if (hit) hits.push(hit);
  }

  return { hits, notEvaluated: skippedRules(ruleSet) };
}

function evaluateRule(
  rule: Rule,
  asset: ExtractedAsset,
  blocks: TextBlock[],
  haystack: string,
  ruleSet: RuleSet,
): RuleHit | null {
  const p = (rule.detection.params ?? {}) as Record<string, any>;

  switch (rule.detection.template) {
    case "lexicon":
      return matchLexicon(rule, blocks, p);
    case "regex":
      return matchRegex(rule, asset, blocks, haystack, p);
    case "entity":
      return matchEntity(rule, blocks, haystack, p);
    case "phrase_absence":
      return matchPhraseAbsence(rule, asset, blocks, haystack, p, ruleSet);
    case "metadata":
      return matchMetadata(rule, asset, p);
    case "vision":
      return matchVisionSignal(rule, asset);
    default:
      return null;
  }
}

// --- Prohibition templates (presence = hit) ------------------------------------

function matchLexicon(rule: Rule, blocks: TextBlock[], p: Record<string, any>): RuleHit | null {
  const terms: string[] = (p.terms ?? []).map((t: string) => t.toLowerCase());
  for (const block of blocks) {
    const text = block.text.toLowerCase();
    const found = terms.find((t) => t.length > 0 && text.includes(t));
    if (!found) continue;

    // D-10: an award claim is only a hit when it lacks its qualifying year.
    if (Array.isArray(p.requiresQualifiers)) {
      const hasYear = FOUR_DIGIT_YEAR_RE.test(block.text);
      if (p.requiresQualifiers.includes("four_digit_year") && hasYear) continue;
      return makeHit(rule, CONFIDENCE.award, block, `Award claim "${found}" without a qualifying year in the same frame.`);
    }
    return makeHit(rule, CONFIDENCE.lexicon, block, `Matched prohibited term "${found}".`);
  }
  return null;
}

function matchRegex(
  rule: Rule,
  asset: ExtractedAsset,
  blocks: TextBlock[],
  haystack: string,
  p: Record<string, any>,
): RuleHit | null {
  // D-03: a percentage in the same block as a return/growth/yield term.
  if (p.pattern === "percentage") {
    const near: string[] = (p.nearTerms ?? []).map((t: string) => t.toLowerCase());
    for (const block of blocks) {
      if (!PERCENTAGE_RE.test(block.text)) continue;
      const lower = block.text.toLowerCase();
      const term = near.find((t) => lower.includes(t));
      if (term) {
        return makeHit(rule, CONFIDENCE.regex_return, block, `Return figure quoted: a percentage alongside "${term}".`);
      }
    }
    return null;
  }

  // D-02: PII pattern, only a hit in a product context.
  if (Array.isArray(p.patterns) && p.requiresProductContext) {
    const productPresent = containsAny(haystack, PRODUCT_TERMS) || Boolean(asset.signals?.product_entity);
    const faceInContext = Boolean(asset.signals?.face) && productPresent;
    for (const block of blocks) {
      const pii = detectPii(block.text, p.patterns);
      if (pii && productPresent) {
        return makeHit(rule, CONFIDENCE.regex_pii, block, `Client ${pii} shown in a product context.`);
      }
    }
    if (faceInContext) {
      return makeHit(rule, CONFIDENCE.regex_pii, blocks[0] ?? textOnly(""), "A face was detected alongside a product entity.");
    }
    return null;
  }

  // A-06 (requirement): a referral/promo/affiliate marker present WITHOUT a disclosure label.
  if (p.requiresDisclosureLabel) {
    const hasReferral = REFERRAL_RE.test(haystack) || PROMO_LINK_RE.test(haystack) || Boolean(asset.signals?.affiliate_tag);
    const hasLabel = containsAny(haystack, DISCLOSURE_LABEL_TERMS);
    if (hasReferral && !hasLabel) {
      return makeHit(rule, CONFIDENCE.disclosure_absence, firstMatchBlock(blocks, REFERRAL_RE) ?? blocks[0] ?? textOnly(""), "Referral/promo/affiliate marker present with no paid-content disclosure label.");
    }
    return null;
  }

  return null;
}

function matchEntity(rule: Rule, blocks: TextBlock[], haystack: string, p: Record<string, any>): RuleHit | null {
  // D-01: two or more policy schedule field labels in a single frame/block.
  if (Array.isArray(p.labelSet)) {
    const labels: string[] = p.labelSet.map((t: string) => t.toLowerCase());
    const minCount: number = p.minCount ?? 2;
    for (const block of blocks) {
      const text = block.text.toLowerCase();
      const matched = labels.filter((l) => text.includes(l));
      if (matched.length >= minCount) {
        return makeHit(
          rule,
          CONFIDENCE.regex_pii,
          block,
          `Policy schedule detected: ${matched.length} field labels in one frame (${matched.slice(0, 3).join(", ")}…).`,
        );
      }
    }
    return null;
  }

  const entities: string[] = (p.entityList ?? []).map((t: string) => t.toLowerCase());
  if (entities.length === 0) return null;
  const entity = entities.find((e) => haystack.includes(e));
  if (!entity) return null;

  // D-08: only a hit alongside a comparative construction or a figure.
  if (Array.isArray(p.coPresent)) {
    const comparative = containsAny(haystack, COMPARATIVE_TERMS);
    const figure = PERCENTAGE_RE.test(haystack) || /\$\s?\d/.test(haystack);
    if (!comparative && !figure) return null;
    const block = firstBlockContaining(blocks, entity) ?? blocks[0] ?? textOnly("");
    return makeHit(rule, CONFIDENCE.entity, block, `Named competitor "${titleCase(entity)}" alongside a comparison or figure.`);
  }
  return makeHit(rule, CONFIDENCE.entity, firstBlockContaining(blocks, entity) ?? textOnly(""), `Named entity "${titleCase(entity)}" detected.`);
}

// --- Requirement templates (absence = hit) -------------------------------------

function matchPhraseAbsence(
  rule: Rule,
  asset: ExtractedAsset,
  blocks: TextBlock[],
  haystack: string,
  p: Record<string, any>,
  ruleSet: RuleSet,
): RuleHit | null {
  // Trigger: is the condition that requires the disclosure present?
  const trigger = p.trigger as string;
  const triggered =
    trigger === "product_entity"
      ? containsAny(haystack, PRODUCT_TERMS) || Boolean(asset.signals?.product_entity)
      : trigger === "historical_performance"
        ? containsAny(haystack, HISTORICAL_TERMS) || Boolean(asset.signals?.historical_performance)
        : false;
  if (!triggered) return null;

  // Absence: none of the approved phrases appear. (Reaching here means the phrase
  // list is populated — an empty list is handled upstream as notEvaluated.)
  const listName = rule.detection.phraseList!;
  const phrases = ruleSet.phraseLists[listName] ?? [];
  const present = phrases.some((phrase) => haystack.includes(phrase.toLowerCase()));
  if (present) return null;

  return makeHit(
    rule,
    CONFIDENCE.phrase_absence,
    blocks[0] ?? textOnly(""),
    `A product/condition is present but no approved ${listName} phrase appears in the asset.`,
  );
}

function matchMetadata(rule: Rule, asset: ExtractedAsset, p: Record<string, any>): RuleHit | null {
  const required: string[] = p.requiredFields ?? [];
  const md = asset.metadata ?? {};
  const missing = required.filter((f) => md[f] === undefined || md[f] === null || md[f] === "");
  if (missing.length === 0) return null;
  return makeHit(
    rule,
    CONFIDENCE.metadata,
    { kind: "metadata", snippet: `missing: ${missing.join(", ")}` },
    `Asset is missing required register metadata: ${missing.join(", ")}.`,
  );
}

function matchVisionSignal(rule: Rule, asset: ExtractedAsset): RuleHit | null {
  // Vision-template rules only fire when a vision service supplied an explicit
  // signal keyed by rule id (e.g. signals["D-05"] = true). Absent -> no hit.
  if (asset.signals?.[rule.id]) {
    return makeHit(rule, CONFIDENCE.vision_signal, null, `Vision signal fired for ${rule.id}.`);
  }
  return null;
}

// --- Helpers -------------------------------------------------------------------

function buildBlocks(asset: ExtractedAsset): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const t of asset.imageText) {
    if (!t.text?.trim()) continue;
    blocks.push({
      text: t.text,
      kind: t.frame !== undefined ? "video_frame" : "image",
      frame: t.frame,
      timestampSec: t.timestampSec,
      bbox: t.bbox,
      thumbnail: t.frame !== undefined ? asset.frames[t.frame] ?? null : asset.frames[0] ?? null,
    });
  }
  if (asset.captionText?.trim()) blocks.push({ text: asset.captionText, kind: "caption" });
  if (asset.transcript?.trim()) blocks.push({ text: asset.transcript, kind: "transcript" });
  return blocks;
}

function makeHit(rule: Rule, confidence: number, region: TextBlock | EvidenceRegion | null, detail: string): RuleHit {
  let evidence: EvidenceRegion | null = null;
  if (region && "text" in region) {
    // A TextBlock — normalise to an EvidenceRegion.
    evidence = {
      kind: region.kind,
      frame: region.frame,
      timestampSec: region.timestampSec,
      bbox: region.bbox,
      thumbnail: region.thumbnail ?? null,
      snippet: region.text?.slice(0, 200),
    };
  } else if (region) {
    // Already an EvidenceRegion.
    evidence = region;
  }
  return {
    ruleId: rule.id,
    title: rule.title,
    severity: rule.severity,
    status: rule.status,
    type: rule.type,
    confidence,
    region: evidence,
    basis: rule.basis,
    reviewerNote: rule.reviewerNote,
    suggestedFix: rule.suggestedFix,
    detail,
  };
}

function detectPii(text: string, patterns: string[]): string | null {
  if (patterns.includes("nric") && NRIC_RE.test(text)) return "NRIC/FIN";
  if (patterns.includes("sg_phone") && SG_PHONE_RE.test(text)) return "contact number";
  if (patterns.includes("email") && EMAIL_RE.test(text)) return "email address";
  return null;
}

function containsAny(haystack: string, terms: string[]): boolean {
  return terms.some((t) => haystack.includes(t.toLowerCase()));
}

function firstBlockContaining(blocks: TextBlock[], needle: string): TextBlock | null {
  return blocks.find((b) => b.text.toLowerCase().includes(needle.toLowerCase())) ?? null;
}

function firstMatchBlock(blocks: TextBlock[], re: RegExp): TextBlock | null {
  return blocks.find((b) => re.test(b.text)) ?? null;
}

function textOnly(text: string): TextBlock {
  return { text, kind: "image" };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
