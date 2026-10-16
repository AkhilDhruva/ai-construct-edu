import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { loadContent, publicationIssues, type ContentIssue, type ContentRegistry } from '../mantle/content/load'
import { loadContentFiles } from '../mantle/content/registry'
import type { Card, Concept, Depth } from '../mantle/content/schemas'
import { activityByDay, bumpVersion, itemHealth } from '../mantle/studio/analytics'
import type { TelemetryEvent } from '../mantle/store/types'
import { useMantle } from '../state/useMantle'

type Tab = 'validate' | 'edit' | 'health' | 'activity'
const DRAFT_PREFIX = 'mantle:studio-draft:'

function readDraft(path: string): string | undefined {
  try {
    return localStorage.getItem(DRAFT_PREFIX + path) ?? undefined
  } catch {
    return undefined
  }
}
function writeDraft(path: string, text: string | undefined) {
  try {
    if (text === undefined) localStorage.removeItem(DRAFT_PREFIX + path)
    else localStorage.setItem(DRAFT_PREFIX + path, text)
  } catch {
    /* drafts are a per-browser convenience */
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function Issues({ title, issues, tone }: { title: string; issues: ContentIssue[]; tone: 'danger' | 'warn' }) {
  if (!issues.length) return null
  return (
    <div className={`callout callout-${tone}`}>
      <strong>
        {title} ({issues.length})
      </strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {issues.map((i, n) => (
          <li key={n} className="small">
            <code>{i.where}</code>: {i.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ValidateTab({ registry }: { registry: ContentRegistry }) {
  const publication = useMemo(() => publicationIssues(registry), [registry])
  const green = registry.errors.length === 0 && publication.length === 0
  return (
    <div className="stack">
      <div className={`callout ${green ? 'callout-ok' : 'callout-danger'}`} role="status" data-testid="studio-gates">
        <strong>{green ? 'All gates green: content is publishable.' : 'Content has blocking issues.'}</strong> The same checks run in CI: schema, references, cross-tentacle
        prerequisites, acyclicity, three cards per objective and the language check.
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Tentacle</th>
              <th scope="col">Version</th>
              <th scope="col">Audience</th>
              <th scope="col">Concepts</th>
              <th scope="col">Cards</th>
              <th scope="col">Checks</th>
              <th scope="col">Drills</th>
              <th scope="col">Labs</th>
            </tr>
          </thead>
          <tbody>
            {registry.packages.map((p) => (
              <tr key={p.manifest.id}>
                <td>{p.manifest.title}</td>
                <td className="mono">{p.manifest.version}</td>
                <td>{p.manifest.audience.join(', ')}</td>
                <td className="mono">{p.concepts.length}</td>
                <td className="mono">{p.cards.length}</td>
                <td className="mono">{p.checks.length}</td>
                <td className="mono">{p.drills.length}</td>
                <td>{p.labs.map((l) => l.ref.engine).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Diagnostics: {Object.entries(registry.diagnostics)
          .map(([t, d]) => `${t} (${d!.items.length} items)`)
          .join(', ')}{' '}
        · engine rules {registry.rules.strategy}
      </p>
      <Issues title="Errors" issues={registry.errors} tone="danger" />
      <Issues title="Publication gates" issues={publication} tone="danger" />
      <Issues title="Warnings" issues={registry.warnings} tone="warn" />
    </div>
  )
}

function ConceptPreview({ c }: { c: Concept }) {
  return (
    <div className="stack">
      <h3>{c.title}</h3>
      <p className="lede">{c.point}</p>
      <p className="small">
        <strong>Objective:</strong> {c.objective.text}
      </p>
      {(['l1', 'l2', 'l3'] as const).map((l) => (
        <div key={l}>
          <div className="eyebrow">{l.toUpperCase()}</div>
          {c.layers[l].map((p, i) => (
            <p key={i} className="small">
              {p}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

function CardForm({ concepts, cards, onAdd }: { concepts: Concept[]; cards: Card[]; onAdd: (c: Card) => void }) {
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? '')
  const [depth, setDepth] = useState<Depth>(1)
  const [kind, setKind] = useState<Card['kind']>('recall')
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const prefix = cards[0]?.id.replace(/\d+$/, '') ?? 'card-'
  const width = cards[0]?.id.match(/\d+$/)?.[0].length ?? 3
  const nextNum = Math.max(0, ...cards.map((c) => Number(c.id.match(/\d+$/)?.[0] ?? 0))) + 1
  const id = `${prefix}${String(nextNum).padStart(width, '0')}`
  return (
    <fieldset>
      <legend>Add a card (form over the card schema)</legend>
      <div className="grid grid-3">
        <div className="field">
          <label htmlFor="cf-concept">Concept</label>
          <select id="cf-concept" value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cf-depth">Depth</label>
          <select id="cf-depth" value={depth} onChange={(e) => setDepth(Number(e.target.value) as Depth)}>
            <option value={1}>L1 recall</option>
            <option value={2}>L2 apply</option>
            <option value={3}>L3 design</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="cf-kind">Kind</label>
          <select id="cf-kind" value={kind} onChange={(e) => setKind(e.target.value as Card['kind'])}>
            <option value="recall">recall</option>
            <option value="apply">apply</option>
            <option value="cloze">cloze</option>
          </select>
        </div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="cf-front">Front</label>
        <input id="cf-front" type="text" value={front} onChange={(e) => setFront(e.target.value)} />
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label htmlFor="cf-back">Back</label>
        <input id="cf-back" type="text" value={back} onChange={(e) => setBack(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn btn-sm"
        style={{ marginTop: 8 }}
        disabled={!front.trim() || !back.trim() || !conceptId}
        onClick={() => {
          onAdd({ id, conceptId, depth, kind, front: front.trim(), back: back.trim(), tags: [] })
          setFront('')
          setBack('')
        }}
      >
        Add card {id}
      </button>
    </fieldset>
  )
}

function EditTab({ files }: { files: Record<string, unknown> }) {
  const paths = useMemo(() => Object.keys(files).sort(), [files])
  const [path, setPath] = useState(paths.find((p) => p.endsWith('cards.json')) ?? paths[0])
  const original = useMemo(() => JSON.stringify(files[path], null, 2), [files, path])
  const [text, setText] = useState(() => readDraft(path) ?? original)

  useEffect(() => {
    setText(readDraft(path) ?? original)
  }, [path, original])

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }, [text])

  const sandbox = useMemo(() => {
    if (!parsed.ok) return undefined
    try {
      const reg = loadContent({ ...files, [path]: parsed.value })
      return { reg, publication: publicationIssues(reg) }
    } catch (e) {
      return { reg: undefined, fatal: e instanceof Error ? e.message : String(e), publication: [] as ContentIssue[] }
    }
  }, [files, path, parsed])

  const dir = path.split('/').slice(0, 2).join('/')
  const relevant = (i: ContentIssue) => i.where.startsWith(dir) || i.where === path || i.where.includes(path) || i.where === 'concept graph'
  const errors = sandbox?.reg ? sandbox.reg.errors.filter(relevant) : []
  const publication = sandbox?.publication ?? []
  const dirty = text !== original
  const tentacleId = path.startsWith('tentacles/') ? path.split('/')[1] : undefined
  const pkg = sandbox?.reg?.packages.find((p) => p.manifest.id === tentacleId)
  const fileName = path.split('/').pop()!

  const update = (next: string) => {
    setText(next)
    writeDraft(path, next === original ? undefined : next)
  }

  let preview: React.ReactNode = <p className="small muted">No preview for this file type.</p>
  if (parsed.ok && path.includes('/concepts/') && pkg) {
    const c = pkg.concepts.find((x) => `${dir}/concepts/${x.id}.json` === path)
    if (c) preview = <ConceptPreview c={c} />
  } else if (parsed.ok && fileName === 'cards.json' && pkg) {
    preview = (
      <div className="stack">
        <CardForm
          concepts={pkg.concepts}
          cards={pkg.cards}
          onAdd={(card) => {
            const v = parsed.value as { cards: Card[] }
            update(JSON.stringify({ ...v, cards: [...v.cards, card] }, null, 2))
          }}
        />
        <ol className="small">
          {pkg.cards.map((c) => (
            <li key={c.id}>
              <strong>{c.front}</strong> → {c.back} <span className="muted">({c.conceptId}, L{c.depth})</span>
            </li>
          ))}
        </ol>
      </div>
    )
  } else if (parsed.ok && fileName === 'checks.json' && pkg) {
    preview = (
      <ol className="small">
        {pkg.checks.map((i) => (
          <li key={i.id}>
            <strong>{i.stem}</strong> <span className="muted">({i.kind}, {i.conceptId}, L{i.depth})</span>
          </li>
        ))}
      </ol>
    )
  } else if (parsed.ok && fileName === 'manifest.json' && pkg) {
    const v = pkg.manifest.version
    preview = (
      <div className="stack">
        <p>
          <strong>{pkg.manifest.title}</strong> v{v} · {pkg.manifest.concepts && `${pkg.concepts.length} concepts`} · route <code>{pkg.manifest.route}</code>
        </p>
        <p className="small muted">Packages are immutable per version. Bump the version for any change you publish; learners' plans re-plan and explain why.</p>
        <div className="row">
          {(['patch', 'minor', 'major'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="btn btn-sm"
              onClick={() => update(JSON.stringify({ ...(parsed.value as object), version: bumpVersion(v, k) }, null, 2))}
            >
              {k} → {bumpVersion(v, k)}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      <div className="row">
        <div className="field" style={{ minWidth: 320, flex: 1 }}>
          <label htmlFor="studio-file">File</label>
          <select id="studio-file" value={path} onChange={(e) => setPath(e.target.value)}>
            {paths.map((p) => (
              <option key={p} value={p}>
                {p}
                {readDraft(p) !== undefined ? ' (draft)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ alignSelf: 'end' }}>
          <button type="button" className="btn btn-sm" disabled={!dirty} onClick={() => update(original)}>
            Discard draft
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!parsed.ok} onClick={() => download(fileName, text.endsWith('\n') ? text : `${text}\n`)}>
            Download {fileName}
          </button>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="stack">
          <div className="field">
            <label htmlFor="studio-json">JSON {dirty && <span className="badge badge-warn">unsaved draft</span>}</label>
            <textarea id="studio-json" className="mono" style={{ minHeight: 460, fontSize: 13 }} spellCheck={false} value={text} onChange={(e) => update(e.target.value)} />
          </div>
          <div aria-live="polite" data-testid="studio-validation">
            {!parsed.ok ? (
              <div className="callout callout-danger">
                <strong>Not valid JSON.</strong> {parsed.error}
              </div>
            ) : sandbox && 'fatal' in sandbox && sandbox.fatal ? (
              <div className="callout callout-danger">{sandbox.fatal}</div>
            ) : errors.length === 0 && publication.length === 0 ? (
              <div className="callout callout-ok">
                <strong>Valid.</strong> Schema, references and publication gates pass with this draft in place.
              </div>
            ) : (
              <>
                <Issues title="Errors with this draft" issues={errors} tone="danger" />
                <Issues title="Publication gates" issues={publication} tone="danger" />
              </>
            )}
          </div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="eyebrow">Preview</div>
          {preview}
        </div>
      </div>
      <p className="small muted">
        The studio validates drafts with the same code as CI and keeps them in this browser. Publishing is a pull request: download the file, commit it, and CI
        re-runs every gate.
      </p>
    </div>
  )
}

function HealthTab() {
  const { attempts, content } = useMantle()
  const [minSample, setMin] = useState(3)
  const rows = useMemo(() => itemHealth(attempts, minSample), [attempts, minSample])
  const label = (id: string) =>
    content.checks.get(id)?.stem ?? content.cards.get(id)?.front ?? content.labs.get(id.split(':')[0])?.ref.title ?? id
  return (
    <div className="stack">
      <p className="small muted">
        Pass rate per item from recorded evidence. Items under 40% or over 95% are flagged for a rewrite once they have at least {minSample} attempts. Offline this
        is your own history; in API mode the same analysis runs across all learners.
      </p>
      <div className="field" style={{ maxWidth: 220 }}>
        <label htmlFor="min-sample">Minimum attempts to flag: {minSample}</label>
        <input id="min-sample" type="range" min={1} max={20} value={minSample} onChange={(e) => setMin(Number(e.target.value))} />
      </div>
      {rows.length === 0 ? (
        <p className="muted">No evidence yet. Answer some checks or review cards first.</p>
      ) : (
        <div className="table-wrap">
          <table data-testid="item-health">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Kind</th>
                <th scope="col">Attempts</th>
                <th scope="col">Pass rate</th>
                <th scope="col">Median time</th>
                <th scope="col">Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td>
                    <div>{label(r.itemId)}</div>
                    <div className="small muted mono">{r.itemId}</div>
                  </td>
                  <td>{r.kind}</td>
                  <td className="mono">{r.attempts}</td>
                  <td className="mono">{Math.round(r.passRate * 100)}%</td>
                  <td className="mono">{(r.medianLatencyMs / 1000).toFixed(1)} s</td>
                  <td>{r.flag ? <span className={`badge ${r.flag === 'too-hard' ? 'badge-danger' : 'badge-warn'}`}>{r.flag}</span> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ActivityTab() {
  const { rt, attempts } = useMantle()
  const [events, setEvents] = useState<TelemetryEvent[]>([])
  useEffect(() => {
    if (rt) void rt.store.events.query({ learnerId: rt.learner.id }).then(setEvents)
  }, [rt, attempts.length])
  const days = useMemo(() => activityByDay(events, attempts), [events, attempts])
  return (
    <div className="stack">
      <p className="small muted">Adoption telemetry: learner steps and evidence per day, built from the same spans the trace view shows.</p>
      <div style={{ width: '100%', height: 220 }} aria-hidden="true">
        <ResponsiveContainer>
          <BarChart data={days} accessibilityLayer={false} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <Bar dataKey="steps" fill="var(--accent)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Sessions</th>
              <th scope="col">Steps</th>
              <th scope="col">Attempts</th>
              <th scope="col">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td className="mono">{d.sessions}</td>
                <td className="mono">{d.steps}</td>
                <td className="mono">{d.attempts}</td>
                <td className="mono">{Math.round(d.passRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Studio() {
  const [files, setFiles] = useState<Record<string, unknown> | undefined>()
  useEffect(() => {
    void loadContentFiles().then(setFiles)
  }, [])
  const registry = useMantle((s) => s.content)
  const [tab, setTab] = useState<Tab>('validate')
  const TABS: Array<[Tab, string]> = [
    ['validate', 'Validate'],
    ['edit', 'Edit'],
    ['health', 'Item health'],
    ['activity', 'Activity'],
  ]
  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Author</div>
        <h1>Content studio</h1>
        <p className="lede">Write, validate and preview tentacle content, then see which items need a rewrite.</p>
      </div>
      <div className="tabs" role="tablist" aria-label="Studio sections">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" id={`studio-tab-${id}`} aria-controls="studio-panel" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="studio-panel" aria-labelledby={`studio-tab-${tab}`}>
        {tab === 'validate' && <ValidateTab registry={registry} />}
        {tab === 'edit' && (files ? <EditTab files={files} /> : <p role="status">Loading content…</p>)}
        {tab === 'health' && <HealthTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </div>
  )
}
