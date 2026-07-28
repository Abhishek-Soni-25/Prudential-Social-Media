import type { AuthorActivity, CaseFile, Channel, CompetitorSov, Mention, ScanStatus, Stats } from "./types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<{ status: string }>("/health"),
  stats: () => get<Stats>("/stats"),
  cases: (filters: Partial<Record<"severity" | "category" | "channel", string>> = {}) => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    const qs = q.toString();
    return get<CaseFile[]>(`/cases${qs ? `?${qs}` : ""}`);
  },
  channels: () => get<Channel[]>("/channels"),
  mentions: (filters: Partial<Record<"platform" | "sentiment" | "severity", string>> = {}) => {
    const q = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
    const qs = q.toString();
    return get<Mention[]>(`/mentions${qs ? `?${qs}` : ""}`);
  },
  authors: (platform = "") =>
    get<AuthorActivity[]>(`/authors${platform ? `?platform=${platform}` : ""}`),
  sentiment: () => get<Record<string, Record<string, number>>>("/sentiment"),
  competitors: () => get<CompetitorSov>("/competitors"),
  keywords: () => get<{ base: string[]; custom: string[] }>("/keywords"),
  saveKeywords: async (custom: string[]) => {
    const res = await fetch(`${BASE}/keywords`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ custom }) });
    return res.json() as Promise<{ base: string[]; custom: string[] }>;
  },
  publishReply: async (payload: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/publish/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return res.json();
  },
  publishPost: async (payload: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/publish/post`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return res.json();
  },
  startCompetitorScan: async (): Promise<{ started: boolean; reason?: string }> => {
    const res = await fetch(`${BASE}/scan/competitors`, { method: "POST" });
    return res.json();
  },
  live: () => get<{ items: CaseFile[]; error?: string }>("/live"),
  scanStatus: () => get<ScanStatus>("/scan/status"),
  startScan: async (): Promise<{ started: boolean; reason?: string }> => {
    const res = await fetch(`${BASE}/scan`, { method: "POST" });
    return res.json();
  },
  complianceSuggest: async (draft: string, count = 6): Promise<{ suggestions: string[] }> => {
    const res = await fetch(`${BASE}/compliance/suggest`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft, count }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  },
  complianceNotify: async (payload: { author: string; status: string; channel?: string; mentionId?: string }) => {
    const res = await fetch(`${BASE}/compliance/notify`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return res.json() as Promise<{ ok: boolean; message: string }>;
  },
};
