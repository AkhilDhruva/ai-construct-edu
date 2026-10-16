import type { EightNumbers } from './schema'

export interface EnvelopeConstants {
  pricePerMTok: number
  tailFactor: number
  concurrencyLimit: number
}

export interface EnvelopeCheck {
  id: 'success' | 'latency' | 'cost' | 'concurrency'
  label: string
  ok: boolean
  actual: string
  target: string
  fix: string
}

export interface Envelope {
  avgArrivalsPerSec: number
  peakArrivalsPerSec: number
  meanTaskSec: number
  p95TaskSec: number
  peakConcurrency: number
  tokensPerTask: number
  costPerTask: number
  dailyCost: number
  endToEndSuccess: number
  maxStepsForTarget: number
  suggestedBounds: { maxSteps: number; tokenBudget: number; wallClockSec: number }
  checks: EnvelopeCheck[]
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const usd = (x: number) => (x < 1 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`)

/** Turns eight stated numbers into the operating envelope a design must fit. */
export function computeEnvelope(n: EightNumbers, c: EnvelopeConstants, successTarget: number): Envelope {
  const avgArrivalsPerSec = n.tasksPerDay / 86_400
  const peakArrivalsPerSec = avgArrivalsPerSec * n.peakToAverage
  const meanTaskSec = n.stepsPerTask * n.secondsPerStep
  const p95TaskSec = meanTaskSec * c.tailFactor
  // Little's law: work in flight = arrival rate × time in system.
  const peakConcurrency = peakArrivalsPerSec * meanTaskSec
  const tokensPerTask = n.stepsPerTask * n.tokensPerStep
  const costPerTask = (tokensPerTask / 1_000_000) * c.pricePerMTok
  const dailyCost = costPerTask * n.tasksPerDay
  const endToEndSuccess = Math.pow(n.stepSuccess, n.stepsPerTask)
  const maxStepsForTarget =
    n.stepSuccess >= 1 ? Infinity : Math.floor(Math.log(successTarget) / Math.log(n.stepSuccess))

  const checks: EnvelopeCheck[] = [
    {
      id: 'success',
      label: 'End-to-end success',
      ok: endToEndSuccess >= successTarget,
      actual: pct(endToEndSuccess),
      target: `≥ ${pct(successTarget)}`,
      fix: `At ${pct(n.stepSuccess)} per step you can afford at most ${maxStepsForTarget} steps. Cut steps, or raise per-step reliability with verification.`,
    },
    {
      id: 'latency',
      label: 'p95 task latency',
      ok: p95TaskSec <= n.latencyTargetSec,
      actual: `${p95TaskSec.toFixed(1)} s`,
      target: `≤ ${n.latencyTargetSec} s`,
      fix: 'Take fewer sequential steps, use a faster model tier for easy steps, or run tool calls in parallel.',
    },
    {
      id: 'cost',
      label: 'Cost per task',
      ok: costPerTask <= n.costCeiling,
      actual: usd(costPerTask),
      target: `≤ ${usd(n.costCeiling)}`,
      fix: 'Trim context per step (cache the stable prefix, summarise observations) or take fewer steps.',
    },
    {
      id: 'concurrency',
      label: 'Peak concurrency',
      ok: peakConcurrency <= c.concurrencyLimit,
      actual: peakConcurrency.toFixed(1),
      target: `≤ ${c.concurrencyLimit} in flight`,
      fix: 'Shorten tasks, add admission control at peak, or raise the provider rate limit.',
    },
  ]

  return {
    avgArrivalsPerSec,
    peakArrivalsPerSec,
    meanTaskSec,
    p95TaskSec,
    peakConcurrency,
    tokensPerTask,
    costPerTask,
    dailyCost,
    endToEndSuccess,
    maxStepsForTarget,
    suggestedBounds: {
      maxSteps: Math.ceil(n.stepsPerTask * 1.5),
      tokenBudget: Math.ceil(tokensPerTask * 1.5),
      wallClockSec: n.latencyTargetSec,
    },
    checks,
  }
}
