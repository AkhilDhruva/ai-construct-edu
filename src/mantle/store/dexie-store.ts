import Dexie, { type Table } from 'dexie'
import type { CurriculumPlan } from '../engine/types'
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

/**
 * Versioned migrations. Each entry is applied in order by Dexie on open; add a new
 * entry (never edit an old one) when the stored shape changes. Postgres and SQLite
 * adapters mirror these versions.
 */
export const DEXIE_MIGRATIONS: Array<{ version: number; stores: Record<string, string>; upgrade?: (tx: unknown) => Promise<void> }> = [
  {
    version: 1,
    stores: {
      learners: 'id',
      cardStates: '[learnerId+cardId], learnerId, due',
      attempts: 'id, learnerId, itemId, at',
      mastery: 'id, learnerId, conceptId, recordedAt',
      plans: 'id, learnerId, version',
      events: 'id, learnerId, sessionId, start',
      meta: 'key',
    },
  },
]

export const LATEST_SCHEMA_VERSION = DEXIE_MIGRATIONS[DEXIE_MIGRATIONS.length - 1].version

class MantleDB extends Dexie {
  learners!: Table<Learner, string>
  cardStates!: Table<CardState, [string, string]>
  attempts!: Table<Attempt, string>
  mastery!: Table<MasteryState, string>
  plans!: Table<CurriculumPlan, string>
  events!: Table<TelemetryEvent, string>
  meta!: Table<MetaRow, string>

  constructor(name: string, upTo: number) {
    super(name)
    for (const m of DEXIE_MIGRATIONS.filter((m) => m.version <= upTo)) {
      const v = this.version(m.version).stores(m.stores)
      if (m.upgrade) v.upgrade(m.upgrade as never)
    }
  }
}

function repo<T, K>(table: Table<T, K>): Repository<T, K> {
  return {
    get: (key) => table.get(key as never),
    query: (where) => table.where(where as { [key: string]: unknown }).toArray(),
    upsert: async (row) => {
      await table.put(row)
    },
  }
}

function log<T extends { id: string }>(table: Table<T, string>): AppendLog<T> {
  return {
    get: (id) => table.get(id),
    query: (where) => table.where(where as { [key: string]: unknown }).toArray(),
    append: async (row) => {
      await table.add(row)
    },
    appendMany: async (rows) => {
      if (rows.length === 0) return 0
      const existing = await table.bulkGet(rows.map((r) => r.id))
      const fresh = rows.filter((_, i) => existing[i] === undefined)
      if (fresh.length) await table.bulkAdd(fresh)
      return fresh.length
    },
  }
}

/** IndexedDB adapter for the offline (no-API) floor. */
export async function openDexieStore(name = 'veraclause-mantle', upTo = LATEST_SCHEMA_VERSION): Promise<MantleStore> {
  let db = new MantleDB(name, upTo)
  await db.open()
  const store: MantleStore = {
    kind: 'dexie',
    learners: repo(db.learners),
    cardStates: repo(db.cardStates),
    attempts: log(db.attempts),
    mastery: log(db.mastery),
    plans: log(db.plans),
    events: log(db.events),
    meta: repo(db.meta),
    async migrate(toVersion = LATEST_SCHEMA_VERSION) {
      if (toVersion > LATEST_SCHEMA_VERSION) throw new Error(`unknown schema version ${toVersion}`)
      if (db.verno < toVersion) {
        db.close()
        db = new MantleDB(name, toVersion)
        await db.open()
        Object.assign(store, {
          learners: repo(db.learners),
          cardStates: repo(db.cardStates),
          attempts: log(db.attempts),
          mastery: log(db.mastery),
          plans: log(db.plans),
          events: log(db.events),
          meta: repo(db.meta),
        })
      }
      return db.verno
    },
    async deleteLearner(learnerId) {
      await db.transaction('rw', [db.learners, db.cardStates, db.attempts, db.mastery, db.plans, db.events], async () => {
        await db.learners.delete(learnerId)
        await db.cardStates.where({ learnerId }).delete()
        await db.attempts.where({ learnerId }).delete()
        await db.mastery.where({ learnerId }).delete()
        await db.plans.where({ learnerId }).delete()
        await db.events.where({ learnerId }).delete()
      })
    },
  }
  return store
}
