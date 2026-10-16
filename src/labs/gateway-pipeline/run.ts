import type { GatewayCall, StageId, TypedResult } from './schema'

export type Hazard = 'schema-leak' | 'unauthorised-side-effect' | 'ran-on-invalid-input' | 'untyped-result'

export const HAZARD_LABEL: Record<Hazard, string> = {
  'schema-leak': 'Schema leak: an unauthorised caller learned the argument shape from a validation error',
  'unauthorised-side-effect': 'Side effect by an unauthorised caller: the tool ran before authorisation',
  'ran-on-invalid-input': 'Tool ran on invalid input: execution happened before validation',
  'untyped-result': 'Untyped result: the caller got a raw string, not SUCCESS / EMPTY / UNAVAILABLE',
}

export interface StageEvent {
  stage: StageId
  outcome: 'pass' | 'stop' | 'skipped' | 'ran'
  note: string
}

export interface PipelineRun {
  events: StageEvent[]
  /** The typed result, or RAW when the order never typed the tool output. */
  result: TypedResult | 'RAW'
  hazards: Hazard[]
}

/**
 * Pass one call through the gateway stages in the learner's order. The correct
 * order is authorise → validate → execute (with timeout) → type the result.
 */
export function runPipeline(order: StageId[], call: GatewayCall, allowed: string[], timeoutMs: number): PipelineRun {
  const events: StageEvent[] = []
  const hazards: Hazard[] = []
  const permitted = allowed.includes(call.principal)
  let authorised = false
  let validated = false
  let raw: 'ok' | 'empty' | 'error' | 'timeout' | undefined
  let typed: TypedResult | undefined

  const typeOf = (r: NonNullable<typeof raw>): TypedResult => (r === 'ok' ? 'SUCCESS' : r === 'empty' ? 'EMPTY' : 'UNAVAILABLE')

  for (const stage of order) {
    switch (stage) {
      case 'authorize':
        if (!permitted) {
          events.push({ stage, outcome: 'stop', note: `${call.principal} is not on the allowlist` })
          return { events, result: 'DENIED', hazards }
        }
        authorised = true
        events.push({ stage, outcome: 'pass', note: `${call.principal} is allowed` })
        break
      case 'validate':
        if (!call.argsValid) {
          if (!permitted && !authorised) hazards.push('schema-leak')
          events.push({ stage, outcome: 'stop', note: 'arguments do not match the schema; the error describes the expected fields' })
          return { events, result: 'INVALID', hazards }
        }
        validated = true
        events.push({ stage, outcome: 'pass', note: 'arguments match the schema' })
        break
      case 'execute':
        if (!permitted && !authorised) hazards.push('unauthorised-side-effect')
        if (!call.argsValid && !validated) hazards.push('ran-on-invalid-input')
        raw = call.latencyMs > timeoutMs ? 'timeout' : call.upstream
        events.push({
          stage,
          outcome: 'ran',
          note: raw === 'timeout' ? `timed out after ${timeoutMs} ms (call needed ${call.latencyMs} ms)` : `upstream returned ${raw} in ${call.latencyMs} ms`,
        })
        break
      case 'type-result':
        if (raw === undefined) {
          events.push({ stage, outcome: 'skipped', note: 'nothing to type yet: the tool has not run' })
        } else {
          typed = typeOf(raw)
          events.push({ stage, outcome: 'pass', note: `typed as ${typed}` })
        }
        break
    }
  }
  if (raw !== undefined && typed === undefined) {
    hazards.push('untyped-result')
    return { events, result: 'RAW', hazards }
  }
  return { events, result: typed ?? 'UNAVAILABLE', hazards }
}
