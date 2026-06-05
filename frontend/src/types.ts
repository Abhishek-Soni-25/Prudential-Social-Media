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

export interface Channel {
  name: string;
  enabled: boolean;
  mode: "live" | "demo";
  sources: string[];
}

export interface ScanStatus {
  running: boolean;
  last_run: string | null;
  last_stats: Record<string, number> | null;
  error: string | null;
  active_model: string | null;
  models: string[] | null;
}
