import { describe, expect, it } from 'vitest'
import { asOf, bitemporalScenario, type Fact } from '../src/labs/bitemporal-timeline/schema'
import { applyLevers, costWaterfallScenario, meetsChallenge, solveChallenge } from '../src/labs/cost-waterfall/schema'
import { scoreSort, sortingBoardScenario } from '../src/labs/sorting-board/schema'
import { costHeat, spanTree, traceDebuggerScenario, type Span } from '../src/labs/trace-debugger/schema'
import { evaluate, initialState, trifectaScenario, type TrifectaAgent } from '../src/labs/trifecta/schema'

describe('bitemporal as-of queries', () => {
  // Address: A until a move on 1 Mar (recorded 2 Mar); the move was actually on 20 Feb,
  // a correction recorded on 15 Mar; a typo record lived 5–6 Mar.
  const facts: Fact[] = [
    { id: 'a', value: 'Old Street', validFrom: '2026-01-01', validTo: '2026-03-01', recordedAt: '2026-01-01', supersededAt: '2026-03-15', note: 'original' },
    { id: 'b', value: 'New Road', validFrom: '2026-03-01', validTo: null, recordedAt: '2026-03-02', supersededAt: '2026-03-15', note: 'move' },
    { id: 'a2', value: 'Old Street', validFrom: '2026-01-01', validTo: '2026-02-20', recordedAt: '2026-03-15', supersededAt: null, note: 'corrected end' },
    { id: 'b2', value: 'New Road', validFrom: '2026-02-20', validTo: null, recordedAt: '2026-03-15', supersededAt: null, note: 'corrected start' },
  ]

  it('answers depend on both the moment and what was known', () => {
    expect(asOf(facts, '2026-02-25', '2026-03-10')?.id).toBe('a') // before the correction we believed the old address
    expect(asOf(facts, '2026-02-25', '2026-03-20')?.id).toBe('b2') // after it, the new one
    expect(asOf(facts, '2026-03-05', '2026-03-01')).toBeUndefined() // the move was not yet recorded
  })

  it('the schema rejects an authored answer that the query contradicts', () => {
    const scenario = {
      schemaVersion: 1,
      engine: 'bitemporal-timeline',
      id: 'x',
      brief: ['b'],
      subject: 'Address',
      axis: { start: '2026-01-01', end: '2026-04-01' },
      facts,
      questions: [
        { id: 'q1', prompt: 'p', validAt: '2026-02-25', knownAt: '2026-03-10', answer: 'a', explanation: 'e' },
        { id: 'q2', prompt: 'p', validAt: '2026-02-25', knownAt: '2026-03-20', answer: 'b2', explanation: 'e' },
        { id: 'q3', prompt: 'p', validAt: '2026-03-05', knownAt: '2026-03-01', answer: 'none', explanation: 'e' },
      ],
    }
    expect(bitemporalScenario.safeParse(scenario).success).toBe(true)
    scenario.questions[1].answer = 'b'
    expect(bitemporalScenario.safeParse(scenario).success).toBe(false)
  })
})

describe('trace debugger', () => {
  const span = (id: string, parentId: string | null, startMs: number, costUsd: number): Span => ({
    id, parentId, name: id, kind: 'llm', startMs, durationMs: 10, tokens: 10, costUsd, status: 'ok', attributes: {},
  })
  const spans = [span('root', null, 0, 0), span('b', 'root', 20, 3), span('a', 'root', 10, 1), span('a1', 'a', 11, 0)]

  it('builds a depth-first tree with children in start order', () => {
    expect(spanTree(spans).map((s) => `${s.id}:${s.depth}`)).toEqual(['root:0', 'a:1', 'a1:2', 'b:1'])
  })

  it('cost heat is each span’s share of the trace', () => {
    expect(costHeat(spans).get('b')).toBe(0.75)
  })

  it('the schema needs exactly one root and a real root cause', () => {
    const base = { schemaVersion: 1, engine: 'trace-debugger', id: 'x', brief: ['b'] }
    const trace = { id: 't', title: 't', symptom: 's', spans, rootCause: 'a1', explanation: 'e' }
    expect(traceDebuggerScenario.safeParse({ ...base, traces: [trace, { ...trace, id: 't2' }] }).success).toBe(true)
    expect(traceDebuggerScenario.safeParse({ ...base, traces: [trace, { ...trace, id: 't2', rootCause: 'nope' }] }).success).toBe(false)
    expect(traceDebuggerScenario.safeParse({ ...base, traces: [trace, { ...trace, id: 't2', spans: [...spans, span('r2', null, 0, 0)] }] }).success).toBe(false)
  })
})

describe('cost waterfall', () => {
  const s = {
    schemaVersion: 1 as const,
    engine: 'cost-waterfall' as const,
    id: 'x',
    brief: ['b'],
    tasksPerMonth: 1000,
    components: [
      { id: 'prefix', label: 'Prefix', usdPerTask: 0.1 },
      { id: 'output', label: 'Output', usdPerTask: 0.1 },
    ],
    baselineQuality: 0.9,
    levers: [
      { id: 'cache', label: 'Cache', description: 'd', effects: [{ component: 'prefix', multiplier: 0.1 }], qualityDelta: 0, conflictsWith: [] },
      { id: 'cheap', label: 'Cheap model', description: 'd', effects: [{ component: 'prefix', multiplier: 0.5 }, { component: 'output', multiplier: 0.5 }], qualityDelta: -0.05, conflictsWith: [] },
      { id: 'cap', label: 'Cap output', description: 'd', effects: [{ component: 'output', multiplier: 0.6 }], qualityDelta: -0.01, conflictsWith: [] },
    ],
    challenge: { instruction: 'i', targetUsdPerTask: 0.08, minQuality: 0.88, maxLevers: 2 },
  }

  it('applies levers multiplicatively and reports each step’s saving', () => {
    const w = applyLevers(s, ['cache', 'cap'])
    expect(w.usdPerTask).toBeCloseTo(0.01 + 0.06)
    expect(w.steps.map((x) => Number(x.savedPerTask.toFixed(3)))).toEqual([0.09, 0.04])
    expect(w.usdPerMonth).toBeCloseTo(70)
  })

  it('quality can rule out the cheapest-looking combination', () => {
    expect(applyLevers(s, ['cache', 'cheap']).usdPerTask).toBeLessThan(0.08)
    expect(meetsChallenge(s, ['cache', 'cheap'])).toBe(false) // quality 0.85 < 0.88
    expect(meetsChallenge(s, ['cache', 'cap'])).toBe(true)
    expect(solveChallenge(s)).toEqual(['cache', 'cap'])
  })

  it('the schema rejects an unsolvable challenge', () => {
    expect(costWaterfallScenario.safeParse(s).success).toBe(true)
    expect(costWaterfallScenario.safeParse({ ...s, challenge: { ...s.challenge, maxLevers: 1 } }).success).toBe(false)
  })
})

describe('lethal trifecta', () => {
  const agent: TrifectaAgent = {
    id: 'inbox',
    title: 'Inbox',
    task: 't',
    tools: [
      { id: 'read-inbox', label: 'Read inbox', legs: ['untrusted-content'], required: true },
      { id: 'crm', label: 'CRM lookup', legs: ['private-data'], required: true },
      { id: 'send', label: 'Send email', legs: ['external-comms'], required: true },
      { id: 'web', label: 'Browse web', legs: ['untrusted-content', 'external-comms'], required: false },
    ],
    mitigations: [{ id: 'approve', label: 'Approve outbound email', neutralises: 'external-comms', appliesTo: ['send'], description: 'd' }],
    debrief: 'd',
  }

  it('starts lethal; turning off a required tool is safe but useless', () => {
    expect(evaluate(agent, initialState(agent)).lethal).toBe(true)
    const r = evaluate(agent, { enabled: ['read-inbox', 'crm', 'web'], mitigations: [] })
    expect(r.lethal).toBe(true) // the web tool still talks to the outside world
    const off = evaluate(agent, { enabled: ['read-inbox', 'crm'], mitigations: [] })
    expect(off.lethal).toBe(false)
    expect(off.safeAndUseful).toBe(false)
  })

  it('a mitigation only covers the tools it wraps', () => {
    // Approval on outbound email does not stop the web tool from talking to the outside world.
    const leaky = evaluate(agent, { enabled: ['read-inbox', 'crm', 'send', 'web'], mitigations: ['approve'] })
    expect(leaky.lethal).toBe(true)
    const r = evaluate(agent, { enabled: ['read-inbox', 'crm', 'send'], mitigations: ['approve'] })
    expect(r.legs.has('external-comms')).toBe(false)
    expect(r.safeAndUseful).toBe(true)
  })

  it('the schema rejects an agent with no safe and useful configuration', () => {
    const base = { schemaVersion: 1, engine: 'trifecta', id: 'x', brief: ['b'] }
    expect(trifectaScenario.safeParse({ ...base, agents: [agent, { ...agent, id: 'b' }] }).success).toBe(true)
    // The only mitigation wraps an optional tool, so the required tools keep all three legs.
    const hopeless: TrifectaAgent = { ...agent, id: 'hopeless', mitigations: [{ id: 'm', label: 'm', neutralises: 'external-comms', appliesTo: ['web'], description: 'd' }] }
    expect(trifectaScenario.safeParse({ ...base, agents: [agent, hopeless] }).success).toBe(false)
  })
})

describe('sorting board', () => {
  it('scores placements and applies the pass bar', () => {
    const s = {
      schemaVersion: 1,
      engine: 'sorting-board',
      id: 'x',
      brief: ['b'],
      buckets: [
        { id: 'a', label: 'A', description: 'd' },
        { id: 'b', label: 'B', description: 'd' },
      ],
      items: ['1', '2', '3', '4'].map((id, i) => ({ id, text: id, bucket: i % 2 ? 'b' : 'a', explanation: 'e' })),
      passScore: 0.75,
    }
    expect(sortingBoardScenario.safeParse(s).success).toBe(true)
    expect(scoreSort(s, { '1': 'a', '2': 'b', '3': 'a', '4': 'a' })).toMatchObject({ correct: 3, passed: true })
    expect(scoreSort(s, { '1': 'a', '2': 'a', '3': 'b', '4': 'b' })).toMatchObject({ correct: 2, passed: false })
    expect(sortingBoardScenario.safeParse({ ...s, items: s.items.map((i) => ({ ...i, bucket: 'a' })) }).success).toBe(false)
  })
})
