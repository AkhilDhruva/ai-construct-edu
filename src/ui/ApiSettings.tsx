import { useState } from 'react'
import { useMantle } from '../state/useMantle'

/** Settings → API mode: connect, sign in, budget and sync. Everything here is optional. */
export function ApiSettings() {
  const { apiUrl, health, reachable, account, sync, auth, connectApi, signInDev, signInOAuth, signInEmail, signOut, syncNow } = useMantle()
  const [url, setUrl] = useState(apiUrl ?? '')
  const [devUser, setDevUser] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | undefined>()
  const busy = sync.status === 'syncing'
  const guard = (fn: () => Promise<void>) => async () => {
    setMessage(undefined)
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const status = !apiUrl
    ? 'Not configured: everything works offline.'
    : reachable && health
      ? `Connected to ${apiUrl} · API v${health.version} · models: ${health.models.mode}${health.models.mode === 'live' ? ` (${health.models.primary}, standby ${health.models.standby})` : ''}`
      : `Unreachable: ${apiUrl}. Offline mode is on and the app keeps working; it re-checks every 30 seconds.`

  return (
    <section className="card stack" aria-labelledby="api-h" data-testid="api-settings">
      <h2 id="api-h">API mode (optional)</h2>
      <p className="small muted">
        API mode adds sync across devices, the AI tutor, rubric grading and the live prompt coach. Without it Mantle is a complete offline app.
      </p>
      <p className="small" role="status" data-testid="api-status">
        {status}
      </p>
      {health?.models.mode === 'mock' && <span className="badge badge-info">mock model: deterministic, no AI provider calls</span>}

      <div className="row" style={{ alignItems: 'end' }}>
        <div className="field" style={{ flex: '1 1 280px' }}>
          <label htmlFor="api-url">API URL</label>
          <input id="api-url" type="text" inputMode="url" placeholder="https://api.example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <button type="button" className="btn" onClick={guard(() => connectApi(url.trim() || undefined))}>
          {url.trim() ? 'Connect' : 'Use default'}
        </button>
      </div>

      {reachable && health && !account && (
        <div className="stack">
          <h3>Sign in to sync</h3>
          {health.auth.mode === 'dev' ? (
            <div className="row" style={{ alignItems: 'end' }}>
              <div className="field" style={{ flex: '1 1 220px' }}>
                <label htmlFor="dev-user">Development user</label>
                <input id="dev-user" type="text" value={devUser} onChange={(e) => setDevUser(e.target.value)} placeholder="alice" />
                <span className="field-help">This API runs in development auth mode, which a production API refuses.</span>
              </div>
              <button type="button" className="btn btn-primary" disabled={devUser.trim().length < 3} onClick={guard(() => signInDev(devUser.trim()))}>
                Sign in (dev)
              </button>
            </div>
          ) : auth?.mode === 'supabase' ? (
            <div className="stack">
              <div className="row">
                <button type="button" className="btn" onClick={guard(() => signInOAuth('github'))}>
                  Continue with GitHub
                </button>
                <button type="button" className="btn" onClick={guard(() => signInOAuth('google'))}>
                  Continue with Google
                </button>
              </div>
              <div className="row" style={{ alignItems: 'end' }}>
                <div className="field" style={{ flex: '1 1 220px' }}>
                  <label htmlFor="email">Email (magic link)</label>
                  <input id="email" type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={!email.includes('@')}
                  onClick={guard(async () => {
                    await signInEmail(email.trim())
                    setMessage('Check your inbox for the sign-in link.')
                  })}
                >
                  Send link
                </button>
              </div>
              <p className="small muted">OAuth 2.1 with PKCE between this browser and the identity provider; the API only sees the signed token.</p>
            </div>
          ) : (
            <p className="small">Sign-in is not configured for this build: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
          )}
        </div>
      )}

      {account && (
        <div className="stack" data-testid="account">
          <p>
            Signed in as <strong>{account.sub}</strong> · role {account.role} · learner <code>{account.learnerId}</code>
          </p>
          <div>
            <div className="small muted">
              AI budget today: {account.budget.usedTokens.toLocaleString()} of {account.budget.limitTokens.toLocaleString()} tokens
            </div>
            <div className="meter" role="meter" aria-label="AI budget used today" aria-valuemin={0} aria-valuemax={account.budget.limitTokens} aria-valuenow={account.budget.usedTokens}>
              <span style={{ width: `${Math.min(100, (account.budget.usedTokens / account.budget.limitTokens) * 100)}%` }} />
            </div>
          </div>
          <p className="small" data-testid="sync-status">
            {sync.status === 'syncing'
              ? 'Syncing…'
              : sync.status === 'error'
                ? `Last sync failed: ${sync.error}`
                : sync.at
                  ? `Last synced ${new Date(sync.at).toLocaleTimeString()}${sync.added ? ` · ${sync.added} new rows from the server` : ''}. Sync runs a few seconds after each change; merging never overwrites.`
                  : 'Not synced yet.'}
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={guard(syncNow)}>
              Sync now
            </button>
            <button type="button" className="btn" onClick={guard(signOut)}>
              Sign out
            </button>
          </div>
        </div>
      )}
      {message && (
        <div className="callout callout-warn small" role="status">
          {message}
        </div>
      )}
    </section>
  )
}
