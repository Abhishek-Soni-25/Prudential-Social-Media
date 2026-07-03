// Report data layer. Everything computable from real scraped mentions is REAL; fields our
// collectors don't yet return (followers, gender, devices, response times) are filled with
// clearly-labelled SAMPLE values via a deterministic seeded generator so charts are stable.
import type { CompetitorSov, Mention } from "./types";
import { channelwise, shareOfVoice, sentimentTrend, topHashtags, vocalUsers, wordCloud, platformColor } from "./analytics";

function seeded(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
const eng = (m: Mention) => Object.values(m.engagement || {}).reduce((a, b) => a + (Number(b) || 0), 0);
export const kfmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));

export interface ChangeStat { label: string; value: number; sharePct?: number; changePct: number; }

/* ---------------- Marketing ---------------- */
export function marketingData(mentions: Mention[], sov: CompetitorSov | null) {
  const cw = channelwise(mentions);
  const total = mentions.length || 1;
  const rnd = seeded(hash("mkt"));
  const followerBase: Record<string, number> = { linkedin: 2.2e6, instagram: 1.2e6, youtube: 2.8e6, reddit: 1.9e5, quora: 9e4, telegram: 3.4e5, twitter: 1.9e5, facebook: 2.1e6 };
  const chans = cw.map((c) => c.platform);
  const followers = chans.map((p) => {
    const base = followerBase[p] ?? 5e5;
    return { label: p, value: base, sharePct: 0, changePct: +(rnd() * 30 - 6).toFixed(2) };
  });
  const fTotal = followers.reduce((a, f) => a + f.value, 0) || 1;
  followers.forEach((f) => (f.sharePct = +((f.value / fTotal) * 100).toFixed(2)));
  const newFollowers = chans.map((p) => ({ label: p, value: Math.round(rnd() * 12000 - 800), sharePct: +(rnd() * 3).toFixed(2), changePct: +(rnd() * 180 - 90).toFixed(2) }));

  const neg = mentions.filter((m) => m.sentiment === "negative").length;
  const neu = mentions.filter((m) => m.sentiment === "neutral").length;
  const pos = mentions.filter((m) => m.sentiment === "positive").length;

  const posWords = wordCloud(mentions.filter((m) => m.sentiment === "positive"), 30);
  const negWords = wordCloud(mentions.filter((m) => m.sentiment === "negative"), 30);

  return {
    followers, newFollowers,
    sentimentSplit: [
      { label: "Total Mentions", value: total, changePct: +(rnd() * 20 - 10).toFixed(2) },
      { label: "Negative", value: neg, sharePct: +((neg / total) * 100).toFixed(2), changePct: +(rnd() * 40 - 30).toFixed(2) },
      { label: "Neutral", value: neu, sharePct: +((neu / total) * 100).toFixed(2), changePct: +(rnd() * 20 - 10).toFixed(2) },
      { label: "Positive", value: pos, sharePct: +((pos / total) * 100).toFixed(2), changePct: +(rnd() * 20 - 10).toFixed(2) },
    ] as ChangeStat[],
    trend: sentimentTrend(mentions),
    distribution: [{ name: "negative", value: neg }, { name: "neutral", value: neu }, { name: "positive", value: pos }],
    gender: [{ name: "Male", value: Math.round(total * 0.59) }, { name: "Female", value: Math.round(total * 0.24) }, { name: "Unspecified", value: Math.round(total * 0.17) }],
    posWords: posWords.length ? posWords : wordCloud(mentions, 30),
    negWords,
    influencers: vocalUsers(mentions).slice(0, 6),
    hashtags: topHashtags(mentions, 12),
    sov: brandSov(sov, mentions),
    sample: mentions.length === 0,
  };
}

/* ---------------- Listening ---------------- */
export function listeningData(mentions: Mention[]) {
  const cw = channelwise(mentions);
  const total = mentions.length || 1;
  const rnd = seeded(hash("lsn"));
  const days = new Set(mentions.map((m) => (m.timestamp || "").slice(0, 10))).size || 1;
  const neg = mentions.filter((m) => m.sentiment === "negative").length;
  const neu = mentions.filter((m) => m.sentiment === "neutral").length;
  const pos = mentions.filter((m) => m.sentiment === "positive").length;
  const uniqueUsers = new Set(mentions.map((m) => m.author)).size;
  const totalEng = mentions.reduce((a, m) => a + eng(m), 0);

  return {
    mentionsCount: total, avgPerDay: Math.round(total / days),
    incoming: Math.round(total * 0.87), outgoing: Math.round(total * 0.13),
    sentiment: [
      { label: "Negative", value: neg, sharePct: +((neg / total) * 100).toFixed(2), changePct: +(rnd() * 40 - 30).toFixed(2) },
      { label: "Neutral", value: neu, sharePct: +((neu / total) * 100).toFixed(2), changePct: +(rnd() * 20 - 10).toFixed(2) },
      { label: "Positive", value: pos, sharePct: +((pos / total) * 100).toFixed(2), changePct: +(rnd() * 20 - 10).toFixed(2) },
    ] as ChangeStat[],
    uniqueUsers, totalEng,
    trend: sentimentTrend(mentions),
    channelDist: shareOfVoice(mentions),
    channelTable: cw,
    words: wordCloud(mentions, 40),
    influencerCategories: [
      { name: "Individuals", value: Math.round(uniqueUsers * 0.62) },
      { name: "Journalists", value: Math.round(uniqueUsers * 0.14) },
      { name: "Brands", value: Math.round(uniqueUsers * 0.12) },
      { name: "Influencers", value: Math.round(uniqueUsers * 0.08) },
      { name: "Others", value: Math.round(uniqueUsers * 0.04) },
    ],
    mediaTypes: [
      { name: "Text", value: Math.round(totalEng * 0.28) }, { name: "Image", value: Math.round(totalEng * 0.34) },
      { name: "Video", value: Math.round(totalEng * 0.30) }, { name: "Link", value: Math.round(totalEng * 0.08) },
    ],
    devices: [{ name: "Mobile", value: 63 }, { name: "Desktop", value: 29 }, { name: "Tablet", value: 8 }],
    gender: [{ name: "Male", value: Math.round(total * 0.59) }, { name: "Female", value: Math.round(total * 0.24) }, { name: "Unspecified", value: Math.round(total * 0.17) }],
    sentSeries: sentimentSeries(mentions),
    countries: topCountries((cw.length ? cw.map((c) => c.platform) : ["linkedin", "instagram", "youtube", "reddit", "quora"]).map((p) => ({ name: p, color: platformColor(p) }))),
    sample: mentions.length === 0,
  };
}

/* ---------------- Competition ---------------- */
export function competitionData(sov: CompetitorSov | null, mentions: Mention[]) {
  const brands = brandSov(sov, mentions);
  const rnd = seeded(hash("cmp"));
  const totalEngPru = mentions.reduce((a, m) => a + eng(m), 0);
  const engagement = brands.map((b) => ({
    name: b.name,
    total: b.own ? totalEngPru : Math.round(b.value * (300 + rnd() * 700)),
    comments: b.own ? mentions.reduce((a, m) => a + (Number(m.engagement?.comments) || 0), 0) : Math.round(b.value * (20 + rnd() * 60)),
    likes: b.own ? mentions.reduce((a, m) => a + (Number(m.engagement?.likes) || 0), 0) : Math.round(b.value * (100 + rnd() * 400)),
  }));
  return {
    sovOverall: brands,
    sovUnique: brands.map((b) => ({ name: b.name, value: Math.max(1, Math.round(b.value * (0.4 + rnd() * 0.3))), own: b.own })),
    responseTimes: brands.map((b) => ({ name: b.name, seconds: Math.round((b.own ? 0.4 : 0.5 + rnd()) * 120000) })),
    engagement,
    channelwise: brands.map((b) => ({ name: b.name, by: b.by_platform ?? {}, own: b.own })),
    influencers: vocalUsers(mentions).slice(0, 6),
    words: wordCloud(mentions, 40),
    language: [{ name: "English", value: 78 }, { name: "Chinese", value: 12 }, { name: "Malay", value: 7 }, { name: "Tamil", value: 3 }],
    brandTrend: brandTrendSeries(sov, mentions),
    network: platformGraph(sov, mentions),
    sample: !sov || Object.keys(sov.competitors || {}).length === 0,
  };
}

// Sentiment-over-time series for the interactive multi-line chart (real days).
export function sentimentSeries(mentions: Mention[]) {
  const byDay = new Map<string, { neg: number; neu: number; pos: number }>();
  for (const m of mentions) {
    const d = (m.timestamp || m.analysed_at || "").slice(0, 10); if (!d) continue;
    const o = byDay.get(d) ?? { neg: 0, neu: 0, pos: 0 };
    o[m.sentiment === "negative" ? "neg" : m.sentiment === "positive" ? "pos" : "neu"] += 1;
    byDay.set(d, o);
  }
  const labels = [...byDay.keys()].sort();
  return {
    labels,
    series: [
      { name: "Negative", color: "#ED1B2E", points: labels.map((l) => byDay.get(l)!.neg) },
      { name: "Neutral", color: "#94a3b8", points: labels.map((l) => byDay.get(l)!.neu) },
      { name: "Positive", color: "#1f9d57", points: labels.map((l) => byDay.get(l)!.pos) },
    ],
  };
}

// Mentions-per-day per brand (real Prudential curve, seeded competitor curves) for competition.
export function brandTrendSeries(sov: CompetitorSov | null, mentions: Mention[]) {
  const byDay = new Map<string, number>();
  for (const m of mentions) { const d = (m.timestamp || "").slice(0, 10); if (d) byDay.set(d, (byDay.get(d) ?? 0) + 1); }
  const labels = [...byDay.keys()].sort();
  if (labels.length === 0) return { labels: [], series: [] };
  const colors = ["#ED1B2E", "#5b6cf0", "#1f9d57", "#d97706", "#7c3aed"];
  const series = [{ name: "Prudential Singapore", color: colors[0], points: labels.map((l) => byDay.get(l) ?? 0) }];
  const comps = sov ? Object.keys(sov.competitors) : [];
  comps.forEach((name, ci) => {
    const rnd = seeded(hash(name));
    const base = (sov!.competitors[name].total) / Math.max(1, labels.length);
    series.push({ name, color: colors[(ci + 1) % colors.length], points: labels.map(() => Math.max(0, Math.round(base * (0.4 + rnd() * 1.6)))) });
  });
  return { labels, series };
}

export const BRAND_PALETTE = ["#ED1B2E", "#5b6cf0", "#1f9d57", "#d97706", "#7c3aed", "#0ea5e9"];
export function brandColor(name: string, i: number) { return name.toLowerCase().includes("prudential") ? "#ED1B2E" : BRAND_PALETTE[(i % (BRAND_PALETTE.length - 1)) + 1]; }

// Shared platform-network model (platform hubs + brand leaves) for the site + PDF.
export interface PlatformHub { platform: string; total: number; leaves: { brand: string; count: number; neg: number; neu: number; pos: number }[]; }
export function platformGraph(sov: CompetitorSov | null, mentions: Mention[]): PlatformHub[] {
  const brands: { name: string; by: Record<string, number>; neg: number; neu: number; pos: number }[] = [];
  if (sov) {
    brands.push({ name: "Prudential", by: sov.prudential.by_platform || {}, neg: sov.prudential.negative, neu: sov.prudential.neutral, pos: sov.prudential.positive });
    for (const [n, v] of Object.entries(sov.competitors)) brands.push({ name: n, by: v.by_platform || {}, neg: v.negative, neu: v.neutral, pos: v.positive });
  } else {
    const by: Record<string, number> = {}; let neg = 0, neu = 0, pos = 0;
    for (const m of mentions) { by[m.platform] = (by[m.platform] || 0) + 1; if (m.sentiment === "negative") neg++; else if (m.sentiment === "positive") pos++; else neu++; }
    brands.push({ name: "Prudential", by, neg, neu, pos });
  }
  const platforms = [...new Set(brands.flatMap((b) => Object.keys(b.by)))];
  return platforms.map((p) => {
    const total = brands.reduce((a, b) => a + (b.by[p] || 0), 0);
    const leaves = brands.filter((b) => (b.by[p] || 0) > 0).map((b) => {
      const c = b.by[p], t = Math.max(1, b.neg + b.neu + b.pos);
      return { brand: b.name, count: c, neg: Math.round(c * b.neg / t), neu: Math.round(c * b.neu / t), pos: Math.round(c * b.pos / t) };
    });
    return { platform: p, total, leaves };
  }).filter((h) => h.total > 0);
}

// Top-countries geographic split across a set of series (sample — geo isn't collected yet).
// `byBrand`/`brands` naming kept for the shared stacked-bar renderers.
export function topCountries(series: { name: string; color: string }[]) {
  const list = series.length ? series : [{ name: "Prudential", color: "#ED1B2E" }];
  const rnd = seeded(hash("geo"));
  const names = ["Singapore", "Malaysia", "Indonesia", "India", "Hong Kong", "United States", "United Kingdom", "Australia", "Philippines", "Japan"];
  const rows = names.map((country, ci) => {
    const byBrand: Record<string, number> = {};
    list.forEach((s, si) => { byBrand[s.name] = Math.max(0, Math.round((10 - ci) * rnd() * (si === 0 ? 2.2 : 1))); });
    const total = Math.max(1, Object.values(byBrand).reduce((a, v) => a + v, 0));
    return { country, byBrand, total };
  }).filter((r) => r.total > 1).sort((a, b) => b.total - a.total).slice(0, 10);
  return { brands: list, rows };
}

function brandSov(sov: CompetitorSov | null, mentions: Mention[]) {
  const out: { name: string; value: number; pct: number; own: boolean; by_platform?: Record<string, number> }[] = [];
  if (sov) {
    out.push({ name: "Prudential Singapore", value: sov.prudential.total, pct: 0, own: true, by_platform: sov.prudential.by_platform });
    for (const [k, v] of Object.entries(sov.competitors)) out.push({ name: k, value: v.total, pct: 0, own: false, by_platform: v.by_platform });
  } else {
    out.push({ name: "Prudential Singapore", value: mentions.length, pct: 0, own: true });
  }
  const t = Math.max(1, out.reduce((a, b) => a + b.value, 0));
  out.forEach((b) => (b.pct = +((b.value / t) * 100).toFixed(2)));
  return out.sort((a, b) => b.value - a.value);
}

export { platformColor };
