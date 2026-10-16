import { Link } from 'react-router'
import { useMantle } from '../state/useMantle'
import { CheckRunner, type CheckSummary } from '../ui/CheckRunner'
import { usePackage } from './usePackage'

export function KnowledgeCheck() {
  const pkg = usePackage()
  const { rt, run } = useMantle()
  if (!pkg) return <p>Unknown tentacle.</p>
  const { manifest } = pkg
  const order = rt?.graph.topo ?? []
  const items = [...pkg.checks].sort((a, b) => order.indexOf(a.conceptId) - order.indexOf(b.conceptId))

  const complete = async (s: CheckSummary) => {
    const score = s.correct / Math.max(1, s.total)
    // A summary attempt carries no concepts: per-item attempts already updated mastery.
    await run((rt) =>
      rt.recordAttempt({
        kind: 'check',
        itemId: `knowledge-check:${manifest.id}`,
        conceptIds: [],
        tier: 'apply',
        depth: 2,
        correct: score >= manifest.passMark,
        score,
        answer: s,
        latencyMs: 0,
      }),
    )
  }

  return (
    <div className="stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Plan</Link> / <Link to={manifest.route}>{manifest.title}</Link> / Knowledge check
      </nav>
      <div>
        <div className="eyebrow">Knowledge check · {items.length} items</div>
        <h1>{manifest.title}: knowledge check</h1>
        <p className="lede">Pass at {Math.round(manifest.passMark * 100)}%. Each answer updates your mastery and your plan.</p>
      </div>
      <div className="card">
        <CheckRunner items={items} passMark={manifest.passMark} onComplete={complete} />
      </div>
    </div>
  )
}
