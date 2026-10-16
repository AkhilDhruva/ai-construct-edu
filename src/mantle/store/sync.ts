import type { LearnerSnapshot } from '../identity/bundle'
import type { MantleStore } from './types'

export async function snapshotLearner(store: MantleStore, learnerId: string): Promise<LearnerSnapshot> {
  const learner = await store.learners.get(learnerId)
  if (!learner) throw new Error(`no learner ${learnerId}`)
  const [cardStates, attempts, mastery, plans, events] = await Promise.all([
    store.cardStates.query({ learnerId }),
    store.attempts.query({ learnerId }),
    store.mastery.query({ learnerId }),
    store.plans.query({ learnerId }),
    store.events.query({ learnerId }),
  ])
  return { learner, cardStates, attempts, mastery, plans, events }
}

export interface MergeReport {
  learner: 'kept-local' | 'took-incoming' | 'created'
  cardStates: number
  attempts: number
  mastery: number
  plans: number
  events: number
}

/**
 * Merge an incoming snapshot without losing progress on either side. Append-only
 * logs merge by union on id; the learner profile is last-write-wins; card states
 * keep whichever side reviewed more recently.
 */
export async function mergeSnapshot(store: MantleStore, snap: LearnerSnapshot): Promise<MergeReport> {
  const local = await store.learners.get(snap.learner.id)
  let learner: MergeReport['learner'] = 'created'
  if (!local) await store.learners.upsert(snap.learner)
  else if (Date.parse(snap.learner.updatedAt) > Date.parse(local.updatedAt)) {
    await store.learners.upsert({ ...snap.learner, introduced: [...new Set([...local.introduced, ...snap.learner.introduced])] })
    learner = 'took-incoming'
  } else {
    await store.learners.upsert({ ...local, introduced: [...new Set([...local.introduced, ...snap.learner.introduced])] })
    learner = 'kept-local'
  }

  let cardStates = 0
  for (const cs of snap.cardStates) {
    const mine = await store.cardStates.get([cs.learnerId, cs.cardId])
    const reviewed = (s?: { last_review?: string; updatedAt: string }) => Date.parse(s?.last_review ?? s?.updatedAt ?? '0')
    if (!mine || reviewed(cs) > reviewed(mine)) {
      await store.cardStates.upsert(cs)
      cardStates++
    }
  }
  return {
    learner,
    cardStates,
    attempts: await store.attempts.appendMany(snap.attempts),
    mastery: await store.mastery.appendMany(snap.mastery),
    plans: await store.plans.appendMany(snap.plans),
    events: await store.events.appendMany(snap.events),
  }
}
