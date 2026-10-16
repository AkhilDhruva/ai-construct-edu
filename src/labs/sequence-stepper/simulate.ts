import type { Bounds, Trace, TraceStep } from './schema'

export type TerminationReason =
  | 'completed'
  | 'step-ceiling'
  | 'token-budget'
  | 'wall-clock'
  | 'no-progress'
  | 'trace-exhausted'

export const BOUND_REASONS = ['step-ceiling', 'token-budget', 'wall-clock', 'no-progress'] as const

export const REASON_LABEL: Record<TerminationReason, string> = {
  completed: 'Completed: the agent produced an answer',
  'step-ceiling': 'Step ceiling: too many iterations',
  'token-budget': 'Token budget: the next call would overspend',
  'wall-clock': 'Wall clock: out of time',
  'no-progress': 'No-progress detector: repeating without new information',
  'trace-exhausted': 'Trace ended without an answer',
}

export interface StepFrame {
  index: number
  step: TraceStep
  stepsUsed: number
  tokensUsed: number
  elapsedMs: number
  noProgressRun: number
}

export interface SimulationResult {
  frames: StepFrame[]
  reason: TerminationReason
  /** Index of the step that was refused by a bound, or that answered. */
  stoppedAt: number
  totals: { steps: number; tokens: number; elapsedMs: number }
}

/**
 * Pure bounded-loop simulation. Step, token and wall-clock bounds are checked
 * BEFORE each call (a budget is checked before spending, not after). The
 * no-progress detector can only judge a step after observing it.
 */
export function simulate(trace: Trace, bounds: Bounds): SimulationResult {
  const frames: StepFrame[] = []
  let tokens = 0
  let elapsed = 0
  let noProgressRun = 0
  const wallMs = bounds.wallClockSec * 1000
  const result = (reason: TerminationReason, stoppedAt: number): SimulationResult => ({
    frames,
    reason,
    stoppedAt,
    totals: { steps: frames.length, tokens, elapsedMs: elapsed },
  })

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i]
    if (frames.length >= bounds.maxSteps) return result('step-ceiling', i)
    if (tokens + step.tokens > bounds.tokenBudget) return result('token-budget', i)
    if (elapsed + step.ms > wallMs) return result('wall-clock', i)

    tokens += step.tokens
    elapsed += step.ms
    noProgressRun = step.progress ? 0 : noProgressRun + 1
    frames.push({ index: i, step, stepsUsed: frames.length + 1, tokensUsed: tokens, elapsedMs: elapsed, noProgressRun })

    if (step.kind === 'answer') return result('completed', i)
    if (noProgressRun >= bounds.noProgressWindow) return result('no-progress', i)
  }
  return result('trace-exhausted', trace.steps.length)
}
