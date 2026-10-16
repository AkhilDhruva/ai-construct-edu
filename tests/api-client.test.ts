import { describe, expect, it } from 'vitest'
import { ApiError, MantleApi } from '../src/mantle/api/client'
import type { CapabilityFlags, Rung } from '../src/mantle/session/rung'

function harness(respond: (url: string, init: RequestInit) => Promise<Response>, token: string | null = 'tok') {
  const ladder: Array<{ rung: Rung; reachable: boolean; flags?: CapabilityFlags }> = []
  const calls: Array<{ url: string; init: RequestInit }> = []
  const api = new MantleApi(
    'http://api.test/',
    async () => token ?? undefined,
    (rung, reachable, flags) => ladder.push({ rung, reachable, flags }),
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return respond(url, init)
    }) as typeof fetch,
  )
  return { api, ladder, calls }
}

const json = (status: number, body: unknown, rung?: number) =>
  new Response(JSON.stringify(body), { status, headers: rung === undefined ? {} : { 'x-mantle-rung': String(rung) } })

const HEALTH = {
  status: 'ok',
  version: '0.2.0',
  rung: 0,
  flags: { tutor: true, grader: true, coach: true, sync: true },
  models: { mode: 'mock', primary: 'claude-sonnet-5-5', standby: 'claude-haiku-4-5' },
  auth: { mode: 'dev' },
}

describe('API client degradation', () => {
  it('a healthy probe reports the server rung and flags', async () => {
    const { api, ladder } = harness(async () => json(200, HEALTH, 0))
    await api.health()
    expect(ladder.at(-1)).toEqual({ rung: 0, reachable: true, flags: HEALTH.flags })
  })

  it('a network failure drops to rung 4 within that one request', async () => {
    const { api, ladder } = harness(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(api.askTutor({ question: 'why?' })).rejects.toBeInstanceOf(ApiError)
    expect(ladder).toEqual([{ rung: 4, reachable: false, flags: undefined }])
  })

  it('a 5xx also drops to rung 4, but a typed 503 does not', async () => {
    const down = harness(async () => json(502, { detail: 'bad gateway' }))
    await expect(down.api.me()).rejects.toThrow()
    expect(down.ladder.at(-1)?.rung).toBe(4)

    const off = harness(async () => json(503, { detail: { status: 'UNAVAILABLE', rung: 3, reason: 'AI is not configured on this server' } }, 3))
    await expect(off.api.askTutor({ question: 'why?' })).rejects.toThrow(/not configured/)
    expect(off.ladder.at(-1)).toEqual({ rung: 3, reachable: true, flags: undefined })
  })

  it('a budget denial is rung 3 with a readable reason', async () => {
    const { api, ladder } = harness(async () => json(429, { detail: { status: 'DENIED', rung: 3, reason: 'budget', used: 9, limit: 10 } }, 3))
    const err = await api.askTutor({ question: 'why?' }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(429)
    expect(err.message).toBe('budget')
    expect(ladder.at(-1)?.rung).toBe(3)
  })

  it('every response header updates the rung, and auth headers are sent', async () => {
    const { api, ladder, calls } = harness(async () => json(200, { learnerId: 'L', role: 'learner', switched: false }, 2))
    await api.bind('01HZY00000000000000000000A')
    expect(ladder.at(-1)).toEqual({ rung: 2, reachable: true, flags: undefined })
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer tok')
    expect(calls[0].url).toBe('http://api.test/v1/identity/bind')
  })

  it('refuses authenticated calls without a session, without touching the network', async () => {
    const { api, calls } = harness(async () => json(200, {}), null)
    await expect(api.me()).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(0)
  })
})
