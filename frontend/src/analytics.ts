// Client-side analytics computed from the stored real mentions (/api/mentions).
import type { Mention } from "./types";

export interface Slice { name: string; value: number; }

const STOP = new Set(
  ("the a an and or of to in for on with is are was be at by from as it this that these those we you they he she " +
   "our your their his her its i me my not no so if but about into over out up down all any can will just get got " +
   "prudential singapore sg has have had do does did been being more most very much than then them us who what which " +
   "when where how why what's im dont doesnt http https www com amp via re s t re m ll ve").split(/\s+/),
);

/** Share of voice — mention volume per platform (for the donut). */
export function shareOfVoice(m: Mention[]): Slice[] {
  const c = new Map<string, number>();
  for (const x of m) c.set(x.platform, (c.get(x.platform) ?? 0) + 1);
  return [...c.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/** Sentiment split per platform. */
export function channelwise(m: Mention[]) {
  const map = new Map<string, { positive: number; neutral: number; negative: number; total: number }>();
  for (const x of m) {
    const d = map.get(x.platform) ?? { positive: 0, neutral: 0, negative: 0, total: 0 };
    d[x.sentiment] += 1;
    d.total += 1;
    map.set(x.platform, d);
  }
  return [...map.entries()]
    .map(([platform, d]) => ({ platform, ...d }))
    .sort((a, b) => b.total - a.total);
}

/** Daily sentiment trend from the item timestamps. */
export function sentimentTrend(m: Mention[]) {
  const byDay = new Map<string, { positive: number; neutral: number; negative: number }>();
  for (const x of m) {
    const day = (x.timestamp || x.analysed_at || "").slice(0, 10);
    if (!day) continue;
    const d = byDay.get(day) ?? { positive: 0, neutral: 0, negative: 0 };
    d[x.sentiment] += 1;
    byDay.set(day, d);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, d]) => ({ day, ...d, total: d.positive + d.neutral + d.negative }));
}

/** Top hashtags found in the text. */
export function topHashtags(m: Mention[], limit = 20): Slice[] {
  const c = new Map<string, number>();
  for (const x of m) {
    for (const tag of (x.text || "").match(/#[\p{L}\p{N}_]+/gu) ?? []) {
      const k = tag.toLowerCase();
      c.set(k, (c.get(k) ?? 0) + 1);
    }
  }
  return [...c.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, limit);
}

/** Frequent words (word cloud) excluding stop words. */
export function wordCloud(m: Mention[], limit = 40): Slice[] {
  const c = new Map<string, number>();
  for (const x of m) {
    for (const w of (x.text || "").toLowerCase().match(/[\p{L}][\p{L}']{2,}/gu) ?? []) {
      if (STOP.has(w)) continue;
      c.set(w, (c.get(w) ?? 0) + 1);
    }
  }
  return [...c.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, limit);
}

/** Total engagement (likes + comments + views + upvotes + shares) per platform. */
export function engagementByPlatform(m: Mention[]): Slice[] {
  const c = new Map<string, number>();
  for (const x of m) {
    const e = x.engagement || {};
    const sum = Object.values(e).reduce((a, b) => a + (Number(b) || 0), 0);
    c.set(x.platform, (c.get(x.platform) ?? 0) + sum);
  }
  return [...c.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/** Alerts grouped by risk category (excluding NONE). */
export function riskByCategory(m: Mention[]): Slice[] {
  const c = new Map<string, number>();
  for (const x of m) {
    if (!x.risk_category || x.risk_category === "NONE") continue;
    c.set(x.risk_category, (c.get(x.risk_category) ?? 0) + 1);
  }
  return [...c.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

// ---- Topic extraction (drives the "Most Talked" bubble chart + treemap) ----
export interface Topic { name: string; count: number; positive: number; neutral: number; negative: number; }

const TOPIC_LEXICON: Record<string, string[]> = {
  "Claims & Payouts": ["claim", "payout", "settle", "reimburse", "compensat"],
  "Customer Service": ["service", "support", "response", "help", "staff", "agent", "advisor", "representative", "rude"],
  "Scams & Fraud": ["scam", "fraud", "impersonat", "phishing", "fake", "vigilant", "spoof"],
  "Policy & Coverage": ["policy", "cover", "coverage", "plan", "benefit", "clause", "exclusion"],
  "Pricing & Premiums": ["price", "cost", "fee", "expensive", "premium", "cheap", "affordab"],
  "Digital & App": ["app", "website", "online", "login", "portal", "digital", "pulse"],
  "Complaints & Delays": ["complaint", "issue", "problem", "delay", "poor", "terrible", "disappoint", "wait"],
  "Health & Medical": ["health", "medical", "hospital", "shield", "clinic", "surg", "care"],
  "Investment & Wealth": ["invest", "fund", "return", "saving", "wealth", "retirement"],
  "Trust & Reputation": ["trust", "reputation", "reliable", "recommend", "honest", "transparen"],
};

export function topicMentions(m: Mention[], name: string): Mention[] {
  const keys = TOPIC_LEXICON[name] || [];
  return m.filter((x) => { const t = (x.text || "").toLowerCase(); return keys.some((k) => t.includes(k)); });
}

export function topics(m: Mention[]): Topic[] {
  const out: Topic[] = [];
  for (const [name, keys] of Object.entries(TOPIC_LEXICON)) {
    const t: Topic = { name, count: 0, positive: 0, neutral: 0, negative: 0 };
    for (const x of m) {
      const text = (x.text || "").toLowerCase();
      if (keys.some((k) => text.includes(k))) {
        t.count += 1;
        t[x.sentiment] += 1;
      }
    }
    if (t.count > 0) out.push(t);
  }
  return out.sort((a, b) => b.count - a.count);
}

// ---- Vocal users (drives the Influencer / Top Vocal Users cards) ----
export interface VocalUser {
  author: string; platform: string; author_url: string | null;
  posts: number; engagement: number; negative: number; neutral: number; positive: number;
  latest: string; latestUrl: string | null;
}
export function vocalUsers(m: Mention[]): VocalUser[] {
  const map = new Map<string, VocalUser>();
  for (const x of m) {
    const key = `${x.platform}:${x.author}`;
    const u = map.get(key) ?? {
      author: x.author || "unknown", platform: x.platform, author_url: x.author_url,
      posts: 0, engagement: 0, negative: 0, neutral: 0, positive: 0, latest: "", latestUrl: null,
    };
    u.posts += 1;
    u.engagement += Object.values(x.engagement || {}).reduce((a, b) => a + (Number(b) || 0), 0);
    u[x.sentiment] += 1;
    if ((x.timestamp || "") >= u.latest) { u.latest = x.timestamp || ""; u.latestUrl = x.url; }
    map.set(key, u);
  }
  return [...map.values()].sort((a, b) => b.engagement - a.engagement || b.posts - a.posts);
}

export const PLATFORM_COLORS: Record<string, string> = {
  reddit: "#FF4500", youtube: "#FF0000", instagram: "#C13584", telegram: "#229ED9",
  quora: "#B92B27", linkedin: "#0A66C2", x: "#111827", facebook: "#1877F2", whatsapp: "#25D366",
};
export const platformColor = (p: string) => PLATFORM_COLORS[p] ?? "#64748b";
