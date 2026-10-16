import { describe, expect, it } from 'vitest'
import { bktUpdate, diagnosticPrior, lapse } from '../src/mantle/engine/bkt'
import { buildGraph } from '../src/mantle/engine/graph'
import { explainChanges, plan, validatePlan } from '../src/mantle/engine/plan'
import type { PlanInputs } from '../src/mantle/engine/types'
import { loadContent } from '../src/mantle/content/load'
import { contentFiles, fixtureTentacle, realRegistry } from './helpers'

const reg = realRegistry()
const graph = buildGraph(reg)
const rules = reg.rules

const inputs = (over: Partial<PlanInputs> = {}, learner: Partial<PlanInputs['learner']> = {}): PlanInputs => ({
  learner: { id: 'L1', goal: 'interview', horizonWeeks: 6, role: 'engineer', weeklyMinutes: 60, ...learner },
  mastery: {},
  missStreaks: {},
  lowConfidencePasses: {},
  dueCards: 0,
  now: '2026-10-15T09:00:00.000Z',
  ...over,
})

describe('adaptive engine rules-v1', () => {
  it('orders every unmastered concept with prerequisites first', () => {
    const p = plan(inputs(), graph, rules)
    const engineering = [...graph.concepts.values()].filter((c) => c.tentacle !== 'enablement-basics')
    expect(p.items).toHaveLength(engineering.length)
    expect(validatePlan(p, graph)).toEqual([])
    expect(p.items[0].conceptId).toBe('what-is-an-agent')
  })

  it('is a pure, fast function: same inputs give the same plan in under 50 ms', () => {
    const t0 = performance.now()
    const a = plan(inputs(), graph, rules)
    const elapsed = performance.now() - t0
    const b = plan(inputs(), graph, rules)
    expect(a).toEqual(b)
    expect(elapsed).toBeLessThan(50)
  })

  it('keeps prerequisite order on a two-tentacle graph', () => {
    const g2 = buildGraph(loadContent({ ...contentFiles(), ...fixtureTentacle() }))
    const p = plan(inputs(), g2, rules)
    expect(validatePlan(p, g2)).toEqual([])
    const idx = (id: string) => p.items.findIndex((i) => i.conceptId === id)
    expect(idx('six-components')).toBeLessThan(idx('memory-tiers'))
    expect(idx('memory-tiers')).toBeLessThan(idx('bitemporal'))
  })

  it('drops mastered concepts and picks depth from mastery', () => {
    const p = plan(
      inputs({
        mastery: {
          'what-is-an-agent': { mastery: 0.9 },
          'agency-spectrum': { mastery: 0.5 },
          'six-components': { mastery: 0.2 },
        },
      }),
      graph,
      rules,
    )
    expect(p.mastered).toEqual(['what-is-an-agent'])
    const depth = (id: string) => p.items.find((i) => i.conceptId === id)!.depth
    expect(depth('agency-spectrum')).toBe(2)
    expect(depth('six-components')).toBe(1)
  })

  it('fast-tracks to L3 for an interview under four weeks, capped at L2 for non-technical roles', () => {
    expect(plan(inputs({}, { horizonWeeks: 2 }), graph, rules).items.every((i) => i.depth === 3)).toBe(true)
    const nt = plan(inputs({}, { horizonWeeks: 2, role: 'non-technical', goal: 'interview' }), graph, rules)
    expect(nt.items.every((i) => i.depth <= 2)).toBe(true)
  })

  it('flags remediation after two misses and lowers depth', () => {
    const p = plan(
      inputs({ mastery: { 'what-is-an-agent': { mastery: 0.55 } }, missStreaks: { 'what-is-an-agent': 2 } }),
      graph,
      rules,
    )
    const item = p.items.find((i) => i.conceptId === 'what-is-an-agent')!
    expect(item.remediation).toBe(true)
    expect(item.depth).toBe(1)
    expect(item.reasons[0]).toMatch(/remediation/)
  })

  it('fits the week to the time budget after reserving card time', () => {
    const p = plan(inputs({ dueCards: 20 }, { weeklyMinutes: 60 }), graph, rules)
    expect(p.reservedCardMinutes).toBe(20 * rules.cards.minutesPerCard * 7)
    const used = p.items.filter((i) => i.thisWeek).reduce((s, i) => s + i.minutes, 0)
    expect(used).toBeLessThanOrEqual(Math.max(p.items[0].minutes, 60 - p.reservedCardMinutes))
    expect(p.items.some((i) => !i.thisWeek)).toBe(true)
  })

  it('explains a re-plan in plain words', () => {
    const before = { ...plan(inputs(), graph, rules), version: 1, changes: [] }
    const after = plan(inputs({ mastery: { 'what-is-an-agent': { mastery: 0.8 } } }), graph, rules)
    expect(explainChanges(before, after, graph, rules)).toContain(
      'Re-planned because mastery on What is an agent? rose above 0.7'.replace('What is an agent?', graph.concepts.get('what-is-an-agent')!.title),
    )
  })

  it('rejects a proposed plan that breaks prerequisite order', () => {
    const p = plan(inputs(), graph, rules)
    const swapped = { ...p, items: [...p.items].reverse() }
    expect(validatePlan(swapped, graph).length).toBeGreaterThan(0)
  })
})

describe('mastery model', () => {
  it('correct answers raise mastery, wrong answers lower it, deeper evidence moves it further', () => {
    const p = 0.3
    expect(bktUpdate(p, true, 'apply', 2, rules)).toBeGreaterThan(p)
    expect(bktUpdate(p, false, 'apply', 2, rules)).toBeLessThan(p)
    expect(bktUpdate(p, true, 'apply', 3, rules)).toBeGreaterThan(bktUpdate(p, true, 'apply', 1, rules))
  })

  it('lapses are bounded steps and the diagnostic prior stays in its band', () => {
    expect(lapse(0.5, rules)).toBeCloseTo(0.45)
    expect(lapse(0.01, rules)).toBe(0)
    expect(diagnosticPrior(0, 2, rules)).toBeCloseTo(rules.bkt.diagnosticWrong)
    expect(diagnosticPrior(2, 2, rules)).toBeCloseTo(rules.bkt.diagnosticCorrect)
  })
})
