import { useMemo, useState } from "react";
import type { AuthorActivity } from "../types";
import { platformColor } from "../analytics";
import { TopAccounts } from "../components/TopAccounts";

// "Accounts" (Locobuzz Influencer analogue): how often each account posts about the keyword.
export function Accounts({ authors }: { authors: AuthorActivity[] }) {
  const [platform, setPlatform] = useState("");
  const platforms = useMemo(() => [...new Set(authors.map((a) => a.platform))], [authors]);
  const rows = platform ? authors.filter((a) => a.platform === platform) : authors;

  const totalPosts = rows.reduce((s, a) => s + a.posts, 0);
  const repeat = rows.filter((a) => a.posts > 1).length;
  const negativeAccts = rows.filter((a) => a.negative > 0).length;

  return (
    <>
      <div className="cards">
        <Kpi k="Unique accounts" v={rows.length} accent="var(--brand)" />
        <Kpi k="Total posts" v={totalPosts} accent="#0A66C2" />
        <Kpi k="Repeat posters" v={repeat} accent="var(--medium)" sub="posted more than once" />
        <Kpi k="Accounts w/ negative" v={negativeAccts} accent="var(--high)" />
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h3>Filter by platform</h3>
          <div className="filters">
            <button className={`chip ${!platform ? "chip-on" : ""}`} onClick={() => setPlatform("")}>All</button>
            {platforms.map((p) => (
              <button key={p} className={`chip ${platform === p ? "chip-on" : ""}`}
                style={platform === p ? { background: platformColor(p), color: "#fff", borderColor: platformColor(p) } : {}}
                onClick={() => setPlatform(p)}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      <TopAccounts authors={rows} />
    </>
  );
}

function Kpi({ k, v, accent, sub }: { k: string; v: number; accent: string; sub?: string }) {
  return (
    <div className="card">
      <div className="k"><span className="accent" style={{ background: accent }} />{k}</div>
      <div className="v" style={{ color: accent }}>{v}</div>
      {sub && <div className="ic-sub">{sub}</div>}
    </div>
  );
}
