import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useMantle } from '../state/useMantle'
import { ConceptMap } from '../ui/ConceptMap'

export function MapPage() {
  const { rt, content, mastery, plan } = useMantle()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const T = content.rules.masteryThreshold
  const m = useCallback((id: string) => mastery[id] ?? content.rules.bkt.prior, [mastery, content.rules.bkt.prior])
  const routeOf = useCallback(
    (t: string) => content.packages.find((p) => p.manifest.id === t)?.manifest.route ?? '/',
    [content.packages],
  )
  const laneTitle = useCallback(
    (t: string) => content.packages.find((p) => p.manifest.id === t)?.manifest.title ?? t,
    [content.packages],
  )
  const dimmed = useMemo(() => (scope === 'mine' ? new Set(plan?.outOfScope ?? []) : undefined), [scope, plan])
  if (!rt) return null
  const graph = rt.graph

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Concept map</div>
        <h1>How the concepts connect</h1>
        <p className="lede">
          Arrows point from a prerequisite to the concept that needs it. Colour shows your mastery; select a concept to open it. Drag to pan, scroll or use the
          buttons to zoom.
        </p>
      </div>
      <div className="row">
        <span className="badge cmap-legend cmap-new">new</span>
        <span className="badge cmap-legend cmap-progress">in progress (≥ 40%)</span>
        <span className="badge cmap-legend cmap-mastered">mastered (≥ {Math.round(T * 100)}%)</span>
        <label className="row small" style={{ marginLeft: 'auto', gap: 6, fontWeight: 400 }}>
          <input type="checkbox" checked={scope === 'mine'} onChange={(e) => setScope(e.target.checked ? 'mine' : 'all')} />
          Dim concepts outside my track
        </label>
      </div>
      <ConceptMap graph={graph} mastery={m} threshold={T} routeOf={routeOf} laneTitle={laneTitle} dimmed={dimmed} />
      <details>
        <summary>Show as a list</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Concept</th>
                <th scope="col">Tentacle</th>
                <th scope="col">Needs first</th>
                <th scope="col">Mastery</th>
              </tr>
            </thead>
            <tbody>
              {graph.topo.map((id) => {
                const c = graph.concepts.get(id)!
                return (
                  <tr key={id}>
                    <td>
                      <Link to={`${routeOf(c.tentacle)}/c/${id}`}>{c.title}</Link>
                    </td>
                    <td>{content.packages.find((p) => p.manifest.id === c.tentacle)?.manifest.title}</td>
                    <td>{c.prerequisites.map((p) => graph.concepts.get(p)?.title).join(', ') || 'none'}</td>
                    <td className="mono">{Math.round(m(id) * 100)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
