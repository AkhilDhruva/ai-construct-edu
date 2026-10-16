import { monotonicFactory } from 'ulid'
import { newCardState, reviewCard, dueNow, selectDue, type ReviewRating } from './cards/scheduler'
import type { ContentRegistry } from './content/load'
import type { Audience, Depth, DiagnosticTrack, Goal } from './content/schemas'
import { bktUpdate, diagnosticPrior, lapse } from './engine/bkt'
import { buildGraph, type ConceptGraph } from './engine/graph'
import { explainChanges, plan as planRulesV1 } from './engine/plan'
import type { CurriculumPlan, MasterySignal, PlanInputs } from './engine/types'
import { createBundle, openBundle, type Bundle } from './identity/bundle'
import { ALL_OFF, type CapabilityFlags, type Rung } from './session/rung'
import {
  checkSession,
  DEFAULT_SESSION_BOUNDS,
  recordStep,
  startSession,
  type SessionBounds,
  type SessionEndReason,
  type SessionState,
} from './session/session'
import { mergeSnapshot, snapshotLearner, type MergeReport } from './store/sync'
import type { Attempt, AttemptKind, CardState, Confidence, Learner, MantleStore, Tier } from './store/types'

export interface RuntimeOptions {
  now?: () => Date
  rung?: Rung
  flags?: CapabilityFlags
  sessionBounds?: SessionBounds
}

export interface OnboardingInput {
  goal: Goal
  role: Audience
  weeklyMinutes: number
  horizonWeeks: number
  answers: Record<string, string>
}

export interface AttemptInput {
  kind: AttemptKind
  itemId: string
  conceptIds: string[]
  tier: Tier
  depth: Depth
  correct: boolean
  score?: number
  answer: unknown
  latencyMs: number
  confidence?: Confidence
}

export interface MasteryChange {
  conceptId: string
  before: number
  after: number
}

const CURRENT_LEARNER = 'currentLearner'
const ACTIVE_SESSION = 'activeSession'

/**
 * Mantle's application core. It owns the session loop, writes evidence, updates
 * mastery, re-plans and emits a telemetry span for every learner step. It talks
 * to storage only through the MantleStore interface, so tests run it on the
 * in-memory fake and the browser runs it on Dexie.
 */
export class MantleRuntime {
  readonly graph: ConceptGraph
  readonly rung: Rung
  readonly flags: CapabilityFlags
  readonly bounds: SessionBounds
  learner!: Learner
  session!: SessionState
  lastSessionEnd?: { reason: SessionEndReason; at: string }
  private readonly clock: () => Date
  private readonly ulid = monotonicFactory()

  private constructor(
    readonly store: MantleStore,
    readonly content: ContentRegistry,
    opts: RuntimeOptions,
  ) {
    this.graph = buildGraph(content)
    this.clock = opts.now ?? (() => new Date())
    this.rung = opts.rung ?? 4
    this.flags = opts.flags ?? ALL_OFF
    this.bounds = opts.sessionBounds ?? DEFAULT_SESSION_BOUNDS
  }

  static async boot(store: MantleStore, content: ContentRegistry, opts: RuntimeOptions = {}): Promise<MantleRuntime> {
    const rt = new MantleRuntime(store, content, opts)
    await store.migrate()
    const current = (await store.meta.get(CURRENT_LEARNER))?.value as string | undefined
    const existing = current ? await store.learners.get(current) : undefined
    rt.learner = existing ?? (await rt.mintLearner())
    await rt.resumeOrBeginSession()
    // A content update (new tentacle or version) changes the inputs hash, so an
    // existing learner's plan re-plans and explains why on their next visit.
    if (rt.learner.onboarded) await rt.replan()
    return rt
  }

  /**
   * A reload resumes the open session if its bounds still hold. A session that
   * went stale while the tab was closed is ended with its typed reason first, so
   * every session in the trace terminates.
   */
  private async resumeOrBeginSession() {
    const saved = (await this.store.meta.get(ACTIVE_SESSION))?.value as (SessionState & { learnerId: string }) | undefined
    if (saved && saved.learnerId === this.learner.id && !saved.ended) {
      this.session = saved
      const reason = checkSession(saved, this.now(), this.bounds)
      if (!reason) return
      await this.endSession(reason)
    }
    await this.beginSession()
  }

  private async saveSession() {
    await this.store.meta.upsert({ key: ACTIVE_SESSION, value: { ...this.session, learnerId: this.learner.id } })
  }

  now(): Date {
    return this.clock()
  }

  id(): string {
    return this.ulid(this.now().getTime())
  }

  get mode(): 'offline' | 'api' {
    return this.rung === 4 ? 'offline' : 'api'
  }

  // ── Identity ───────────────────────────────────────────────────────────────
  /** The ULID is minted client-side before any sign-in, so a learner starts in seconds. */
  private async mintLearner(): Promise<Learner> {
    const at = this.now().toISOString()
    const learner: Learner = {
      id: this.id(),
      createdAt: at,
      updatedAt: at,
      onboarded: false,
      goal: 'interview',
      horizonWeeks: 6,
      role: 'engineer',
      weeklyMinutes: 300,
      introduced: [],
    }
    await this.store.learners.upsert(learner)
    await this.store.meta.upsert({ key: CURRENT_LEARNER, value: learner.id })
    return learner
  }

  private async saveLearner(patch: Partial<Learner>) {
    this.learner = { ...this.learner, ...patch, updatedAt: this.now().toISOString() }
    await this.store.learners.upsert(this.learner)
  }

  // ── Session loop and telemetry ───────────────────────────────────────────────
  private async beginSession() {
    const id = this.id()
    const rootSpanId = this.id()
    this.session = startSession(id, rootSpanId, this.now())
    await this.store.events.append({
      id: rootSpanId,
      learnerId: this.learner.id,
      sessionId: id,
      name: 'session.start',
      start: this.session.startedAt,
      durationMs: 0,
      attributes: { rung: this.rung, mode: this.mode, ...this.boundsAttrs() },
    })
    await this.saveSession()
  }

  private boundsAttrs() {
    return {
      'bound.maxSteps': this.bounds.maxSteps,
      'bound.wallClockMin': this.bounds.wallClockMin,
      'bound.tokenBudget': this.bounds.tokenBudget,
      'bound.noProgressSteps': this.bounds.noProgressSteps,
    }
  }

  private async endSession(reason: SessionEndReason) {
    const at = this.now()
    await this.store.events.append({
      id: this.id(),
      learnerId: this.learner.id,
      sessionId: this.session.id,
      parentId: this.session.rootSpanId,
      name: 'session.end',
      start: at.toISOString(),
      durationMs: at.getTime() - Date.parse(this.session.startedAt),
      attributes: { reason, steps: this.session.steps, tokens: this.session.tokens, rung: this.rung },
    })
    this.lastSessionEnd = { reason, at: at.toISOString() }
    this.session = { ...this.session, ended: { reason, at: at.toISOString() } }
    await this.saveSession()
  }

  /**
   * One learner step = one span under the session root. The session's bounds are
   * checked before the step runs; if one fires, the session ends with a typed
   * reason and a fresh one begins.
   */
  async span(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    opts: { progress?: boolean; durationMs?: number; tokens?: number } = {},
  ): Promise<string> {
    const reason = checkSession(this.session, this.now(), this.bounds, opts.tokens ?? 0)
    if (reason) {
      await this.endSession(reason)
      await this.beginSession()
    }
    const id = this.id()
    const end = this.now()
    const durationMs = opts.durationMs ?? 0
    await this.store.events.append({
      id,
      learnerId: this.learner.id,
      sessionId: this.session.id,
      parentId: this.session.rootSpanId,
      name,
      start: new Date(end.getTime() - durationMs).toISOString(),
      durationMs,
      attributes: { rung: this.rung, tokens: opts.tokens ?? 0, cost: 0, ...attributes },
    })
    this.session = recordStep(this.session, end, opts.progress ?? false, opts.tokens ?? 0)
    await this.saveSession()
    return id
  }

  // ── Mastery ────────────────────────────────────────────────────────────────
  async masteryMap(): Promise<Record<string, MasterySignal & { version: number }>> {
    const rows = await this.store.mastery.query({ learnerId: this.learner.id })
    const out: Record<string, MasterySignal & { version: number }> = {}
    for (const r of rows) {
      const cur = out[r.conceptId]
      if (!cur || r.version > cur.version) out[r.conceptId] = { mastery: r.mastery, lastEvidenceAt: r.validFrom, version: r.version }
    }
    return out
  }

  private async writeMastery(updates: Array<{ conceptId: string; mastery: number; evidence: string; validFrom: string }>) {
    const current = await this.masteryMap()
    const recordedAt = this.now().toISOString()
    for (const u of updates) {
      await this.store.mastery.append({
        id: this.id(),
        learnerId: this.learner.id,
        conceptId: u.conceptId,
        version: (current[u.conceptId]?.version ?? 0) + 1,
        mastery: Number(u.mastery.toFixed(4)),
        evidence: u.evidence,
        validFrom: u.validFrom,
        recordedAt,
      })
    }
  }

  // ── Onboarding ─────────────────────────────────────────────────────────────
  /** Which readiness check a learner takes: enablement for non-technical roles or goals. */
  diagnosticTrack(role: Audience, goal: Goal): DiagnosticTrack {
    const wanted: DiagnosticTrack = role === 'non-technical' || goal === 'enablement' ? 'enablement' : 'technical'
    if (this.content.diagnostics[wanted]) return wanted
    return wanted === 'technical' ? 'enablement' : 'technical'
  }

  async completeOnboarding(input: OnboardingInput): Promise<CurriculumPlan> {
    const track = this.diagnosticTrack(input.role, input.goal)
    const items = this.content.diagnostics[track]?.items ?? []
    const at = this.now().toISOString()
    let score = 0
    const perConcept = new Map<string, { correct: number; total: number }>()
    for (const item of items) {
      const correct = input.answers[item.id] === item.answer
      if (correct) score++
      for (const c of item.concepts) {
        const agg = perConcept.get(c) ?? { correct: 0, total: 0 }
        agg.total++
        if (correct) agg.correct++
        perConcept.set(c, agg)
      }
    }
    await this.saveLearner({
      onboarded: true,
      goal: input.goal,
      role: input.role,
      weeklyMinutes: input.weeklyMinutes,
      horizonWeeks: input.horizonWeeks,
      diagnostic: { track, score, total: items.length, at, answers: input.answers },
    })
    const diagAttemptId = this.id()
    await this.store.attempts.append({
      id: diagAttemptId,
      learnerId: this.learner.id,
      sessionId: this.session.id,
      kind: 'diagnostic',
      itemId: 'readiness-diagnostic',
      conceptIds: [...perConcept.keys()],
      tier: 'apply',
      depth: 1,
      correct: score / Math.max(1, items.length) >= 0.5,
      score: score / Math.max(1, items.length),
      answer: input.answers,
      latencyMs: 0,
      mode: this.mode,
      at,
    })
    await this.writeMastery(
      [...perConcept.entries()]
        .filter(([c]) => this.graph.concepts.has(c))
        .map(([conceptId, a]) => ({
          conceptId,
          mastery: diagnosticPrior(a.correct, a.total, this.content.rules),
          evidence: diagAttemptId,
          validFrom: at,
        })),
    )
    await this.span('onboarding.complete', { score, total: items.length, goal: input.goal, role: input.role }, { progress: true })
    return this.replan()
  }

  // ── Evidence ───────────────────────────────────────────────────────────────
  async recordAttempt(input: AttemptInput): Promise<{ attempt: Attempt; changes: MasteryChange[]; plan: CurriculumPlan }> {
    const at = this.now().toISOString()
    const attempt: Attempt = {
      id: this.id(),
      learnerId: this.learner.id,
      sessionId: this.session.id,
      kind: input.kind,
      itemId: input.itemId,
      conceptIds: input.conceptIds,
      tier: input.tier,
      depth: input.depth,
      correct: input.correct,
      score: input.score ?? (input.correct ? 1 : 0),
      answer: input.answer,
      latencyMs: input.latencyMs,
      confidence: input.confidence,
      mode: this.mode,
      at,
    }
    await this.store.attempts.append(attempt)
    const before = await this.masteryMap()
    const prior = (c: string) => before[c]?.mastery ?? this.content.rules.bkt.prior
    const changes: MasteryChange[] = input.conceptIds
      .filter((c) => this.graph.concepts.has(c))
      .map((c) => ({
        conceptId: c,
        before: prior(c),
        after: bktUpdate(prior(c), input.correct, input.tier, input.depth, this.content.rules),
      }))
    await this.writeMastery(changes.map((ch) => ({ conceptId: ch.conceptId, mastery: ch.after, evidence: attempt.id, validFrom: at })))
    await this.span(
      `learner.${input.kind}`,
      { item: input.itemId, correct: input.correct, tier: input.tier, depth: input.depth, latencyMs: input.latencyMs },
      { progress: input.correct || changes.length > 0, durationMs: input.latencyMs },
    )
    return { attempt, changes, plan: await this.replan() }
  }

  /** Opening a concept's explainer introduces its cards into spaced review. */
  async introduceConcept(conceptId: string, depth: Depth) {
    const fresh = !this.learner.introduced.includes(conceptId)
    if (fresh) {
      await this.saveLearner({ introduced: [...this.learner.introduced, conceptId] })
      const now = this.now()
      for (const card of this.content.cards.values()) {
        if (card.conceptId !== conceptId) continue
        const existing = await this.store.cardStates.get([this.learner.id, card.id])
        if (!existing) await this.store.cardStates.upsert(newCardState(this.learner.id, card.id, now))
      }
    }
    await this.span('concept.open', { concept: conceptId, depth, fresh }, { progress: fresh })
  }

  async cardStates(): Promise<CardState[]> {
    return this.store.cardStates.query({ learnerId: this.learner.id })
  }

  async reviewedToday(): Promise<number> {
    const today = this.now().toISOString().slice(0, 10)
    const attempts = await this.store.attempts.query({ learnerId: this.learner.id })
    return attempts.filter((a) => a.kind === 'card' && a.at.slice(0, 10) === today).length
  }

  async dueCards(): Promise<CardState[]> {
    return selectDue(await this.cardStates(), this.now(), this.content.rules.cards.dailyMax, await this.reviewedToday())
  }

  async reviewCard(cardId: string, rating: ReviewRating, latencyMs: number) {
    const card = this.content.cards.get(cardId)
    if (!card) throw new Error(`unknown card ${cardId}`)
    const now = this.now()
    const state = (await this.store.cardStates.get([this.learner.id, cardId])) ?? newCardState(this.learner.id, cardId, now)
    await this.store.cardStates.upsert(reviewCard(state, rating, now))

    // "Again" on a deeper card re-queues the concept's L1 cards.
    if (rating === 'again' && card.depth > 1) {
      for (const parent of this.content.cards.values()) {
        if (parent.conceptId !== card.conceptId || parent.depth !== 1) continue
        const ps = await this.store.cardStates.get([this.learner.id, parent.id])
        await this.store.cardStates.upsert(dueNow(ps ?? newCardState(this.learner.id, parent.id, now), now))
      }
    }

    const at = now.toISOString()
    const attemptId = this.id()
    await this.store.attempts.append({
      id: attemptId,
      learnerId: this.learner.id,
      sessionId: this.session.id,
      kind: 'card',
      itemId: cardId,
      conceptIds: [card.conceptId],
      tier: 'recall',
      depth: card.depth,
      correct: rating !== 'again',
      score: { again: 0, hard: 0.5, good: 0.8, easy: 1 }[rating],
      answer: rating,
      latencyMs,
      mode: this.mode,
      at,
    })
    const m = (await this.masteryMap())[card.conceptId]?.mastery ?? this.content.rules.bkt.prior
    const next = rating === 'again' ? lapse(m, this.content.rules) : bktUpdate(m, true, 'recall', card.depth, this.content.rules)
    await this.writeMastery([{ conceptId: card.conceptId, mastery: next, evidence: attemptId, validFrom: at }])
    await this.span('learner.card', { card: cardId, rating, depth: card.depth }, { progress: rating !== 'again', durationMs: latencyMs })
  }

  // ── Planning ───────────────────────────────────────────────────────────────
  async latestPlan(): Promise<CurriculumPlan | undefined> {
    const plans = await this.store.plans.query({ learnerId: this.learner.id })
    return plans.sort((a, b) => b.version - a.version || b.generatedAt.localeCompare(a.generatedAt))[0]
  }

  async planInputs(): Promise<PlanInputs> {
    const attempts = (await this.store.attempts.query({ learnerId: this.learner.id })).sort((a, b) => a.at.localeCompare(b.at))
    const missStreaks: Record<string, number> = {}
    const lowConfidencePasses: Record<string, number> = {}
    for (const a of attempts) {
      if (a.kind !== 'check' && a.kind !== 'lab' && a.kind !== 'drill') continue
      for (const c of a.conceptIds) {
        missStreaks[c] = a.correct ? 0 : (missStreaks[c] ?? 0) + 1
        if (a.correct && a.confidence === 'low') lowConfidencePasses[c] = (lowConfidencePasses[c] ?? 0) + 1
        else if (a.correct) lowConfidencePasses[c] = 0
      }
    }
    const mastery = Object.fromEntries(
      Object.entries(await this.masteryMap()).map(([k, v]) => [k, { mastery: v.mastery, lastEvidenceAt: v.lastEvidenceAt }]),
    )
    return {
      learner: {
        id: this.learner.id,
        goal: this.learner.goal,
        horizonWeeks: this.learner.horizonWeeks,
        role: this.learner.role,
        weeklyMinutes: this.learner.weeklyMinutes,
      },
      mastery,
      missStreaks,
      lowConfidencePasses,
      dueCards: (await this.dueCards()).length,
      now: this.now().toISOString(),
    }
  }

  /** Re-plan; an unchanged inputs hash returns the existing plan instead of a new version. */
  async replan(): Promise<CurriculumPlan> {
    const prev = await this.latestPlan()
    const draft = planRulesV1(await this.planInputs(), this.graph, this.content.rules)
    if (prev && prev.inputsHash === draft.inputsHash) return prev
    const next: CurriculumPlan = {
      ...draft,
      id: this.id(),
      version: (prev?.version ?? 0) + 1,
      changes: explainChanges(prev, draft, this.graph, this.content.rules),
    }
    await this.store.plans.append(next)
    await this.span('plan.generate', { version: next.version, items: next.items.length, hash: next.inputsHash }, { progress: true })
    return next
  }

  // ── Portability ────────────────────────────────────────────────────────────
  async exportBundle(passphrase?: string): Promise<Bundle> {
    await this.span('identity.export', { protected: Boolean(passphrase) })
    return createBundle(await snapshotLearner(this.store, this.learner.id), this.now().toISOString(), passphrase)
  }

  /** Import a bundle (moving devices). The imported learner becomes the current one. */
  async importBundle(bundle: unknown, passphrase?: string): Promise<MergeReport> {
    const snap = await openBundle(bundle, passphrase)
    const report = await mergeSnapshot(this.store, snap)
    await this.store.meta.upsert({ key: CURRENT_LEARNER, value: snap.learner.id })
    this.learner = (await this.store.learners.get(snap.learner.id))!
    await this.beginSession()
    await this.span('identity.import', { attempts: report.attempts, mastery: report.mastery }, { progress: true })
    return report
  }

  /** Delete this learner's local data and start over with a fresh ID. */
  async reset() {
    await this.store.deleteLearner(this.learner.id)
    this.learner = await this.mintLearner()
    await this.beginSession()
  }
}
