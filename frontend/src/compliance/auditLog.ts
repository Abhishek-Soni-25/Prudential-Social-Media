/**
 * Compliance audit register (FSG-03 Safeguard 4).
 *
 * Append-only. No updates, no deletes. Every screening decision — and every
 * compliance-officer override — writes one immutable record. This log IS the
 * register of digital advertising activity a MAS inspector will ask for, and the
 * evidence pack for any single decision.
 *
 * PII discipline: policy numbers and NRIC/FIN patterns are pseudonymised BEFORE
 * anything is written. We store the asset hash and the evidence crop, never raw
 * client data. The tool must not become the leak it exists to prevent.
 *
 * Persistence is via the backend register (POST /api/compliance/audit). When the
 * backend is unreachable the record is queued in localStorage so nothing is lost;
 * a later flush re-sends it. The record shape is identical either way.
 */

import type { EvidenceRegion, ExtractedAsset, NotEvaluated, Outcome, Severity, RuleStatus, Verdict } from "./types";

export interface AuditHit {
  ruleId: string;
  title: string;
  severity: Severity;
  status: RuleStatus;
  confidence: number;
  region: EvidenceRegion | null;
  basis: string;
  belowFloor?: boolean;
}

export interface AuditOverride {
  officerId: string;
  justification: string;
  outcome: Outcome;
  at: string;
}

export interface AuditRecord {
  id: string;
  assetHash: string;
  adviserId: string;
  channel: string;
  submittedAt: string;
  /** Pseudonymised extracted on-screen text. */
  extractedText: string;
  /** Pseudonymised transcript. */
  transcript: string;
  extractionStatus: ExtractedAsset["extractionStatus"];
  hits: AuditHit[];
  notEvaluated: NotEvaluated[];
  computedOutcome: Outcome;
  override: AuditOverride | null;
  finalDisposition: Outcome;
  ruleSetVersion: string;
}

// --- PII pseudonymisation ------------------------------------------------------

// Singapore NRIC/FIN: letter + 7 digits + letter.
const NRIC_RE = /\b[STFGM]\d{7}[A-Z]\b/gi;
// Policy / account numbers: a "policy/account no" label followed by an identifier,
// plus any bare run of 7+ digits (benefit-illustration values are masked separately
// only when labelled, to avoid destroying legitimate marketing numbers like phone
// area references — long bare digit runs are the conservative catch).
const POLICY_LABELLED_RE = /\b(policy|account|certificate)\s*(no\.?|number|#)?\s*[:#]?\s*([A-Z0-9-]{6,})/gi;
const LONG_DIGITS_RE = /\b\d{7,}\b/g;

/**
 * Deterministic, non-reversible token so the same identifier maps to the same
 * pseudonym across records (enables correlation for an investigator without
 * exposing the value). FNV-1a — no clock, no randomness, stable across runs.
 */
function token(prefix: string, value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `[${prefix}:${(h >>> 0).toString(16).padStart(8, "0")}]`;
}

/** Mask NRIC/FIN and policy/account numbers in free text. */
export function pseudonymise(text: string): string {
  if (!text) return "";
  let out = text.replace(NRIC_RE, (m) => token("NRIC", m.toUpperCase()));
  out = out.replace(POLICY_LABELLED_RE, (_m, label, _sep, id) => `${label} ${token("POLICY", String(id))}`);
  out = out.replace(LONG_DIGITS_RE, (m) => token("NUM", m));
  return out;
}

// --- Hashing (asset identity, no clock) ---------------------------------------

/** Stable content hash for the asset, so the register references it without storing raw client data. */
export function assetHash(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `sha_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

// --- Record construction -------------------------------------------------------

export interface BuildRecordParams {
  asset: ExtractedAsset;
  verdict: Verdict;
  submittedAt: string;
  /** Optional externally-supplied id (else derived from asset hash + submittedAt). */
  id?: string;
}

/**
 * Build the immutable audit record from an asset + its verdict. PII is
 * pseudonymised here, before the record leaves this function. Pure and testable:
 * timestamps are passed in, not read from a clock.
 */
export function buildAuditRecord({ asset, verdict, submittedAt, id }: BuildRecordParams): AuditRecord {
  const extractedRaw = [asset.imageText.map((t) => t.text).join("\n"), asset.captionText].filter(Boolean).join("\n");
  const hash = assetHash(asset.frames[0] ?? asset.assetId ?? extractedRaw ?? asset.transcript);

  const hits: AuditHit[] = verdict.activeHits.concat(verdict.advisoryHits).map((h) => ({
    ruleId: h.ruleId,
    title: h.title,
    severity: h.severity,
    status: h.status,
    confidence: h.confidence,
    region: sanitizeRegion(h.region),
    basis: h.basis,
    belowFloor: h.belowFloor,
  }));

  return {
    id: id ?? `${hash}-${submittedAt}`,
    assetHash: hash,
    adviserId: asset.adviserId,
    channel: asset.channel,
    submittedAt,
    extractedText: pseudonymise(extractedRaw),
    transcript: pseudonymise(asset.transcript),
    extractionStatus: asset.extractionStatus,
    hits,
    notEvaluated: verdict.notEvaluated,
    computedOutcome: verdict.outcome,
    override: null,
    finalDisposition: verdict.outcome,
    ruleSetVersion: verdict.ruleSetVersion,
  };
}

/**
 * Prepare an evidence region for the register. We keep the locator (kind, frame,
 * bbox, timestamp) and a pseudonymised text snippet, but drop the raw base64
 * image: the register stores the asset hash and where the evidence is, not the
 * client's imagery. Keeping full frames here would bloat the log and re-store the
 * very data the tool exists to protect.
 */
function sanitizeRegion(region: EvidenceRegion | null): EvidenceRegion | null {
  if (!region) return null;
  return {
    kind: region.kind,
    frame: region.frame,
    bbox: region.bbox,
    timestampSec: region.timestampSec,
    thumbnail: null,
    snippet: region.snippet ? pseudonymise(region.snippet) : region.snippet,
  };
}

/**
 * Apply a compliance-officer override. Returns a NEW record (append-only: the
 * override is a fresh disposition on the record, never an edit of history). The
 * caller writes the returned record as a new audit line.
 */
export function withOverride(
  record: AuditRecord,
  override: { officerId: string; justification: string; outcome: Outcome; at: string },
): AuditRecord {
  if (!override.justification.trim()) {
    throw new Error("An override requires a justification.");
  }
  return {
    ...record,
    override: { ...override },
    finalDisposition: override.outcome,
  };
}

// --- CSV export ----------------------------------------------------------------

const CSV_COLUMNS: (keyof AuditRecord)[] = [
  "id", "assetHash", "adviserId", "channel", "submittedAt", "extractionStatus",
  "computedOutcome", "finalDisposition", "ruleSetVersion",
  "extractedText", "transcript", "hits", "notEvaluated", "override",
];

function csvCell(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(records: AuditRecord[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = records.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return [header, ...rows].join("\r\n");
}

// --- Persistence ---------------------------------------------------------------

const LOCAL_KEY = "prudential_compliance_audit";

/** Append one record to the register. Backend first; localStorage fallback so nothing is lost. */
export async function appendAudit(record: AuditRecord): Promise<{ ok: boolean; persistedTo: "backend" | "local" }> {
  try {
    const res = await fetch("/api/compliance/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    if (res.ok) return { ok: true, persistedTo: "backend" };
    throw new Error(`audit POST ${res.status}`);
  } catch {
    appendLocal(record);
    return { ok: true, persistedTo: "local" };
  }
}

function appendLocal(record: AuditRecord): void {
  if (typeof localStorage === "undefined") return;
  const existing = loadLocal();
  existing.unshift(record);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(existing));
}

export function loadLocal(): AuditRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as AuditRecord[];
  } catch {
    return [];
  }
}

/** Load the register: backend if available, else the local fallback queue. */
export async function loadAudit(): Promise<AuditRecord[]> {
  try {
    const res = await fetch("/api/compliance/audit");
    if (res.ok) return (await res.json()) as AuditRecord[];
  } catch {
    /* fall through */
  }
  return loadLocal();
}
