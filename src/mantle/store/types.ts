import type { Audience, Depth, Goal } from '../content/schemas'
import type { CurriculumPlan } from '../engine/types'

// Canonical model. Every adapter (Dexie offline, Postgres in API mode, the in-memory
// fake used by tests) stores exactly these shapes. Keyed on the learner ULID.

export interface Learner {
  id: string
  createdAt: string
  updatedAt: string
  onboarded: boolean
  goal: Goal
  horizonWeeks: number
  role: Audience
  weeklyMinutes: number
  diagnostic?: { score: number; total: number; at: string; answers: Record<string, string> }
  /** Concepts whose explainer the learner has opened; their cards enter review. */
  introduced: string[]
}

/** FSRS scheduling state for one (learner, card). Latest review wins on merge. */
export interface CardState {
  learnerId: string
  cardId: string
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review?: string
  updatedAt: string
}

export type Tier = 'recall' | 'apply' | 'design'
export type AttemptKind = 'card' | 'check' | 'lab' | 'drill' | 'diagnostic'
export type Confidence = 'low' | 'medium' | 'high'

/** Append-only evidence log. */
export interface Attempt {
  id: string
  learnerId: string
  sessionId: string
  kind: AttemptKind
  itemId: string
  conceptIds: string[]
  tier: Tier
  depth: Depth
  correct: boolean
  score: number
  answer: unknown
  latencyMs: number
  confidence?: Confidence
  mode: 'offline' | 'api'
  at: string
}

/**
 * Bitemporal mastery. validFrom: when the learner demonstrably knew it (the
 * evidence time). recordedAt: when the system wrote it. Versions are appended,
 * never overwritten, so any past state can be replayed exactly.
 */
export interface MasteryState {
  id: string
  learnerId: string
  conceptId: string
  version: number
  mastery: number
  evidence: string
  validFrom: string
  recordedAt: string
}

/** One telemetry span. A learner's journey renders like an agent trace. */
export interface TelemetryEvent {
  id: string
  learnerId: string
  sessionId: string
  parentId?: string
  name: string
  start: string
  durationMs: number
  attributes: Record<string, string | number | boolean>
}

export interface MetaRow {
  key: string
  value: unknown
}

export interface Repository<T, K> {
  get(key: K): Promise<T | undefined>
  /** Equality filter on one indexed field (learnerId in practice). */
  query(where: Partial<T>): Promise<T[]>
  upsert(row: T): Promise<void>
}

export interface AppendLog<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  query(where: Partial<T>): Promise<T[]>
  append(row: T): Promise<void>
  /** Union merge: rows whose id already exists are skipped. Returns rows added. */
  appendMany(rows: T[]): Promise<number>
}

export interface MantleStore {
  readonly kind: 'dexie' | 'memory'
  learners: Repository<Learner, string>
  cardStates: Repository<CardState, [string, string]>
  attempts: AppendLog<Attempt>
  mastery: AppendLog<MasteryState>
  plans: AppendLog<CurriculumPlan>
  events: AppendLog<TelemetryEvent>
  meta: Repository<MetaRow, string>
  /** Bring storage to a schema version (latest by default). Returns the version now in effect. */
  migrate(toVersion?: number): Promise<number>
  /** Remove everything belonging to one learner (local reset). */
  deleteLearner(learnerId: string): Promise<void>
}
