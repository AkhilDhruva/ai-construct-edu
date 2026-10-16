import { create } from 'zustand'
import { devAuth, supabaseAuth, type AuthProvider, type SupabaseAuth } from '../mantle/api/auth'
import { ApiError, MantleApi, type Health, type Me } from '../mantle/api/client'
import { getRegistry } from '../mantle/content/registry'
import type { ContentRegistry } from '../mantle/content/load'
import type { CurriculumPlan } from '../mantle/engine/types'
import { MantleRuntime } from '../mantle/runtime'
import { ALL_OFF, type CapabilityFlags, type Rung } from '../mantle/session/rung'
import type { SessionEndReason } from '../mantle/session/session'
import { openDexieStore } from '../mantle/store/dexie-store'
import { createMemoryStore } from '../mantle/store/memory-store'
import type { Attempt, CardState, Learner } from '../mantle/store/types'

export interface SyncState {
  status: 'off' | 'idle' | 'syncing' | 'error'
  at?: string
  error?: string
  added?: number
}

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
  /** Shows the content studio in navigation. A per-browser convenience, not a permission. */
  authorMode: boolean
  setAuthorMode(on: boolean): void

  // ── API mode ──
  apiUrl?: string
  api?: MantleApi
  auth?: AuthProvider
  reachable: boolean
  health?: Health
  account?: Me
  sync: SyncState
  /** True when signed in to a reachable API whose flag for this feature is on. */
  can(feature: keyof CapabilityFlags): boolean
  connectApi(url: string | undefined): Promise<void>
  signInDev(sub: string): Promise<void>
  signInOAuth(provider: 'github' | 'google'): Promise<void>
  signInEmail(email: string): Promise<void>
  signOut(): Promise<void>
  syncNow(): Promise<void>

  boot(): Promise<void>
  refresh(): Promise<void>
  /** Run an action against the runtime, then refresh the view (and schedule a sync). */
  run<T>(fn: (rt: MantleRuntime) => Promise<T>): Promise<T>
  dismissSessionEnd(): void
}

const AUTHOR_KEY = 'mantle:author-mode'
const API_URL_KEY = 'mantle:api-url'
const SYNC_DEBOUNCE_MS = 4_000
const REPROBE_MS = 30_000

function readLocal(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}
function writeLocal(key: string, value: string | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* per-browser convenience only */
  }
}

let syncTimer: ReturnType<typeof setTimeout> | undefined
let reprobeTimer: ReturnType<typeof setTimeout> | undefined

export const useMantle = create<MantleState>((set, get) => {
  /** Every API response reports the rung; unreachable means rung 4 and every flag off. */
  const onLadder = (rung: Rung, reachable: boolean, flags?: CapabilityFlags) => {
    const nextFlags = reachable ? (flags ?? get().flags ?? ALL_OFF) : ALL_OFF
    get().rt?.setLadder(rung, nextFlags)
    set({ rung, reachable, flags: nextFlags })
    clearTimeout(reprobeTimer)
    if (!reachable && get().api) {
      reprobeTimer = setTimeout(async () => {
        try {
          await get().api?.health()
          if (!get().account) await resumeSession()
        } catch {
          /* still down: health() has already re-armed this timer */
        }
      }, REPROBE_MS)
    }
  }

  const pickAuth = async (health: Health): Promise<AuthProvider | undefined> => {
    if (health.auth.mode === 'dev') return devAuth()
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    return url && key ? supabaseAuth(url, key) : undefined
  }

  /** After sign-in (or on boot with a session): bind the ULID, adopt the account's learner if needed, sync. */
  const resumeSession = async () => {
    const { api, auth, rt } = get()
    if (!api || !auth || !rt || !(await auth.token())) return
    try {
      let me = await api.me()
      if (!me.learnerId) {
        await api.bind(rt.learner.id)
        me = await api.me()
      }
      set({ account: me })
      if (me.learnerId && me.learnerId !== rt.learner.id) {
        // This account belongs to a learner first created on another device: adopt it.
        const { snapshot } = await api.pull()
        if (snapshot) await rt.applySnapshot(snapshot)
        await get().refresh()
      }
      await get().syncNow()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await auth.signOut()
        set({ account: undefined })
      }
      set({ sync: { status: 'error', error: e instanceof Error ? e.message : String(e) } })
    }
  }

  const scheduleSync = () => {
    clearTimeout(syncTimer)
    if (!get().account?.learnerId || !get().reachable) return
    syncTimer = setTimeout(() => void get().syncNow(), SYNC_DEBOUNCE_MS)
  }

  return {
    status: 'booting',
    content: getRegistry(),
    storage: 'dexie',
    rung: 4,
    mastery: {},
    due: [],
    attempts: [],
    authorMode: readLocal(AUTHOR_KEY) === '1',
    reachable: false,
    sync: { status: 'off' },

    setAuthorMode(on) {
      writeLocal(AUTHOR_KEY, on ? '1' : '0')
      set({ authorMode: on })
    },

    can(feature) {
      const s = get()
      return Boolean(s.reachable && s.flags?.[feature] && s.account?.learnerId)
    },

    async connectApi(url) {
      clearTimeout(reprobeTimer)
      writeLocal(API_URL_KEY, url || undefined)
      const apiUrl = url || (import.meta.env.VITE_API_URL as string | undefined)
      if (!apiUrl) {
        get().rt?.setLadder(4, ALL_OFF)
        set({ apiUrl: undefined, api: undefined, auth: undefined, account: undefined, health: undefined, reachable: false, rung: 4, flags: ALL_OFF, sync: { status: 'off' } })
        return
      }
      const api = new MantleApi(apiUrl, async () => get().auth?.token(), onLadder)
      set({ apiUrl, api, account: undefined })
      try {
        const health = await api.health()
        const auth = await pickAuth(health)
        set({ health, auth, sync: { status: 'idle' } })
        await resumeSession()
      } catch {
        set({ health: undefined, sync: { status: 'off' } })
      }
    },

    async signInDev(sub) {
      const { api } = get()
      if (!api) throw new Error('No API configured')
      const auth = devAuth()
      auth.setToken((await api.devToken(sub)).token)
      set({ auth })
      await resumeSession()
    },

    async signInOAuth(provider) {
      const auth = get().auth as SupabaseAuth | undefined
      if (auth?.mode !== 'supabase') throw new Error('Supabase sign-in is not configured')
      await auth.signInWithOAuth(provider) // redirects; the session resumes on return
    },

    async signInEmail(email) {
      const auth = get().auth as SupabaseAuth | undefined
      if (auth?.mode !== 'supabase') throw new Error('Supabase sign-in is not configured')
      await auth.signInWithEmail(email)
    },

    async signOut() {
      clearTimeout(syncTimer)
      await get().auth?.signOut()
      set({ account: undefined, sync: { status: get().api ? 'idle' : 'off' } })
    },

    async syncNow() {
      const { api, rt, account } = get()
      if (!api || !rt || !account?.learnerId) return
      set({ sync: { ...get().sync, status: 'syncing' } })
      try {
        const res = await api.sync(await rt.snapshot())
        const merged = await rt.applySnapshot(res.snapshot)
        const added = merged.attempts + merged.mastery + merged.events + merged.plans + merged.cardStates
        set({ sync: { status: 'idle', at: res.syncedAt, added } })
        await get().refresh()
      } catch (e) {
        set({ sync: { status: 'error', at: get().sync.at, error: e instanceof Error ? e.message : String(e) } })
      }
    },

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
        const rt = await MantleRuntime.boot(store, content, { rung: 4, flags: ALL_OFF })
        set({ rt, storage: store.kind })
        await get().refresh()
        set({ status: 'ready' })
        // API mode is an enhancement: the app is ready before (and without) it.
        void get().connectApi(readLocal(API_URL_KEY))
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
      scheduleSync()
      return result
    },

    dismissSessionEnd() {
      const rt = get().rt
      if (rt) rt.lastSessionEnd = undefined
      set({ sessionEnd: undefined })
    },
  }
})

/** Mastery for a concept, defaulting to the engine prior. */
export function useMastery(conceptId: string): number {
  return useMantle((s) => s.mastery[conceptId] ?? s.content.rules.bkt.prior)
}
