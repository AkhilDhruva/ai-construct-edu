import { RUNG_INFO, type Rung } from '../mantle/session/rung'

// Kept free of animation code: the shell renders it on every page.
export function RungBadge({ rung, mock = false }: { rung: Rung; mock?: boolean }) {
  const info = RUNG_INFO[rung]
  const tone = rung === 0 ? 'badge-ok' : rung === 4 ? 'badge-neutral' : 'badge-warn'
  // A mock model is never presented as live AI.
  const label = mock && rung < 3 ? `${info.label.replace('Live AI', 'AI')} (mock model)` : info.label
  return (
    <span className={`badge ${tone}`} title={info.detail} data-testid="rung-badge">
      <span className="rung-dot" aria-hidden="true" />
      Rung {rung} · {label}
    </span>
  )
}
