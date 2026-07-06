export type Severity = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface CaseFile {
  case_id: string;
  platform: string;
  source: string;
  timestamp: string;
  author_ref: string;
  raw_content: string;
  risk_category: string;
  severity: Severity;
  sentiment_polarity: string;
  sentiment_score: number;
  confidence: number;
  rationale: string;
  indicators: string[];
  mitigation_urgency: string;
  racm_ref: string;
  kri_ref: string;
  url: string | null;
  created_at: string;
}

export interface Stats {
  total_cases: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_channel: Record<string, number>;
  latest: string | null;
}

// A single analysed item from the real Bright Data / Apify pipeline (/api/mentions).
export interface Mention {
  id: string;
  platform: string;
  provider: string | null;
  author: string;
  author_url: string | null;
  url: string | null;              // permalink — click to open & verify
  text: string;
  keyword: string | null;
  engagement: Record<string, number>;
  sentiment: "positive" | "neutral" | "negative";
  risk_category: string;
  severity: Severity;
  confidence: number;
  rationale: string;
  indicators: string[];
  timestamp: string;
  analysed_at: string;
}

// Per-account activity (/api/authors) — how many times an account posted about the keyword.
export interface AuthorActivity {
  author: string;
  platform: string;
  author_url: string | null;
  posts: number;
  negative: number;
  neutral: number;
  positive: number;
  flagged: number;
  latest_url: string | null;
  latest_at: string;
}

export interface Channel {
  name: string;
  enabled: boolean;
  mode: "live" | "demo";
  sources: string[];
}

export interface ComplianceCheck {
  id: string;
  title: string;
  source: string;
  status: "PASS" | "FAIL" | "UNCLEAR";
  detail: string;
}
export interface ComplianceResult {
  issues_found: boolean;
  summary: string;
  checks: ComplianceCheck[];
  passed: number;
  failed: number;
  unclear: number;
  transcript?: string;
  frame?: string | null;
  frames_used?: number;
}

export interface SovEntry {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  by_platform: Record<string, number>;
}
export interface CompetitorSov {
  prudential: SovEntry;
  competitors: Record<string, SovEntry>;
}

export interface ScanStatus {
  running: boolean;
  last_run: string | null;
  last_stats: Record<string, number> | null;
  error: string | null;
  active_model: string | null;
  models: string[] | null;
}
