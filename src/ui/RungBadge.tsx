import { RUNG_INFO, type Rung } from '../mantle/session/rung'

// Kept free of animation code: the shell renders it on every page.
export function RungBadge({ rung }: { rung: Rung }) {
  const info = RUNG_INFO[rung]
  const tone = rung === 0 ? 'badge-ok' : rung === 4 ? 'badge-neutral' : 'badge-warn'
  return (
    <span className={`badge ${tone}`} title={info.detail} data-testid="rung-badge">
      <span className="rung-dot" aria-hidden="true" />
      Rung {rung} · {info.label}
    </span>
  )
}
