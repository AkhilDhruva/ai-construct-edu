import { z } from 'zod'

export const LEGS = ['private-data', 'untrusted-content', 'external-comms'] as const
export const leg = z.enum(LEGS)
export type Leg = z.infer<typeof leg>

const agentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  task: z.string().min(1),
  tools: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), legs: z.array(leg), required: z.boolean() })).min(3),
  mitigations: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        neutralises: leg,
        /** The tools this mitigation wraps; their contribution of that leg is removed. */
        appliesTo: z.array(z.string().min(1)).min(1),
        description: z.string().min(1),
      }),
    )
    .min(1),
  debrief: z.string().min(1),
})

export type TrifectaAgent = z.infer<typeof agentSchema>

export interface TrifectaState {
  enabled: string[]
  mitigations: string[]
}

/**
 * Legs present after mitigations. A mitigation only covers the tools it wraps: approval on
 * "send email" does not stop a web-browsing tool from talking to the outside world.
 * All three legs on one identity is the lethal trifecta.
 */
export function activeLegs(agent: TrifectaAgent, state: TrifectaState): Set<Leg> {
  const applied = agent.mitigations.filter((m) => state.mitigations.includes(m.id))
  const legs = new Set<Leg>()
  for (const t of agent.tools) {
    if (!state.enabled.includes(t.id)) continue
    for (const l of t.legs) if (!applied.some((m) => m.neutralises === l && m.appliesTo.includes(t.id))) legs.add(l)
  }
  return legs
}

export function evaluate(agent: TrifectaAgent, state: TrifectaState) {
  const legs = activeLegs(agent, state)
  const missingRequired = agent.tools.filter((t) => t.required && !state.enabled.includes(t.id)).map((t) => t.id)
  const lethal = LEGS.every((l) => legs.has(l))
  return { legs, lethal, missingRequired, safeAndUseful: !lethal && missingRequired.length === 0 }
}

export function initialState(agent: TrifectaAgent): TrifectaState {
  return { enabled: agent.tools.map((t) => t.id), mitigations: [] }
}

/** Every authored agent must start lethal and have at least one safe-and-useful configuration. */
function solvable(agent: TrifectaAgent): boolean {
  const optional = agent.tools.filter((t) => !t.required).map((t) => t.id)
  const required = agent.tools.filter((t) => t.required).map((t) => t.id)
  const mits = agent.mitigations.map((m) => m.id)
  for (let a = 0; a < 1 << optional.length; a++) {
    for (let b = 0; b < 1 << mits.length; b++) {
      const state = { enabled: [...required, ...optional.filter((_, i) => a & (1 << i))], mitigations: mits.filter((_, i) => b & (1 << i)) }
      if (evaluate(agent, state).safeAndUseful) return true
    }
  }
  return false
}

export const trifectaScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('trifecta'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    agents: z.array(agentSchema).min(2),
  })
  .superRefine((s, ctx) => {
    for (const a of s.agents) {
      if (a.tools.length > 10 || a.mitigations.length > 4) ctx.addIssue({ code: 'custom', message: `agent "${a.id}": at most 10 tools and 4 mitigations` })
      const toolIds = new Set(a.tools.map((t) => t.id))
      for (const m of a.mitigations) for (const t of m.appliesTo) if (!toolIds.has(t)) ctx.addIssue({ code: 'custom', message: `mitigation "${m.id}" applies to unknown tool "${t}"` })
      if (!evaluate(a, initialState(a)).lethal) ctx.addIssue({ code: 'custom', message: `agent "${a.id}" must start with all three legs` })
      if (!solvable(a)) ctx.addIssue({ code: 'custom', message: `agent "${a.id}" has no safe configuration that keeps its required tools` })
    }
  })

export type TrifectaScenario = z.infer<typeof trifectaScenario>
