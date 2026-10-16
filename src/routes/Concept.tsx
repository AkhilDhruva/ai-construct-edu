import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Depth } from '../mantle/content/schemas'
import { useMantle } from '../state/useMantle'
import { CheckRunner } from '../ui/CheckRunner'
import { DepthBadge, MasteryBar } from '../ui/primitives'
import { usePackage } from './usePackage'

const LAYER_NAME: Record<Depth, string> = { 1: 'L1 · Recall', 2: 'L2 · Apply', 3: 'L3 · Design' }

export function Concept() {
  const pkg = usePackage()
  const { concept: conceptId } = useParams()
  const { content, mastery, plan, run } = useMantle()
  const concept = pkg?.concepts.find((c) => c.id === conceptId)
  const planned = plan?.items.find((i) => i.conceptId === conceptId)
  const T = content.rules.masteryThreshold
  const m = (id: string) => mastery[id] ?? content.rules.bkt.prior
  const recommended: Depth = planned?.depth ?? (concept && m(concept.id) >= T ? 3 : 2)
  const [depth, setDepth] = useState<Depth>(recommended)

  useEffect(() => {
    setDepth(recommended)
    // Introduce once per visit; cards enter review on the first visit only.
    if (concept) void run((rt) => rt.introduceConcept(concept.id, recommended))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept?.id])

  if (!pkg || !concept) return <p>Unknown concept.</p>
  const { manifest } = pkg
  const checks = pkg.checks.filter((c) => c.conceptId === concept.id)
  const labs = manifest.labs.filter((l) => concept.labs.includes(l.id))
  const unmet = concept.prerequisites.filter((p) => m(p) < T)

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Plan</Link> / <Link to={manifest.route}>{manifest.title}</Link> / {concept.title}
      </nav>

      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px' }}>
          <div className="eyebrow">Concept · level {concept.level}</div>
          <h1>{concept.title}</h1>
          <p className="lede">{concept.point}</p>
        </div>
        <div className="card" style={{ minWidth: 220, padding: 14 }}>
          <div className="small muted">Your mastery</div>
          <MasteryBar value={m(concept.id)} label={`Mastery of ${concept.title}`} />
          {planned && (
            <div className="small" style={{ marginTop: 8 }}>
              Recommended depth: <DepthBadge depth={planned.depth} />
            </div>
          )}
        </div>
      </div>

      {unmet.length > 0 && (
        <div className="callout callout-warn">
          Prerequisites not yet mastered:{' '}
          {unmet.map((p, i) => (
            <span key={p}>
              {i > 0 && ', '}
              <Link to={`/t/${content.concepts.get(p)!.tentacle}/c/${p}`}>{content.concepts.get(p)!.title}</Link>
            </span>
          ))}
          . You can continue, but these come first in your plan.
        </div>
      )}

      <section className="card" aria-labelledby="explainer-h">
        <h2 id="explainer-h" className="sr-only">
          Explainer
        </h2>
        <div className="callout" style={{ marginBottom: 16 }}>
          <strong>Objective.</strong> {concept.objective.text}
        </div>
        <p>
          <strong>Definition.</strong> {concept.definition}
        </p>
        <div className="tabs" role="tablist" aria-label="Depth layer">
          {([1, 2, 3] as Depth[]).map((d) => (
            <button key={d} role="tab" id={`tab-l${d}`} aria-controls="layer-panel" aria-selected={depth === d} onClick={() => setDepth(d)}>
              {LAYER_NAME[d]}
              {d === recommended ? ' ★' : ''}
            </button>
          ))}
        </div>
        <div id="layer-panel" role="tabpanel" aria-labelledby={`tab-l${depth}`} className="prose" data-testid="explainer">
          {concept.layers[`l${depth}` as const].map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <p className="small muted">★ marks the layer your plan recommends. All three layers stay open to you.</p>
      </section>

      <section className="card stack" aria-labelledby="mis-h">
        <h2 id="mis-h">Common misconceptions</h2>
        {concept.misconceptions.map((mc) => (
          <div key={mc.claim} className="plan-item" style={{ gridTemplateColumns: '1fr' }}>
            <div>
              <div>
                <span className="badge badge-danger">Myth</span> {mc.claim}
              </div>
              <div style={{ marginTop: 6 }}>
                <span className="badge badge-ok">Fix</span> {mc.correction}
              </div>
            </div>
          </div>
        ))}
      </section>

      {labs.length > 0 && (
        <section className="card stack" aria-labelledby="lab-h">
          <h2 id="lab-h">Run the lab</h2>
          {labs.map((l) => (
            <Link key={l.id} className="btn" to={`${manifest.route}/lab/${l.id}`}>
              Open {l.title}
            </Link>
          ))}
        </section>
      )}

      <section className="card stack" aria-labelledby="qc-h">
        <h2 id="qc-h">Quick check</h2>
        <CheckRunner key={concept.id} items={checks} />
      </section>
    </div>
  )
}
