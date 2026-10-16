import { motion } from 'framer-motion'
import type { Depth } from '../mantle/content/schemas'

export { RungBadge } from './RungBadge'

// Shared lab-engine kit. A gauge always means a budget; a rung always means a
// degradation level. Every visual cue is also stated in text.

export function MasteryBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100)
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <div
        className="meter"
        style={{ flex: 1, minWidth: 60 }}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="mono small" aria-hidden="true">
        {pct}%
      </span>
    </div>
  )
}

const DEPTH_NAME: Record<Depth, string> = { 1: 'recall', 2: 'apply', 3: 'design' }

export function DepthBadge({ depth }: { depth: Depth }) {
  return (
    <span className="badge badge-info" title={`Depth L${depth}: ${DEPTH_NAME[depth]}`}>
      L{depth} · {DEPTH_NAME[depth]}
    </span>
  )
}

export function BudgetGauge({
  label,
  used,
  limit,
  format = (n) => String(n),
  tripped = false,
}: {
  label: string
  used: number
  limit: number
  format?: (n: number) => string
  tripped?: boolean
}) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0
  const color = tripped || ratio >= 1 ? 'var(--danger)' : ratio >= 0.75 ? 'var(--warn)' : 'var(--accent)'
  return (
    <div className={`gauge${tripped ? ' tripped' : ''}`}>
      <div className="gauge-head">
        <strong>
          {label}
          {tripped ? ' (fired)' : ''}
        </strong>
        <span className="mono">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div
        className="gauge-track"
        role="meter"
        aria-label={`${label}: ${format(used)} of ${format(limit)} used${tripped ? ', this bound fired' : ''}`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
      >
        <motion.div
          className="gauge-fill"
          initial={false}
          animate={{ width: `${ratio * 100}%`, backgroundColor: color }}
          transition={{ type: 'spring', stiffness: 160, damping: 24 }}
        />
      </div>
    </div>
  )
}

export function Metric({ name, value, hint }: { name: string; value: string; hint?: string }) {
  return (
    <div className="metric" title={hint}>
      <span className="value">{value}</span>
      <span className="name">{name}</span>
    </div>
  )
}

export function StatusBadge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={`badge ${ok ? 'badge-ok' : 'badge-danger'}`}>{ok ? `✓ ${yes}` : `✗ ${no}`}</span>
}
