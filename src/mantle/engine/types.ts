import type { Audience, Depth, Goal } from '../content/schemas'

export interface PlanItem {
  conceptId: string
  tentacleId: string
  title: string
  depth: Depth
  minutes: number
  /** Fits inside this week's time budget. */
  thisWeek: boolean
  remediation: boolean
  score: number
  /** Plain-words reasons the learner sees next to the item. */
  reasons: string[]
}

export interface CurriculumPlan {
  id: string
  learnerId: string
  version: number
  strategy: string
  generatedAt: string
  inputsHash: string
  contentVersions: Record<string, string>
  items: PlanItem[]
  mastered: string[]
  /** Concepts outside the learner's role and goal; not planned, never blocking. */
  outOfScope: string[]
  dueCards: number
  weeklyMinutes: number
  reservedCardMinutes: number
  /** Why this version differs from the previous one. */
  changes: string[]
}

export interface MasterySignal {
  mastery: number
  lastEvidenceAt?: string
}

export interface PlanInputs {
  learner: { id: string; goal: Goal; horizonWeeks: number; role: Audience; weeklyMinutes: number }
  mastery: Record<string, MasterySignal>
  /** Consecutive misses per concept since its last pass. */
  missStreaks: Record<string, number>
  /** Passed checks the learner rated with low confidence, per concept. */
  lowConfidencePasses: Record<string, number>
  dueCards: number
  now: string
}
