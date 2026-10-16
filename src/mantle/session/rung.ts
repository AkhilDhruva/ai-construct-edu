// Degradation ladder. The selected rung is shown in the UI and recorded on every span.

export type Rung = 0 | 1 | 2 | 3 | 4

export const RUNG_INFO: Record<Rung, { label: string; detail: string }> = {
  0: { label: 'Live AI', detail: 'API healthy: tutor, grader and coach available.' },
  1: { label: 'AI score arriving later', detail: 'Grader is slow; grading is queued and you self-score now.' },
  2: { label: 'Standby model', detail: 'Primary model saturated; running on the smaller model.' },
  3: { label: 'Live AI resumes tomorrow', detail: "Today's AI budget is spent; exemplars only." },
  4: { label: 'Offline mode', detail: 'No API configured or reachable. Every lab, card and check works locally.' },
}

export interface CapabilityFlags {
  tutor: boolean
  grader: boolean
  coach: boolean
  sync: boolean
}

export const ALL_OFF: CapabilityFlags = { tutor: false, grader: false, coach: false, sync: false }

/**
 * Flags default to off and turn on only when the health probe passes, so a fresh
 * static deploy is a working offline portal by construction.
 */
export async function probeApi(
  apiUrl: string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 1500,
): Promise<{ rung: Rung; flags: CapabilityFlags }> {
  if (!apiUrl) return { rung: 4, flags: ALL_OFF }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/health`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return { rung: 4, flags: ALL_OFF }
    const body = (await res.json()) as { rung?: number; flags?: Partial<CapabilityFlags> }
    const rung = ([0, 1, 2, 3].includes(body.rung ?? -1) ? body.rung : 4) as Rung
    return { rung, flags: { ...ALL_OFF, ...body.flags } }
  } catch {
    return { rung: 4, flags: ALL_OFF }
  }
}
