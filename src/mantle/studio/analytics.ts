import type { Attempt, TelemetryEvent } from '../store/types'

export interface ItemHealth {
  itemId: string
  kind: Attempt['kind']
  attempts: number
  passRate: number
  medianLatencyMs: number
  /** too-hard: pass rate under 40%; too-easy: over 95%; only flagged with enough evidence. */
  flag?: 'too-hard' | 'too-easy'
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Item health for the author loop: pass rate and latency per item. In offline mode
 * this is one learner's history; in API mode the same function runs over every
 * learner's attempts. Items under 40% or over 95% are flagged for a rewrite.
 */
export function itemHealth(attempts: Attempt[], minSample = 5, kinds: Attempt['kind'][] = ['check', 'lab', 'card']): ItemHealth[] {
  const by = new Map<string, Attempt[]>()
  for (const a of attempts) {
    if (!kinds.includes(a.kind) || a.conceptIds.length === 0) continue
    by.set(a.itemId, [...(by.get(a.itemId) ?? []), a])
  }
  return [...by.entries()]
    .map(([itemId, rows]) => {
      const passRate = rows.filter((r) => r.correct).length / rows.length
      const flag = rows.length < minSample ? undefined : passRate < 0.4 ? 'too-hard' : passRate > 0.95 ? 'too-easy' : undefined
      return { itemId, kind: rows[0].kind, attempts: rows.length, passRate, medianLatencyMs: median(rows.map((r) => r.latencyMs)), flag } satisfies ItemHealth
    })
    .sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)) || a.passRate - b.passRate || a.itemId.localeCompare(b.itemId))
}

export interface DayActivity {
  day: string
  sessions: number
  steps: number
  attempts: number
  passRate: number
}

/** Adoption telemetry: sessions, steps and evidence per day, oldest first. */
export function activityByDay(events: TelemetryEvent[], attempts: Attempt[]): DayActivity[] {
  const days = new Map<string, { sessions: Set<string>; steps: number; attempts: number; passed: number }>()
  const day = (iso: string) => iso.slice(0, 10)
  const get = (d: string) => {
    let row = days.get(d)
    if (!row) days.set(d, (row = { sessions: new Set(), steps: 0, attempts: 0, passed: 0 }))
    return row
  }
  for (const e of events) {
    const row = get(day(e.start))
    row.sessions.add(e.sessionId)
    if (e.name !== 'session.start' && e.name !== 'session.end') row.steps++
  }
  for (const a of attempts) {
    if (a.kind === 'diagnostic') continue
    const row = get(day(a.at))
    row.attempts++
    if (a.correct) row.passed++
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, r]) => ({ day: d, sessions: r.sessions.size, steps: r.steps, attempts: r.attempts, passRate: r.attempts ? r.passed / r.attempts : 0 }))
}

/** Suggest the next semver for a content change. */
export function bumpVersion(version: string, kind: 'patch' | 'minor' | 'major'): string {
  const [maj, min, pat] = version.split('.').map(Number)
  if (kind === 'major') return `${maj + 1}.0.0`
  if (kind === 'minor') return `${maj}.${min + 1}.0`
  return `${maj}.${min}.${pat + 1}`
}
