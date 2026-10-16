import type { Depth, Rules } from '../content/schemas'
import type { ConceptGraph } from './graph'
import { fnv1a, stableStringify } from './hash'
import type { CurriculumPlan, PlanInputs, PlanItem } from './types'

const DAY_MS = 86_400_000
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const fmt = (x: number) => x.toFixed(2)

export function hashInputs(inputs: PlanInputs, graph: ConceptGraph, rules: Rules): string {
  // Day granularity: the same state on the same day never re-plans.
  const { now, ...rest } = inputs
  return fnv1a(stableStringify({ ...rest, day: now.slice(0, 10), rules, content: graph.contentVersions }))
}

/**
 * rules-v1: a pure function from learner signals and the concept graph to an
 * ordered, time-fitted plan. Deterministic, browser-only, no API.
 */
export function plan(inputs: PlanInputs, graph: ConceptGraph, rules: Rules): Omit<CurriculumPlan, 'version' | 'changes'> {
  const { learner } = inputs
  const T = rules.masteryThreshold
  const nowMs = Date.parse(inputs.now)
  const m = (id: string) => inputs.mastery[id]?.mastery ?? rules.bkt.prior

  // Audience rule: a concept is in scope when the learner's role is in its tentacle's
  // audience, or the concept serves the learner's goal. Out-of-scope prerequisites
  // count as satisfied so they never block an in-scope concept.
  const inScope = (id: string) =>
    (graph.audience.get(id) ?? []).includes(learner.role) || graph.concepts.get(id)!.goals.includes(learner.goal)
  const outOfScope = graph.topo.filter((id) => !inScope(id))
  const mastered = graph.topo.filter((id) => inScope(id) && m(id) >= T)
  const remaining = new Set(graph.topo.filter((id) => inScope(id) && m(id) < T))
  const satisfied = new Set([...mastered, ...outOfScope])

  const maxDesc = Math.max(1, ...graph.descendants.values())
  const maxDrills = Math.max(1, ...[...graph.concepts.values()].map((c) => c.drills.length))
  const hasStartTentacle = [...graph.concepts.values()].some((c) => c.tentacle === rules.roles.nonTechnicalStartTentacle)
  const fastTrack = learner.goal === 'interview' && learner.horizonWeeks < rules.depth.interviewFastTrackWeeks

  const score = (id: string) => {
    const c = graph.concepts.get(id)!
    const reasons: string[] = []
    const goalRel = (c.goals.includes(learner.goal) ? 0.6 : 0) + 0.4 * (c.drills.length / maxDrills)
    if (c.goals.includes(learner.goal)) {
      reasons.push(`Serves your ${learner.goal} goal${c.drills.length ? ` (${c.drills.length} drill${c.drills.length > 1 ? 's' : ''} test it)` : ''}`)
    }
    const desc = graph.descendants.get(id) ?? 0
    const leverage = desc / maxDesc
    if (desc > 0) reasons.push(`Unlocks ${desc} later concept${desc > 1 ? 's' : ''}`)
    const gap = 1 - m(id)
    const last = inputs.mastery[id]?.lastEvidenceAt
    const recency = last ? clamp01((nowMs - Date.parse(last)) / DAY_MS / rules.recency.fullDecayDays) : 0.5
    if (last && recency >= 0.5) reasons.push('Not practised recently')

    let s =
      rules.weights.goal * goalRel +
      rules.weights.leverage * leverage +
      rules.weights.gap * gap +
      rules.weights.recency * recency
    if (rules.roles.architectBoostTentacles.includes(c.tentacle) && learner.role === 'architect') s += rules.roles.architectBoost
    if (learner.role === 'non-technical' && hasStartTentacle && c.tentacle === rules.roles.nonTechnicalStartTentacle) {
      s += 1
      reasons.push('Start here for non-technical roles')
    }
    const misses = inputs.missStreaks[id] ?? 0
    const remediation = misses >= rules.remediation.missesToTrigger
    if (remediation) {
      s += 0.2
      reasons.unshift(`Missed ${misses} times in a row: remediation lab first`)
    }
    if ((inputs.lowConfidencePasses[id] ?? 0) > 0) {
      s += 0.05
      reasons.push('You passed with low confidence: one more apply item')
    }
    return { s, reasons, remediation }
  }

  const depthFor = (id: string, remediation: boolean): Depth => {
    const mm = m(id)
    let d: Depth = mm < rules.depth.l1Below ? 1 : mm < rules.depth.l3AtOrAbove ? 2 : 3
    if (fastTrack) d = 3
    if (remediation && d > 1) d = (d - 1) as Depth
    if (learner.role === 'non-technical' && d > rules.roles.nonTechnicalMaxDepth) d = rules.roles.nonTechnicalMaxDepth
    return d
  }

  const items: PlanItem[] = []
  const topoIndex = new Map(graph.topo.map((id, i) => [id, i]))
  while (remaining.size) {
    // Frontier: every prerequisite is mastered or already earlier in the plan.
    const frontier = [...remaining].filter((id) => graph.concepts.get(id)!.prerequisites.every((p) => satisfied.has(p)))
    const scored = frontier
      .map((id) => ({ id, ...score(id) }))
      .sort((a, b) => b.s - a.s || topoIndex.get(a.id)! - topoIndex.get(b.id)!)
    const best = scored[0]
    const c = graph.concepts.get(best.id)!
    const depth = depthFor(best.id, best.remediation)
    const reasons = [...best.reasons, `Mastery ${fmt(m(best.id))}: explainer at L${depth}`]
    const unmetBefore = c.prerequisites.filter((p) => !mastered.includes(p))
    if (unmetBefore.length) reasons.push(`After ${unmetBefore.map((p) => graph.concepts.get(p)!.title).join(', ')}`)
    items.push({
      conceptId: best.id,
      tentacleId: c.tentacle,
      title: c.title,
      depth,
      minutes: c.minutes,
      thisWeek: false,
      remediation: best.remediation,
      score: Number(best.s.toFixed(4)),
      reasons,
    })
    remaining.delete(best.id)
    satisfied.add(best.id)
  }

  // Fit to time: due cards are reserved first, then fill the week in plan order.
  const reservedCardMinutes = Math.min(inputs.dueCards, rules.cards.dailyMax) * rules.cards.minutesPerCard * 7
  let budget = Math.max(0, learner.weeklyMinutes - reservedCardMinutes)
  for (const [i, item] of items.entries()) {
    if (i === 0 || item.minutes <= budget) {
      item.thisWeek = true
      budget -= item.minutes
    } else break
  }

  const inputsHash = hashInputs(inputs, graph, rules)
  return {
    id: `${learner.id}:${inputsHash}`,
    learnerId: learner.id,
    strategy: rules.strategy,
    generatedAt: inputs.now,
    inputsHash,
    contentVersions: graph.contentVersions,
    items,
    mastered,
    outOfScope,
    dueCards: inputs.dueCards,
    weeklyMinutes: learner.weeklyMinutes,
    reservedCardMinutes,
  }
}

/** Plain-words explanation of what changed between two plan versions. */
export function explainChanges(
  prev: CurriculumPlan | undefined,
  next: Pick<CurriculumPlan, 'items' | 'mastered' | 'contentVersions'>,
  graph: ConceptGraph,
  rules: Rules,
): string[] {
  if (!prev) return ['First plan, built from your diagnostic and goal']
  const title = (id: string) => graph.concepts.get(id)?.title ?? id
  const changes: string[] = []
  for (const id of next.mastered) {
    if (!prev.mastered.includes(id)) changes.push(`Re-planned because mastery on ${title(id)} rose above ${rules.masteryThreshold}`)
  }
  for (const id of prev.mastered) {
    if (!next.mastered.includes(id)) changes.push(`${title(id)} dropped below ${rules.masteryThreshold}; it is back in your plan`)
  }
  const prevItems = new Map(prev.items.map((i) => [i.conceptId, i]))
  for (const item of next.items) {
    const before = prevItems.get(item.conceptId)
    if (!before) continue
    if (before.depth !== item.depth) changes.push(`${item.title} moved from L${before.depth} to L${item.depth}`)
    if (!before.remediation && item.remediation) changes.push(`${item.title} needs remediation after repeated misses`)
  }
  for (const [t, v] of Object.entries(next.contentVersions)) {
    if (prev.contentVersions[t] !== v) changes.push(`Content updated: ${t} is now v${v}`)
  }
  const order = (p: Pick<CurriculumPlan, 'items'>) => p.items.map((i) => i.conceptId).join(',')
  if (changes.length === 0 && order(prev) !== order(next)) changes.push('Order adjusted for recency and your time budget')
  return changes
}

/**
 * Any strategy (for example a tutor-proposed plan in API mode) is accepted only if
 * it keeps every prerequisite order. The model proposes; the engine decides.
 */
export function validatePlan(p: Pick<CurriculumPlan, 'items' | 'mastered' | 'outOfScope'>, graph: ConceptGraph): string[] {
  const problems: string[] = []
  const seen = new Set([...p.mastered, ...(p.outOfScope ?? [])])
  for (const item of p.items) {
    const c = graph.concepts.get(item.conceptId)
    if (!c) {
      problems.push(`unknown concept ${item.conceptId}`)
      continue
    }
    for (const pre of c.prerequisites) if (!seen.has(pre)) problems.push(`${item.conceptId} is planned before its prerequisite ${pre}`)
    seen.add(item.conceptId)
  }
  return problems
}
