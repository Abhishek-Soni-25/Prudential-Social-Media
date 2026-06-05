import type { CaseFile, Channel, ScanStatus, Stats } from "./types";

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
  live: () => get<{ items: CaseFile[]; error?: string }>("/live"),
  scanStatus: () => get<ScanStatus>("/scan/status"),
  startScan: async (): Promise<{ started: boolean; reason?: string }> => {
    const res = await fetch(`${BASE}/scan`, { method: "POST" });
    return res.json();
  },
};
