import { describe, expect, it } from 'vitest'
import { MantleRuntime } from '../src/mantle/runtime'
import { createMemoryStore } from '../src/mantle/store/memory-store'
import { openDexieStore } from '../src/mantle/store/dexie-store'
import { fakeClock, realRegistry } from './helpers'

const reg = realRegistry()
const allCorrect = Object.fromEntries(reg.diagnostic.map((d) => [d.id, d.answer]))
const allWrong = Object.fromEntries(reg.diagnostic.map((d) => [d.id, d.options.find((o) => o.id !== d.answer)!.id]))
const onboarding = { goal: 'interview' as const, role: 'engineer' as const, weeklyMinutes: 300, horizonWeeks: 6 }

async function boot(clock = fakeClock()) {
  const store = createMemoryStore()
  const rt = await MantleRuntime.boot(store, reg, { now: clock.now })
  return { rt, store, clock }
}

describe('identity and onboarding', () => {
  it('mints a 26-char ULID before any sign-in and remembers it across boots', async () => {
    const { rt, store, clock } = await boot()
    expect(rt.learner.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    const again = await MantleRuntime.boot(store, reg, { now: clock.now })
    expect(again.learner.id).toBe(rt.learner.id)
  })

  it('a strong diagnostic seeds higher mastery than a weak one', async () => {
    const strong = await boot()
    const weak = await boot()
    await strong.rt.completeOnboarding({ ...onboarding, answers: allCorrect })
    await weak.rt.completeOnboarding({ ...onboarding, answers: allWrong })
    const ms = await strong.rt.masteryMap()
    const mw = await weak.rt.masteryMap()
    expect(ms['bounded-loop'].mastery).toBeGreaterThan(mw['bounded-loop'].mastery)
    const p = await strong.rt.latestPlan()
    expect(p?.version).toBe(1)
    expect(p?.changes[0]).toMatch(/First plan/)
  })
})

describe('evidence, bitemporal mastery and re-planning', () => {
  it('appends a new mastery version per attempt and never overwrites', async () => {
    const { rt, store, clock } = await boot()
    await rt.completeOnboarding({ ...onboarding, answers: allWrong })
    const item = [...reg.checks.values()].find((c) => c.conceptId === 'what-is-an-agent')!
    clock.advance(60_000)
    await rt.recordAttempt({ kind: 'check', itemId: item.id, conceptIds: ['what-is-an-agent'], tier: 'apply', depth: 2, correct: true, answer: 'x', latencyMs: 4000 })
    clock.advance(60_000)
    await rt.recordAttempt({ kind: 'check', itemId: item.id, conceptIds: ['what-is-an-agent'], tier: 'apply', depth: 2, correct: true, answer: 'x', latencyMs: 3000 })
    const rows = (await store.mastery.query({ learnerId: rt.learner.id })).filter((r) => r.conceptId === 'what-is-an-agent')
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2, 3])
    expect(rows.every((r) => r.validFrom && r.recordedAt)).toBe(true)
    const byVersion = rows.sort((a, b) => a.version - b.version).map((r) => r.mastery)
    expect(byVersion[2]).toBeGreaterThan(byVersion[0])
  })

  it('mastering a concept re-plans with a plain-words reason', async () => {
    const { rt } = await boot()
    await rt.completeOnboarding({ ...onboarding, answers: allWrong })
    let last
    for (let i = 0; i < 8; i++) {
      last = await rt.recordAttempt({ kind: 'check', itemId: `k${i}`, conceptIds: ['what-is-an-agent'], tier: 'apply', depth: 3, correct: true, answer: 'x', latencyMs: 1000 })
    }
    const plan = last!.plan
    expect(plan.mastered).toContain('what-is-an-agent')
    const history = await rt.store.plans.query({ learnerId: rt.learner.id })
    expect(history.some((p) => p.changes.some((c) => c.includes('rose above')))).toBe(true)
  })

  it('an unchanged state does not create a new plan version', async () => {
    const { rt } = await boot()
    await rt.completeOnboarding({ ...onboarding, answers: allWrong })
    const a = await rt.replan()
    const b = await rt.replan()
    expect(b.id).toBe(a.id)
  })
})

describe('spaced repetition', () => {
  it('opening a concept introduces its cards; Again on an L2 card re-queues its L1 cards', async () => {
    const { rt, clock } = await boot()
    await rt.completeOnboarding({ ...onboarding, answers: allWrong })
    await rt.introduceConcept('bounded-loop', 1)
    const cards = [...reg.cards.values()].filter((c) => c.conceptId === 'bounded-loop')
    expect((await rt.dueCards()).length).toBe(cards.length)

    for (const c of cards) await rt.reviewCard(c.id, 'good', 2000)
    expect((await rt.dueCards()).length).toBe(0)

    const l2 = cards.find((c) => c.depth === 2)!
    clock.advance(1000)
    await rt.reviewCard(l2.id, 'again', 2000)
    const due = (await rt.dueCards()).map((s) => s.cardId)
    for (const l1 of cards.filter((c) => c.depth === 1)) expect(due).toContain(l1.id)
  })
})

describe('telemetry and the bounded session', () => {
  it('every learner action emits a span under the session root', async () => {
    const { rt, store } = await boot()
    await rt.completeOnboarding({ ...onboarding, answers: allWrong })
    await rt.introduceConcept('what-is-an-agent', 1)
    const events = await store.events.query({ learnerId: rt.learner.id })
    const root = events.find((e) => e.name === 'session.start')!
    const names = events.map((e) => e.name)
    expect(names).toEqual(expect.arrayContaining(['session.start', 'onboarding.complete', 'plan.generate', 'concept.open']))
    expect(events.filter((e) => e.name !== 'session.start').every((e) => e.parentId === root.id)).toBe(true)
    expect(events.every((e) => e.attributes.rung === 4)).toBe(true)
  })

  it('ends the session with a typed reason when a bound fires, then starts a new one', async () => {
    const clock = fakeClock()
    const store = createMemoryStore()
    const rt = await MantleRuntime.boot(store, reg, {
      now: clock.now,
      sessionBounds: { maxSteps: 3, wallClockMin: 120, tokenBudget: 0, noProgressSteps: 40, idleMin: 30 },
    })
    const first = rt.session.id
    for (let i = 0; i < 4; i++) await rt.span('test.step', {}, { progress: true })
    expect(rt.session.id).not.toBe(first)
    expect(rt.lastSessionEnd?.reason).toBe('step-ceiling')

    clock.advance(31 * 60_000)
    const second = rt.session.id
    await rt.span('test.step')
    expect(rt.session.id).not.toBe(second)
    expect(rt.lastSessionEnd?.reason).toBe('idle')
  })

  it('a reload resumes the open session; a stale one is closed with its reason', async () => {
    const { rt, store, clock } = await boot()
    await rt.span('test.step', {}, { progress: true })
    clock.advance(5 * 60_000)
    const reloaded = await MantleRuntime.boot(store, reg, { now: clock.now })
    expect(reloaded.session.id).toBe(rt.session.id)
    expect(reloaded.session.steps).toBe(1)

    clock.advance(45 * 60_000)
    const later = await MantleRuntime.boot(store, reg, { now: clock.now })
    expect(later.session.id).not.toBe(rt.session.id)
    expect(later.lastSessionEnd?.reason).toBe('idle')
    const ends = (await store.events.query({ learnerId: rt.learner.id })).filter((e) => e.name === 'session.end')
    expect(ends.map((e) => e.sessionId)).toEqual([rt.session.id])
  })
})

describe('portability', () => {
  it('round-trips a protected bundle onto a new device and rejects tampering', async () => {
    const a = await boot()
    await a.rt.completeOnboarding({ ...onboarding, answers: allCorrect })
    await a.rt.introduceConcept('bounded-loop', 2)
    const bundle = await a.rt.exportBundle('correct horse battery staple')

    const b = await boot()
    await expect(b.rt.importBundle(bundle, 'wrong passphrase')).rejects.toThrow(/Signature/)
    const tampered = { ...bundle, exportedAt: '2020-01-01T00:00:00.000Z' }
    await expect(b.rt.importBundle(tampered, 'correct horse battery staple')).rejects.toThrow(/Signature/)

    const report = await b.rt.importBundle(bundle, 'correct horse battery staple')
    expect(b.rt.learner.id).toBe(a.rt.learner.id)
    expect(report.attempts).toBeGreaterThan(0)
    expect((await b.rt.masteryMap())['bounded-loop'].mastery).toBeCloseTo((await a.rt.masteryMap())['bounded-loop'].mastery)

    // Importing the same bundle twice adds nothing: union merge on ids.
    const again = await b.rt.importBundle(bundle, 'correct horse battery staple')
    expect(again.attempts).toBe(0)
    expect(again.mastery).toBe(0)
  })

  it('an unprotected bundle carries a checksum that catches edits', async () => {
    const a = await boot()
    await a.rt.completeOnboarding({ ...onboarding, answers: allCorrect })
    const bundle = await a.rt.exportBundle()
    const b = await boot()
    await expect(b.rt.importBundle({ ...bundle, payload: bundle.payload.replace('"onboarded":true', '"onboarded":false') })).rejects.toThrow(/Checksum/)
  })
})

describe('Dexie adapter', () => {
  it('runs the same runtime on IndexedDB and enforces append-only logs', async () => {
    const store = await openDexieStore(`test-${Math.random()}`)
    expect(await store.migrate()).toBe(1)
    const rt = await MantleRuntime.boot(store, reg, { now: fakeClock().now })
    await rt.completeOnboarding({ ...onboarding, answers: allCorrect })
    const plan = await rt.latestPlan()
    expect(plan?.items.length).toBeGreaterThan(0)
    const [first] = await store.attempts.query({ learnerId: rt.learner.id })
    await expect(store.attempts.append(first)).rejects.toThrow()
    expect(await store.attempts.appendMany([first])).toBe(0)
    await store.deleteLearner(rt.learner.id)
    expect(await store.attempts.query({ learnerId: rt.learner.id })).toEqual([])
  })
})
