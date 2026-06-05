// Client-side demo channels: draw 3 random samples per channel on each scan, map the
// risk-bearing ones to alert objects. Nothing is sent to the backend or stored.
import { DEMO_POOL, type DemoSample } from "./demoData";
import type { CaseFile, Stats } from "./types";

export const DEMO_CHANNELS = ["telegram", "x", "whatsapp", "quora"];
export const ALL_CHANNELS = ["reddit", "linkedin", ...DEMO_CHANNELS];

const DRAW = 3;

const SOURCE_LABEL: Record<string, string> = {
  x: "X Search: Prudential Singapore",
  telegram: "@SGInvestTalk",
  whatsapp: "PRU Agency Group",
  quora: "quora.com",
};

function sample<T>(arr: T[], k: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

function toCase(s: DemoSample): CaseFile {
  const now = new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 8);
  return {
    case_id: `CASE-${s.risk_category.slice(0, 3)}-${s.channel}-${rand}`,
    platform: s.channel,
    source: SOURCE_LABEL[s.channel] ?? s.channel,
    timestamp: now,
    author_ref: s.author_ref,
    raw_content: s.raw_content,
    risk_category: s.risk_category,
    severity: s.severity as CaseFile["severity"],
    sentiment_polarity: s.sentiment_polarity,
    sentiment_score: s.sentiment_score,
    confidence: s.confidence,
    rationale: s.rationale,
    indicators: s.indicators,
    mitigation_urgency: s.mitigation_urgency,
    racm_ref: s.racm_ref,
    kri_ref: s.kri_ref,
    url: s.url,
    created_at: now,
  };
}

/** Draw 3 random samples per demo channel — ALL of them (incl. neutral/no-risk). */
export function drawDemoCases(): CaseFile[] {
  const out: CaseFile[] = [];
  for (const ch of DEMO_CHANNELS) {
    const pool = DEMO_POOL[ch] ?? [];
    for (const s of sample(pool, DRAW)) out.push(toCase(s));
  }
  return out;
}

export interface Insights {
  total: number;
  alerts: number;
  cleanPct: number;
  sentiment: { negative: number; neutral: number; positive: number };
  negPct: number;
  topCategory: { name: string; count: number } | null;
  topChannel: { name: string; alerts: number } | null;
  categories: { name: string; count: number }[];
  channelRisk: { name: string; alerts: number; total: number }[];
}

const ALERT_SEVS = new Set(["HIGH", "MEDIUM"]);

export function computeInsights(cases: CaseFile[], channelOrder: string[]): Insights {
  const sentiment = { negative: 0, neutral: 0, positive: 0 };
  const catCount: Record<string, number> = {};
  const perCh: Record<string, { alerts: number; total: number }> = {};
  let alerts = 0;

  for (const c of cases) {
    const p = (c.sentiment_polarity || "neutral").toLowerCase();
    if (p.startsWith("neg")) sentiment.negative += 1;
    else if (p.startsWith("pos")) sentiment.positive += 1;
    else sentiment.neutral += 1;

    if (c.risk_category && c.risk_category !== "NONE" && c.risk_category !== "GENERAL") {
      catCount[c.risk_category] = (catCount[c.risk_category] ?? 0) + 1;
    }
    const isAlert = ALERT_SEVS.has(c.severity);
    if (isAlert) alerts += 1;
    const ch = c.platform;
    perCh[ch] = perCh[ch] ?? { alerts: 0, total: 0 };
    perCh[ch].total += 1;
    if (isAlert) perCh[ch].alerts += 1;
  }

  const categories = Object.entries(catCount)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const channelRisk = channelOrder
    .map((name) => ({ name, alerts: perCh[name]?.alerts ?? 0, total: perCh[name]?.total ?? 0 }))
    .sort((a, b) => b.alerts - a.alerts);
  const total = cases.length;
  const topChannel = channelRisk.find((c) => c.alerts > 0) ?? null;

  return {
    total,
    alerts,
    cleanPct: total ? Math.round(((total - alerts) / total) * 100) : 0,
    sentiment,
    negPct: total ? Math.round((sentiment.negative / total) * 100) : 0,
    topCategory: categories[0] ?? null,
    topChannel: topChannel ? { name: topChannel.name, alerts: topChannel.alerts } : null,
    categories,
    channelRisk,
  };
}

export function computeStats(cases: CaseFile[]): Stats {
  const by_severity: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 };
  const by_category: Record<string, number> = {};
  const by_channel: Record<string, number> = {};
  let latest = "";
  for (const c of cases) {
    if (c.severity in by_severity) by_severity[c.severity] += 1;
    if (c.risk_category && c.risk_category !== "NONE" && c.risk_category !== "GENERAL") {
      by_category[c.risk_category] = (by_category[c.risk_category] ?? 0) + 1; // real alerts only
    }
    by_channel[c.platform] = (by_channel[c.platform] ?? 0) + 1;
    if (c.created_at > latest) latest = c.created_at;
  }
  return { total_cases: cases.length, by_severity, by_category, by_channel, latest: latest || null };
}
