// The learning session is itself a bounded loop: it has a step ceiling, a
// wall clock, a token budget for AI calls and a no-progress detector, and it
// always ends with a typed reason. Same rules the Foundations lab teaches.

export interface SessionBounds {
  maxSteps: number
  wallClockMin: number
  /** AI tokens a session may spend. Offline the budget is 0: no AI call can run. */
  tokenBudget: number
  noProgressSteps: number
  idleMin: number
}

export const DEFAULT_SESSION_BOUNDS: SessionBounds = {
  maxSteps: 200,
  wallClockMin: 120,
  tokenBudget: 0,
  noProgressSteps: 40,
  idleMin: 30,
}

export type SessionEndReason = 'step-ceiling' | 'wall-clock' | 'token-budget' | 'no-progress' | 'idle'

export const SESSION_END_LABEL: Record<SessionEndReason, string> = {
  'step-ceiling': 'Step ceiling reached',
  'wall-clock': 'Two hours is a long session',
  'token-budget': 'AI budget for this session is spent',
  'no-progress': 'Lots of activity without progress',
  idle: 'Idle for a while',
}

export interface SessionState {
  id: string
  rootSpanId: string
  startedAt: string
  lastStepAt: string
  steps: number
  tokens: number
  noProgressRun: number
  ended?: { reason: SessionEndReason; at: string }
}

export function startSession(id: string, rootSpanId: string, now: Date): SessionState {
  const at = now.toISOString()
  return { id, rootSpanId, startedAt: at, lastStepAt: at, steps: 0, tokens: 0, noProgressRun: 0 }
}

/** Checked before each step. Returns why the session must end, or undefined to continue. */
export function checkSession(s: SessionState, now: Date, b: SessionBounds, nextTokens = 0): SessionEndReason | undefined {
  const t = now.getTime()
  if (t - Date.parse(s.lastStepAt) > b.idleMin * 60_000) return 'idle'
  if (t - Date.parse(s.startedAt) > b.wallClockMin * 60_000) return 'wall-clock'
  if (s.steps >= b.maxSteps) return 'step-ceiling'
  if (s.tokens + nextTokens > b.tokenBudget && nextTokens > 0) return 'token-budget'
  if (s.noProgressRun >= b.noProgressSteps) return 'no-progress'
  return undefined
}

export function recordStep(s: SessionState, now: Date, progress: boolean, tokens = 0): SessionState {
  return {
    ...s,
    lastStepAt: now.toISOString(),
    steps: s.steps + 1,
    tokens: s.tokens + tokens,
    noProgressRun: progress ? 0 : s.noProgressRun + 1,
  }
}
