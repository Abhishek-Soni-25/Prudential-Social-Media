import type { AuthorActivity } from "../types";

// "Most active accounts" — how many times each account has posted about the keyword, with a
// sentiment split and a click-through to their latest post for verification.
export function TopAccounts({ authors }: { authors: AuthorActivity[] }) {
  const rows = authors.slice(0, 12);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Most active accounts</h3>
        <span className="count">by posts about the keyword</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">No accounts yet. Run a scan to collect mentions.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Platform</th>
              <th style={{ textAlign: "right" }}>Posts</th>
              <th>Sentiment (neg · neu · pos)</th>
              <th>Flagged</th>
              <th>Verify</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={`${a.platform}:${a.author}`}>
                <td className="mono">
                  {a.author_url ? (
                    <a className="link" href={a.author_url} target="_blank" rel="noreferrer">{a.author}</a>
                  ) : (
                    a.author
                  )}
                </td>
                <td className="cap">{a.platform}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{a.posts}</td>
                <td>
                  <span style={{ color: "var(--high)" }}>{a.negative}</span> ·{" "}
                  <span style={{ color: "var(--ink-faint)" }}>{a.neutral}</span> ·{" "}
                  <span style={{ color: "var(--ok)" }}>{a.positive}</span>
                </td>
                <td style={{ color: a.flagged ? "var(--high)" : "var(--ink-faint)", fontWeight: a.flagged ? 700 : 400 }}>
                  {a.flagged}
                </td>
                <td>
                  {a.latest_url ? (
                    <a className="link" href={a.latest_url} target="_blank" rel="noreferrer">Open latest ↗</a>
                  ) : (
                    <span className="muted">n/a</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
