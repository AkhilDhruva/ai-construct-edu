import { create } from 'zustand'
import { getRegistry } from '../mantle/content/registry'
import type { ContentRegistry } from '../mantle/content/load'
import type { CurriculumPlan } from '../mantle/engine/types'
import { MantleRuntime } from '../mantle/runtime'
import { probeApi, type CapabilityFlags, type Rung } from '../mantle/session/rung'
import type { SessionEndReason } from '../mantle/session/session'
import { openDexieStore } from '../mantle/store/dexie-store'
import { createMemoryStore } from '../mantle/store/memory-store'
import type { Attempt, CardState, Learner } from '../mantle/store/types'

export interface MantleState {
  status: 'booting' | 'ready' | 'error'
  error?: string
  rt?: MantleRuntime
  content: ContentRegistry
  storage: 'dexie' | 'memory'
  rung: Rung
  flags?: CapabilityFlags
  learner?: Learner
  mastery: Record<string, number>
  plan?: CurriculumPlan
  due: CardState[]
  attempts: Attempt[]
  sessionEnd?: { reason: SessionEndReason; at: string }
  boot(): Promise<void>
  refresh(): Promise<void>
  /** Run an action against the runtime, then refresh the view. */
  run<T>(fn: (rt: MantleRuntime) => Promise<T>): Promise<T>
  dismissSessionEnd(): void
}

export const useMantle = create<MantleState>((set, get) => ({
  status: 'booting',
  content: getRegistry(),
  storage: 'dexie',
  rung: 4,
  mastery: {},
  due: [],
  attempts: [],

  async boot() {
    try {
      const content = get().content
      let store
      try {
        store = await openDexieStore()
      } catch (e) {
        // IndexedDB blocked (some private modes): keep working in memory, say so in Settings.
        console.warn('[mantle] IndexedDB unavailable, using in-memory storage', e)
        store = createMemoryStore()
      }
      const { rung, flags } = await probeApi(import.meta.env.VITE_API_URL as string | undefined)
      const rt = await MantleRuntime.boot(store, content, { rung, flags })
      set({ rt, storage: store.kind, rung, flags })
      await get().refresh()
      set({ status: 'ready' })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  async refresh() {
    const rt = get().rt
    if (!rt) return
    const [masteryMap, plan, due, attempts] = await Promise.all([
      rt.masteryMap(),
      rt.latestPlan(),
      rt.dueCards(),
      rt.store.attempts.query({ learnerId: rt.learner.id }),
    ])
    set({
      learner: { ...rt.learner },
      mastery: Object.fromEntries(Object.entries(masteryMap).map(([k, v]) => [k, v.mastery])),
      plan,
      due,
      attempts: attempts.sort((a, b) => a.at.localeCompare(b.at)),
      sessionEnd: rt.lastSessionEnd,
    })
  },

  async run(fn) {
    const rt = get().rt
    if (!rt) throw new Error('Mantle is not ready')
    const result = await fn(rt)
    await get().refresh()
    return result
  },

  dismissSessionEnd() {
    const rt = get().rt
    if (rt) rt.lastSessionEnd = undefined
    set({ sessionEnd: undefined })
  },
}))

/** Mastery for a concept, defaulting to the engine prior. */
export function useMastery(conceptId: string): number {
  return useMantle((s) => s.mastery[conceptId] ?? s.content.rules.bkt.prior)
}
