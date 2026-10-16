import type { LearnerSnapshot } from '../identity/bundle'
import { ALL_OFF, type CapabilityFlags, type Rung } from '../session/rung'
import type { MergeReport } from '../store/sync'

// Typed client for API mode (api/ in this repo). The portal never depends on it: any
// network failure, timeout or 5xx drops the ladder to rung 4 within that one request,
// and the offline floor carries on. A typed 429 budget denial is rung 3.

export interface Health {
  status: string
  version: string
  rung: Rung
  flags: CapabilityFlags
  models: { mode: 'live' | 'mock' | 'off'; primary: string; standby: string }
  auth: { mode: 'jwks' | 'hs256' | 'dev' }
}

export interface Me {
  sub: string
  learnerId: string | null
  role: 'learner' | 'mentor' | 'admin'
  budget: { usedTokens: number; limitTokens: number }
}

export interface GradedCriterion {
  id: string
  criterion: string
  score: number
  citation: string
  citationVerified: boolean
  rationale: string
  adjusted: boolean
}

export interface GradeResult {
  drillId: string
  criteria: GradedCriterion[]
  total: number
  max: number
  passMark: number
  passed: boolean
  summary: string
  model: string
  mock: boolean
  rung: Rung
  tokens: number
  costUsd: number
  fallbackUsed: boolean
}

export interface GradeJob {
  jobId: string
  status: 'pending' | 'queued' | 'done' | 'failed'
  result?: GradeResult | { error: string } | null
  rung?: Rung
}

export interface TutorAnswer {
  answer: string
  termination: 'completed' | 'step-ceiling' | 'token-budget' | 'wall-clock' | 'no-progress' | 'refused'
  steps: Array<{ kind: 'tool' | 'answer'; tool?: string; status?: string; tokens: number }>
  tokens: number
  costUsd: number
  rung: Rung
  mock: boolean
  elapsedMs: number
}

export type CoachRewrite =
  | { status: 'SUCCESS'; rewrite: string; explanation: string; elementsAdded: string[]; model: string; mock: boolean; rung: Rung; costUsd: number }
  | { status: 'DENIED'; redFlags: Array<{ id: string; label: string; advice: string }> }
  | { status: 'UNAVAILABLE'; error: string }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message)
  }
}

export interface LadderListener {
  (rung: Rung, reachable: boolean, flags?: CapabilityFlags): void
}

export class MantleApi {
  constructor(
    readonly baseUrl: string,
    private readonly token: () => Promise<string | undefined>,
    private readonly onLadder: LadderListener,
    private readonly fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a),
  ) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`
  }

  async request<T>(path: string, init: RequestInit = {}, opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body) headers.set('content-type', 'application/json')
    if (opts.auth !== false) {
      const t = await this.token()
      if (!t) throw new ApiError(401, null, 'Sign in to use API mode.')
      headers.set('authorization', `Bearer ${t}`)
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000)
    let res: Response
    try {
      res = await this.fetchImpl(this.url(path), { ...init, headers, signal: ctrl.signal })
    } catch {
      this.onLadder(4, false)
      throw new ApiError(0, null, 'The Mantle API is unreachable. Offline mode is on; everything local still works.')
    } finally {
      clearTimeout(timer)
    }
    const rungHeader = res.headers.get('x-mantle-rung')
    const body = await res.json().catch(() => null)
    if (res.status >= 500 && res.status !== 503) {
      this.onLadder(4, false)
      throw new ApiError(res.status, body, 'The Mantle API failed. Offline mode is on.')
    }
    if (rungHeader !== null) this.onLadder(Number(rungHeader) as Rung, true)
    if (!res.ok) {
      const detail = (body as { detail?: unknown } | null)?.detail
      const rung = (detail as { rung?: Rung } | undefined)?.rung
      if (rung !== undefined) this.onLadder(rung, true)
      const message =
        typeof detail === 'string' ? detail : ((detail as { reason?: string } | undefined)?.reason ?? `Request failed (${res.status})`)
      throw new ApiError(res.status, detail ?? body, message)
    }
    return body as T
  }

  async health(): Promise<Health> {
    try {
      const h = await this.request<Health>('/health', {}, { auth: false, timeoutMs: 3_000 })
      this.onLadder(h.rung, true, h.flags)
      return h
    } catch (e) {
      this.onLadder(4, false, ALL_OFF)
      throw e
    }
  }

  devToken(sub: string) {
    return this.request<{ token: string }>('/dev/token', { method: 'POST', body: JSON.stringify({ sub }) }, { auth: false })
  }
  me() {
    return this.request<Me>('/v1/me')
  }
  bind(learnerId: string) {
    return this.request<{ learnerId: string; role: Me['role']; switched: boolean }>('/v1/identity/bind', {
      method: 'POST',
      body: JSON.stringify({ learnerId }),
    })
  }
  sync(snapshot: LearnerSnapshot) {
    return this.request<{ report: MergeReport & Record<string, unknown>; snapshot: LearnerSnapshot; syncedAt: string }>(
      '/v1/sync',
      { method: 'POST', body: JSON.stringify({ snapshot }) },
      { timeoutMs: 60_000 },
    )
  }
  pull() {
    return this.request<{ snapshot: LearnerSnapshot | null }>('/v1/sync')
  }
  gradeDrill(drillId: string, answer: string) {
    return this.request<GradeJob>('/v1/grade/drill', { method: 'POST', body: JSON.stringify({ drillId, answer }) }, { timeoutMs: 90_000 })
  }
  gradeJob(jobId: string) {
    return this.request<GradeJob>(`/v1/grade/${encodeURIComponent(jobId)}`)
  }
  askTutor(body: { question: string; conceptId?: string; labId?: string; labState?: unknown }) {
    return this.request<TutorAnswer>('/v1/tutor/ask', { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: 90_000 })
  }
  coachRewrite(scenarioId: string, prompt: string) {
    return this.request<CoachRewrite>('/v1/coach/rewrite', { method: 'POST', body: JSON.stringify({ scenarioId, prompt }) })
  }
}
