import type {
  AppendLog,
  Attempt,
  CardState,
  Learner,
  MantleStore,
  MasteryState,
  MetaRow,
  Repository,
  TelemetryEvent,
} from './types'
import type { CurriculumPlan } from '../engine/types'

const matches = <T>(row: T, where: Partial<T>) =>
  Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v)

type Purgeable = { purge(learnerId: string): void }

function repo<T, K>(keyOf: (row: T) => K): Repository<T, K> & Purgeable {
  const rows = new Map<string, T>()
  const k = (key: K) => JSON.stringify(key)
  return {
    async get(key) {
      const row = rows.get(k(key))
      return row && structuredClone(row)
    },
    async query(where) {
      return [...rows.values()].filter((r) => matches(r, where)).map((r) => structuredClone(r))
    },
    async upsert(row) {
      rows.set(k(keyOf(row)), structuredClone(row))
    },
    purge(learnerId) {
      for (const [key, r] of rows) {
        const row = r as { id?: string; learnerId?: string }
        if (row.learnerId === learnerId || row.id === learnerId) rows.delete(key)
      }
    },
  }
}

function log<T extends { id: string; learnerId: string }>(): AppendLog<T> & Purgeable {
  const rows = new Map<string, T>()
  return {
    async get(id) {
      const row = rows.get(id)
      return row && structuredClone(row)
    },
    async query(where) {
      return [...rows.values()].filter((r) => matches(r, where)).map((r) => structuredClone(r))
    },
    async append(row) {
      if (rows.has(row.id)) throw new Error(`append-only: id ${row.id} already exists`)
      rows.set(row.id, structuredClone(row))
    },
    async appendMany(batch) {
      let added = 0
      for (const row of batch) {
        if (rows.has(row.id)) continue
        rows.set(row.id, structuredClone(row))
        added++
      }
      return added
    },
    purge(learnerId) {
      for (const [id, r] of rows) if (r.learnerId === learnerId) rows.delete(id)
    },
  }
}

/** In-memory adapter: the fake that lets every layer above storage be tested alone. */
export function createMemoryStore(): MantleStore {
  const learners = repo<Learner, string>((l) => l.id)
  const cardStates = repo<CardState, [string, string]>((c) => [c.learnerId, c.cardId])
  const attempts = log<Attempt>()
  const mastery = log<MasteryState>()
  const plans = log<CurriculumPlan>()
  const events = log<TelemetryEvent>()
  const meta = repo<MetaRow, string>((m) => m.key)
  return {
    kind: 'memory',
    learners,
    cardStates,
    attempts,
    mastery,
    plans,
    events,
    meta,
    async migrate() {
      return 1
    },
    async deleteLearner(learnerId) {
      for (const r of [learners, cardStates, attempts, mastery, plans, events]) r.purge(learnerId)
    },
  }
}
