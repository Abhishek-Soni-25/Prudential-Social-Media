import type { Severity } from "../types";

export const SEV_COLORS: Record<Severity, string> = {
  HIGH: "var(--high)",
  MEDIUM: "var(--medium)",
  LOW: "var(--low)",
  NONE: "#94a3b8",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const label = severity === "NONE" ? "NO RISK" : severity;
  return (
    <span className={`badge sev-${severity}`}>
      <span className="pip" style={{ background: SEV_COLORS[severity] }} />
      {label}
    </span>
  );
}

export function CategoryChip({ category }: { category: string }) {
  if (!category || category === "NONE" || category === "GENERAL")
    return <span className="cat-chip general">general</span>;
  return <span className="cat-chip">{category.replace(/_/g, " ")}</span>;
}

const SENT_COLOR: Record<string, string> = {
  negative: "var(--high)", positive: "var(--ok)", neutral: "var(--ink-faint)", mixed: "var(--medium)",
};

export function SentimentTag({ polarity }: { polarity: string }) {
  const key = (polarity || "neutral").toLowerCase();
  return <span style={{ color: SENT_COLOR[key] ?? "var(--ink-faint)", fontWeight: 600 }}>{polarity}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  return (
    <span>
      <span className="conf-bar">
        <span className="conf-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      {Math.round(value * 100)}%
    </span>
  );
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
