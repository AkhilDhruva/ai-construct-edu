import { describe, expect, it } from 'vitest'
import { runPipeline } from '../src/labs/gateway-pipeline/run'
import type { GatewayPipelineScenario } from '../src/labs/gateway-pipeline/schema'
import { analyzePrompt, diffWords } from '../src/labs/prompt-coach/analyze'
import type { PromptCoachScenario } from '../src/labs/prompt-coach/schema'
import { scenarioSimScenario, scorePath, type ChoiceQuality, type ScenarioSimScenario } from '../src/labs/scenario-sim/schema'
import { loadContent, publicationIssues } from '../src/mantle/content/load'
import { buildGraph } from '../src/mantle/engine/graph'
import { plan, validatePlan } from '../src/mantle/engine/plan'
import type { PlanInputs } from '../src/mantle/engine/types'
import { MantleRuntime } from '../src/mantle/runtime'
import { createMemoryStore } from '../src/mantle/store/memory-store'
import type { Attempt, TelemetryEvent } from '../src/mantle/store/types'
import { activityByDay, bumpVersion, itemHealth } from '../src/mantle/studio/analytics'
import { layerOf } from '../src/ui/ConceptMap'
import { contentFiles, fakeClock, realRegistry } from './helpers'

const reg = realRegistry()
const graph = buildGraph(reg)

describe('Phase 1 content', () => {
  it('ships three tentacles and two diagnostic tracks, all publishable', () => {
    expect(reg.errors).toEqual([])
    expect(publicationIssues(reg)).toEqual([])
    expect(reg.packages.map((p) => p.manifest.id).slice(0, 3)).toEqual(['foundations', 'enablement-basics', 'tools-gateway'])
    expect(reg.diagnostics.technical?.items).toHaveLength(12)
    expect(reg.diagnostics.enablement?.items).toHaveLength(12)
  })

  it('tools-gateway builds on Foundations through cross-tentacle prerequisites', () => {
    const tools = reg.packages.find((p) => p.manifest.id === 'tools-gateway')!
    const external = tools.concepts.flatMap((c) => c.prerequisites).filter((p) => reg.concepts.get(p)?.tentacle === 'foundations')
    expect(external.length).toBeGreaterThan(0)
  })

  it('enablement content stays at depth 2 or below and has no design drills', () => {
    const e = reg.packages.find((p) => p.manifest.id === 'enablement-basics')!
    expect(e.drills).toHaveLength(0)
    expect([...e.cards, ...e.checks].every((x) => x.depth <= 2)).toBe(true)
  })
})

describe('prompt coach', () => {
  const coach = reg.labs.get('prompt-coach')!.scenario as PromptCoachScenario

  it('every exemplar: weak prompt fails, strong prompt passes', () => {
    for (const s of coach.scenarios) {
      expect(analyzePrompt(s.weakPrompt, coach).passed, s.id).toBe(false)
      expect(analyzePrompt(s.strongPrompt, coach).passed, s.id).toBe(true)
    }
  })

  it('red flags block a pass even when every element is present', () => {
    const strong = coach.scenarios[0].strongPrompt
    const leaky = `${strong} Send it to jane.doe@example.com.`
    const a = analyzePrompt(leaky, coach)
    expect(a.redFlags.length).toBeGreaterThan(0)
    expect(a.passed).toBe(false)
  })

  it('word diff reconstructs both sides', () => {
    const parts = diffWords('write a summary', 'write a short summary for managers')
    expect(parts.filter((p) => p.kind !== 'added').map((p) => p.text).join('')).toBe('write a summary')
    expect(parts.filter((p) => p.kind !== 'removed').map((p) => p.text).join('')).toBe('write a short summary for managers')
  })
})

describe('workplace scenarios', () => {
  const sim = reg.labs.get('workplace-scenarios')!.scenario as ScenarioSimScenario

  it('a path passes only without risky choices', () => {
    expect(scorePath(['best', 'acceptable']).passed).toBe(true)
    expect(scorePath(['best', 'risky']).passed).toBe(false)
    expect(scorePath([]).passed).toBe(false)
  })

  it('an all-best walk through every scenario ends and passes', () => {
    for (const s of sim.scenarios) {
      let step = s.steps.find((x) => x.id === s.start)
      const qualities: ChoiceQuality[] = []
      for (let guard = 0; step && guard < 20; guard++) {
        const c = step.choices.find((x) => x.quality === 'best')!
        qualities.push(c.quality)
        step = c.next ? s.steps.find((x) => x.id === c.next) : undefined
      }
      expect(step, s.id).toBeUndefined()
      expect(scorePath(qualities).passed).toBe(true)
    }
  })

  it('the schema rejects a cycle', () => {
    const bad = structuredClone(sim)
    const first = bad.scenarios[0]
    first.steps[0].choices[0].next = first.steps[0].id
    expect(scenarioSimScenario.safeParse(bad).success).toBe(false)
  })
})

describe('gateway pipeline', () => {
  const gw = reg.labs.get('gateway-walkthrough')!.scenario as GatewayPipelineScenario
  const run = (order: GatewayPipelineScenario['correctOrder']) =>
    gw.calls.map((c) => runPipeline(order, c, gw.tool.allowedPrincipals, gw.timeoutMs))

  it('the correct order returns every expected typed result with no hazards', () => {
    run(gw.correctOrder).forEach((r, i) => {
      expect(r.result).toBe(gw.calls[i].expected)
      expect(r.hazards).toEqual([])
    })
  })

  it('validating before authorising leaks the schema to an unauthorised caller', () => {
    const hazards = run(['validate', 'authorize', 'execute', 'type-result']).flatMap((r) => r.hazards)
    expect(hazards).toContain('schema-leak')
  })

  it('executing before authorising lets an unauthorised caller cause a side effect', () => {
    const hazards = run(['execute', 'authorize', 'validate', 'type-result']).flatMap((r) => r.hazards)
    expect(hazards).toContain('unauthorised-side-effect')
    expect(hazards).toContain('ran-on-invalid-input')
  })

  it('typing before executing returns raw results', () => {
    const results = run(['authorize', 'validate', 'type-result', 'execute'])
    expect(results.some((r) => r.result === 'RAW' && r.hazards.includes('untyped-result'))).toBe(true)
  })

  it('the starting order is wrong on purpose', () => {
    expect(run(gw.startOrder).some((r, i) => r.result !== gw.calls[i].expected || r.hazards.length > 0)).toBe(true)
  })
})

describe('audience rule and onboarding tracks', () => {
  const inputs = (role: PlanInputs['learner']['role'], goal: PlanInputs['learner']['goal']): PlanInputs => ({
    learner: { id: 'L', goal, horizonWeeks: 6, role, weeklyMinutes: 300 },
    mastery: {},
    missStreaks: {},
    lowConfidencePasses: {},
    dueCards: 0,
    now: '2026-10-20T09:00:00.000Z',
  })
  const tentaclesIn = (p: ReturnType<typeof plan>) => new Set(p.items.map((i) => i.tentacleId))

  it('a non-technical learner starts with all of Enablement Basics, capped at L2', () => {
    const p = plan(inputs('non-technical', 'enablement'), graph, reg.rules)
    const enablement = reg.packages.find((x) => x.manifest.id === 'enablement-basics')!.concepts.length
    expect(p.items.slice(0, enablement).every((i) => i.tentacleId === 'enablement-basics')).toBe(true)
    // Only Foundations concepts that serve the enablement goal follow, as a gentle on-ramp.
    expect(p.items.slice(enablement).every((i) => reg.concepts.get(i.conceptId)!.goals.includes('enablement'))).toBe(true)
    expect(tentaclesIn(p).has('tools-gateway')).toBe(false)
    expect(p.items.every((i) => i.depth <= 2)).toBe(true)
    expect(validatePlan(p, graph)).toEqual([])
  })

  it('an engineer preparing for interviews gets Foundations then Tools, not Enablement', () => {
    const p = plan(inputs('engineer', 'interview'), graph, reg.rules)
    expect(tentaclesIn(p).has('enablement-basics')).toBe(false)
    expect(tentaclesIn(p).has('foundations') && tentaclesIn(p).has('tools-gateway')).toBe(true)
    expect(p.outOfScope.every((id) => reg.concepts.get(id)!.tentacle === 'enablement-basics')).toBe(true)
    expect(validatePlan(p, graph)).toEqual([])
    const idx = (id: string) => p.items.findIndex((i) => i.conceptId === id)
    expect(idx('typed-tool-results')).toBeLessThan(idx('gateway-order'))
  })

  it('an engineer with an enablement goal sees both tracks', () => {
    const p = plan(inputs('engineer', 'enablement'), graph, reg.rules)
    expect(tentaclesIn(p).has('enablement-basics')).toBe(true)
    expect(tentaclesIn(p).has('foundations')).toBe(true)
  })

  it('onboarding picks the diagnostic by role and goal', async () => {
    const rt = await MantleRuntime.boot(createMemoryStore(), reg, { now: fakeClock().now })
    expect(rt.diagnosticTrack('non-technical', 'interview')).toBe('enablement')
    expect(rt.diagnosticTrack('engineer', 'enablement')).toBe('enablement')
    expect(rt.diagnosticTrack('architect', 'capstone')).toBe('technical')
    const answers = Object.fromEntries(reg.diagnostics.enablement!.items.map((d) => [d.id, d.answer]))
    const planned = await rt.completeOnboarding({ goal: 'enablement', role: 'non-technical', weeklyMinutes: 120, horizonWeeks: 4, answers })
    expect(rt.learner.diagnostic?.track).toBe('enablement')
    expect(rt.learner.diagnostic?.score).toBe(12)
    expect(planned.items[0].tentacleId).toBe('enablement-basics')
    expect(planned.items.some((i) => i.tentacleId === 'tools-gateway')).toBe(false)
  })
})

describe('content updates', () => {
  it('a new tentacle re-plans an existing learner on their next visit, with a reason', async () => {
    const files = contentFiles()
    const foundationsOnly = loadContent(Object.fromEntries(Object.entries(files).filter(([k]) => !/enablement-basics|tools-gateway/.test(k))))
    const store = createMemoryStore()
    const clock = fakeClock()
    const before = await MantleRuntime.boot(store, foundationsOnly, { now: clock.now })
    const answers = Object.fromEntries(reg.diagnostics.technical!.items.map((d) => [d.id, d.answer]))
    await before.completeOnboarding({ goal: 'interview', role: 'engineer', weeklyMinutes: 300, horizonWeeks: 6, answers })
    expect((await before.latestPlan())!.items.some((i) => i.tentacleId === 'tools-gateway')).toBe(false)

    clock.advance(60_000)
    const after = await MantleRuntime.boot(store, reg, { now: clock.now })
    const latest = (await after.latestPlan())!
    expect(latest.version).toBe(2)
    expect(latest.items.some((i) => i.tentacleId === 'tools-gateway')).toBe(true)
    expect(latest.changes).toContain('Content updated: tools-gateway is now v1.0.0')
  })
})

describe('studio analytics', () => {
  const at = (d: string) => `${d}T10:00:00.000Z`
  const attempt = (itemId: string, correct: boolean, day = '2026-10-20', kind: Attempt['kind'] = 'check'): Attempt => ({
    id: `${itemId}-${Math.random()}`,
    learnerId: 'L',
    sessionId: 'S',
    kind,
    itemId,
    conceptIds: ['c'],
    tier: 'apply',
    depth: 2,
    correct,
    score: correct ? 1 : 0,
    answer: null,
    latencyMs: 1000,
    mode: 'offline',
    at: at(day),
  })

  it('flags items under 40% or over 95% once they have enough attempts', () => {
    const rows = itemHealth(
      [
        ...Array.from({ length: 5 }, () => attempt('hard', false)),
        ...Array.from({ length: 5 }, () => attempt('easy', true)),
        ...[true, false, true, true, false].map((c) => attempt('fine', c)),
        attempt('sparse', false),
      ],
      5,
    )
    const flag = Object.fromEntries(rows.map((r) => [r.itemId, r.flag]))
    expect(flag).toEqual({ hard: 'too-hard', easy: 'too-easy', fine: undefined, sparse: undefined })
    expect(rows[0].flag).toBeDefined()
  })

  it('summarises activity per day and bumps semver', () => {
    const ev = (day: string, name: string, sessionId: string): TelemetryEvent => ({
      id: Math.random().toString(),
      learnerId: 'L',
      sessionId,
      name,
      start: at(day),
      durationMs: 0,
      attributes: {},
    })
    const days = activityByDay(
      [ev('2026-10-19', 'session.start', 'a'), ev('2026-10-19', 'learner.check', 'a'), ev('2026-10-20', 'learner.card', 'b')],
      [attempt('x', true, '2026-10-19'), attempt('y', false, '2026-10-19')],
    )
    expect(days).toEqual([
      { day: '2026-10-19', sessions: 1, steps: 1, attempts: 2, passRate: 0.5 },
      { day: '2026-10-20', sessions: 1, steps: 1, attempts: 0, passRate: 0 },
    ])
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('concept-map layers put every concept right of its prerequisites', () => {
    const layer = layerOf(graph)
    for (const c of graph.concepts.values()) for (const p of c.prerequisites) expect(layer.get(c.id)!).toBeGreaterThan(layer.get(p)!)
  })
})
