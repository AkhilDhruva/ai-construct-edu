import { createEmptyCard, fsrs, Rating, type Card as FsrsCard, type Grade } from 'ts-fsrs'
import type { CardState } from '../store/types'

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

const RATING: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

const scheduler = fsrs({ enable_fuzz: false })

function toFsrs(s: CardState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  }
}

function fromFsrs(learnerId: string, cardId: string, c: FsrsCard, now: Date): CardState {
  return {
    learnerId,
    cardId,
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review?.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export function newCardState(learnerId: string, cardId: string, now: Date): CardState {
  return fromFsrs(learnerId, cardId, createEmptyCard(now), now)
}

export function reviewCard(state: CardState, rating: ReviewRating, now: Date): CardState {
  const next = scheduler.next(toFsrs(state), now, RATING[rating])
  return fromFsrs(state.learnerId, state.cardId, next.card, now)
}

/** Force a card due now (used when an L2 lapse re-queues its L1 parents). */
export function dueNow(state: CardState, now: Date): CardState {
  return { ...state, due: now.toISOString(), updatedAt: now.toISOString() }
}

/** Cards due now, oldest first, capped by what is left of today's allowance. */
export function selectDue(states: CardState[], now: Date, dailyMax: number, reviewedToday: number): CardState[] {
  const left = Math.max(0, dailyMax - reviewedToday)
  return states
    .filter((s) => Date.parse(s.due) <= now.getTime())
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.cardId.localeCompare(b.cardId))
    .slice(0, left)
}
