import { describe, expect, it } from 'vitest'
import { computeEnvelope } from '../src/labs/eight-numbers/envelope'
import type { EightNumbersScenario } from '../src/labs/eight-numbers/schema'
import type { SequenceStepperScenario } from '../src/labs/sequence-stepper/schema'
import { simulate } from '../src/labs/sequence-stepper/simulate'
import { realRegistry } from './helpers'

const reg = realRegistry()
const loop = reg.labs.get('bounded-loop-sim')!.scenario as SequenceStepperScenario
const console8 = reg.labs.get('design-console')!.scenario as EightNumbersScenario
const trace = (id: string) => loop.traces.find((t) => t.id === id)!

describe('bounded loop simulator', () => {
  it('each pathology is caught by the bound designed for it', () => {
    const d = loop.defaults
    expect(simulate(trace('refund-lookup'), d).reason).toBe('completed')
    expect(simulate(trace('flip-flop-planner'), d).reason).toBe('step-ceiling')
    expect(simulate(trace('giant-document'), d).reason).toBe('token-budget')
    expect(simulate(trace('slow-erp'), d).reason).toBe('wall-clock')
    expect(simulate(trace('same-search'), d).reason).toBe('no-progress')
  })

  it('checks the token budget before the call, never overspending', () => {
    const r = simulate(trace('giant-document'), loop.defaults)
    expect(r.totals.tokens).toBeLessThanOrEqual(loop.defaults.tokenBudget)
    expect(r.frames).toHaveLength(4)
  })

  it('the challenge traces have three different answers', () => {
    const answers = loop.challenge.traceIds.map((id) => simulate(trace(id), loop.defaults).reason)
    expect(new Set(answers).size).toBe(3)
  })

  it('bounds are independent: loosening one lets the next one fire', () => {
    const loose = { ...loop.defaults, maxSteps: 30 }
    expect(simulate(trace('flip-flop-planner'), loose).reason).toBe('completed')
    const r = simulate(trace('giant-document'), { ...loop.defaults, tokenBudget: 60000, wallClockSec: 8 })
    expect(r.reason).toBe('wall-clock')
  })
})

describe('design console envelope', () => {
  const preset = (id: string) => console8.presets.find((p) => p.id === id)!

  it('the research-assistant challenge fails success and latency as authored', () => {
    const p = preset('research-assistant')
    const env = computeEnvelope(p.values, console8.constants, p.successTarget)
    const failing = env.checks.filter((c) => !c.ok).map((c) => c.id)
    expect(failing.sort()).toEqual(['latency', 'success'])
    expect(env.endToEndSuccess).toBeCloseTo(0.97 ** 25, 6)
    expect(env.maxStepsForTarget).toBe(7)
  })

  it('cutting steps to the reliability limit passes every check', () => {
    const p = preset('research-assistant')
    const env = computeEnvelope({ ...p.values, stepsPerTask: 7 }, console8.constants, p.successTarget)
    expect(env.checks.every((c) => c.ok)).toBe(true)
  })

  it("uses Little's law for peak concurrency", () => {
    const p = preset('support-triage')
    const env = computeEnvelope(p.values, console8.constants, p.successTarget)
    const expected = (40000 / 86400) * 3 * (4 * 1.2)
    expect(env.peakConcurrency).toBeCloseTo(expected, 6)
  })
})
