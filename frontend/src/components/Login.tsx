import { useState } from "react";

// Demo credentials for the prototype. (For a real deployment, authenticate server-side.)
const EMAIL = "pru@kpmg.com";
const PASSWORD = "Pru123";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim().toLowerCase() === EMAIL && password === PASSWORD) {
      setError(null);
      onSuccess();
    } else {
      setError("Incorrect email or password. Please try again.");
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <img src="/prudential-singapore.png" alt="Prudential Singapore" className="login-logo" />
        <h1 className="login-title">Social Media Surveillance &amp; Media Compliance</h1>
        <p className="login-sub">Sign in to continue to the risk console</p>

        <label className="login-label" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          className="login-input"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          placeholder="you@company.com"
          autoComplete="username"
          autoFocus
        />

        <label className="login-label" htmlFor="login-password">Password</label>
        <div className="login-pw">
          <input
            id="login-password"
            className="login-input"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          <button type="button" className="login-eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {error && <div className="login-error">⚠ {error}</div>}

        <button className="btn login-btn" type="submit">Sign in</button>

        <div className="login-foot">Prudential Singapore · Authorized users only</div>
      </form>
    </div>
  );
}
