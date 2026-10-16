import type { Depth, Rules } from '../content/schemas'
import type { Tier } from '../store/types'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/**
 * Bayesian knowledge tracing, one observation. Deeper evidence moves mastery
 * further: the learn rate is scaled by the item's depth factor.
 */
export function bktUpdate(p: number, correct: boolean, tier: Tier, depth: Depth, rules: Rules): number {
  const { slip, learn, depthFactor } = rules.bkt
  const guess = tier === 'design' ? rules.bkt.guessDesign : tier === 'recall' ? rules.bkt.guessRecall : rules.bkt.guessMcq
  const posterior = correct
    ? (p * (1 - slip)) / (p * (1 - slip) + (1 - p) * guess)
    : (p * slip) / (p * slip + (1 - p) * (1 - guess))
  const t = clamp01(learn * depthFactor[depth - 1])
  return clamp01(posterior + (1 - posterior) * (correct ? t : 0))
}

/** A forgotten flashcard lowers mastery by a bounded step. */
export function lapse(p: number, rules: Rules): number {
  return clamp01(p - rules.bkt.lapseStep)
}

/** Initial mastery from the readiness diagnostic: fraction correct mapped onto a prior band. */
export function diagnosticPrior(correct: number, total: number, rules: Rules): number {
  if (total === 0) return rules.bkt.prior
  const { diagnosticWrong: lo, diagnosticCorrect: hi } = rules.bkt
  return clamp01(lo + (correct / total) * (hi - lo))
}
