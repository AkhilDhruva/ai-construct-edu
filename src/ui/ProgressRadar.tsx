import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { useMantle } from '../state/useMantle'

interface Axis {
  key: string
  label: string
  mastery: number
}

/**
 * Progress radar: one axis per tentacle. With fewer than three tentacles installed
 * a radar has no shape, so it falls back to one axis per concept. The same numbers
 * are always listed in a table for screen readers and for anyone who prefers text.
 */
export function ProgressRadar() {
  const { content, mastery } = useMantle()
  const prior = content.rules.bkt.prior
  const m = (id: string) => mastery[id] ?? prior

  const byTentacle: Axis[] = content.packages.map((p) => ({
    key: p.manifest.id,
    label: p.manifest.title,
    mastery: p.concepts.reduce((s, c) => s + m(c.id), 0) / Math.max(1, p.concepts.length),
  }))
  const perConcept = byTentacle.length < 3
  const axes: Axis[] = perConcept
    ? content.packages.flatMap((p) => p.concepts.map((c) => ({ key: c.id, label: c.title, mastery: m(c.id) })))
    : byTentacle
  const data = axes.map((a) => ({ ...a, value: Math.round(a.mastery * 100) }))

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ width: '100%', height: 300 }} aria-hidden="true">
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="72%" accessibilityLayer={false}>
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} isAnimationActive={false} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="small muted">
        Mastery per {perConcept ? 'concept (one tentacle installed, so concepts are the axes)' : 'tentacle'}. 70% counts as mastered.
      </figcaption>
      <details style={{ marginTop: 8 }}>
        <summary className="small">Show as a table</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{perConcept ? 'Concept' : 'Tentacle'}</th>
                <th scope="col">Mastery</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td className="mono">{d.value}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
