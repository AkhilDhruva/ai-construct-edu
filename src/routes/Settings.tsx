import { useState } from 'react'
import { useNavigate } from 'react-router'
import { RUNG_INFO } from '../mantle/session/rung'
import type { MergeReport } from '../mantle/store/sync'
import { useMantle } from '../state/useMantle'
import { RungBadge } from '../ui/primitives'

export function Settings() {
  const { learner, rung, flags, storage, run, content, authorMode, setAuthorMode } = useMantle()
  const navigate = useNavigate()
  const [exportPass, setExportPass] = useState('')
  const [importPass, setImportPass] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [message, setMessage] = useState<{ tone: 'ok' | 'danger'; text: string } | undefined>()
  const [confirmReset, setConfirmReset] = useState(false)

  const doExport = async () => {
    const bundle = await run((rt) => rt.exportBundle(exportPass || undefined))
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mantle-${learner?.id}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage({ tone: 'ok', text: exportPass ? 'Exported an encrypted, signed bundle.' : 'Exported a plain bundle with a checksum. Add a passphrase to encrypt it.' })
  }

  const doImport = async () => {
    if (!file) return
    try {
      const json = JSON.parse(await file.text())
      const r: MergeReport = await run((rt) => rt.importBundle(json, importPass || undefined))
      setMessage({
        tone: 'ok',
        text: `Imported. Learner profile: ${r.learner}. Added ${r.attempts} attempts, ${r.mastery} mastery versions, ${r.cardStates} card states, ${r.events} spans. Nothing was overwritten.`,
      })
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const doReset = async () => {
    await run((rt) => rt.reset())
    setConfirmReset(false)
    navigate('/onboarding')
  }

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <h1>Settings</h1>
      {message && (
        <div className={`callout callout-${message.tone}`} role={message.tone === 'danger' ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}

      <section className="card stack" aria-labelledby="id-h">
        <h2 id="id-h">Identity</h2>
        <div>
          <div className="small muted">Learner ID (ULID, created in this browser)</div>
          <code data-testid="settings-learner-id">{learner?.id}</code>
        </div>
        <p className="small muted">
          Offline mode collects no personal data. Telemetry is keyed on this ID only. In API mode the same ID is bound to a sign-in on first login, so nothing is
          lost.
        </p>
      </section>

      <section className="card stack" aria-labelledby="move-h">
        <h2 id="move-h">Move to another device</h2>
        <div className="grid grid-2">
          <div className="stack">
            <h3>Export</h3>
            <div className="field">
              <label htmlFor="export-pass">Passphrase (optional)</label>
              <input id="export-pass" type="password" autoComplete="new-password" value={exportPass} onChange={(e) => setExportPass(e.target.value)} />
              <span className="field-help">With a passphrase the bundle is AES-GCM encrypted and HMAC-signed, so a tampered bundle is rejected.</span>
            </div>
            <button type="button" className="btn btn-primary" onClick={doExport}>
              Download bundle
            </button>
          </div>
          <div className="stack">
            <h3>Import</h3>
            <div className="field">
              <label htmlFor="import-file">Bundle file</label>
              <input id="import-file" type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0])} />
            </div>
            <div className="field">
              <label htmlFor="import-pass">Passphrase (if the bundle has one)</label>
              <input id="import-pass" type="password" autoComplete="current-password" value={importPass} onChange={(e) => setImportPass(e.target.value)} />
            </div>
            <button type="button" className="btn" disabled={!file} onClick={doImport}>
              Import and merge
            </button>
            <span className="field-help">Merging is by union: append-only history from both sides is kept.</span>
          </div>
        </div>
      </section>

      <section className="card stack" aria-labelledby="mode-h">
        <h2 id="mode-h">Mode and degradation ladder</h2>
        <div>
          <RungBadge rung={rung} />
        </div>
        <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
          {([0, 1, 2, 3, 4] as const).map((r) => (
            <li key={r} value={r} style={{ fontWeight: r === rung ? 700 : 400 }}>
              {RUNG_INFO[r].label}: {RUNG_INFO[r].detail}
            </li>
          ))}
        </ol>
        <p className="small">
          Capabilities: {Object.entries(flags ?? {})
            .map(([k, v]) => `${k} ${v ? 'on' : 'off'}`)
            .join(' · ')}
          . Flags turn on only when the API health probe passes.
        </p>
        <p className="small muted">
          Storage: {storage === 'dexie' ? 'IndexedDB in this browser' : 'memory only (IndexedDB is blocked here, so progress is lost on reload)'} · content:{' '}
          {content.packages.map((p) => `${p.manifest.id}@${p.manifest.version}`).join(', ')} · engine: {content.rules.strategy}
        </p>
      </section>

      <section className="card stack" aria-labelledby="author-h">
        <h2 id="author-h">Author tools</h2>
        <label className="row" style={{ gap: 8, fontWeight: 400 }}>
          <input type="checkbox" checked={authorMode} onChange={(e) => setAuthorMode(e.target.checked)} data-testid="author-mode" />
          Show the content studio in navigation
        </label>
        <p className="small muted">
          The studio validates and previews content drafts and shows item health. In API mode it is limited to the admin role; offline it is a local view of the
          content that ships with the app.
        </p>
      </section>

      <section className="card stack" aria-labelledby="reset-h">
        <h2 id="reset-h">Start over</h2>
        <p className="small muted">Deletes this learner's local data and creates a new ID. Export first if you might want it back.</p>
        {!confirmReset ? (
          <div>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmReset(true)}>
              Reset this learner
            </button>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn btn-danger" onClick={doReset}>
              Yes, delete local progress
            </button>
            <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
