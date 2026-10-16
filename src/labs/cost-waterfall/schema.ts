import { z } from 'zod'

export const costWaterfallScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('cost-waterfall'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    tasksPerMonth: z.number().int().positive(),
    components: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), usdPerTask: z.number().nonnegative() })).min(2),
    baselineQuality: z.number().min(0).max(1),
    levers: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().min(1),
          effects: z.array(z.object({ component: z.string().min(1), multiplier: z.number().min(0).max(2) })).min(1),
          qualityDelta: z.number().min(-1).max(1),
          conflictsWith: z.array(z.string()).default([]),
        }),
      )
      .min(3)
      .max(10),
    challenge: z.object({
      instruction: z.string().min(1),
      targetUsdPerTask: z.number().positive(),
      minQuality: z.number().min(0).max(1),
      maxLevers: z.number().int().positive(),
    }),
  })
  .superRefine((s, ctx) => {
    const comps = new Set(s.components.map((c) => c.id))
    const levers = new Set(s.levers.map((l) => l.id))
    for (const l of s.levers) {
      for (const e of l.effects) if (!comps.has(e.component)) ctx.addIssue({ code: 'custom', message: `lever "${l.id}" affects unknown component "${e.component}"` })
      for (const c of l.conflictsWith) if (!levers.has(c)) ctx.addIssue({ code: 'custom', message: `lever "${l.id}" conflicts with unknown lever "${c}"` })
    }
    const baseline = applyLevers(s, [])
    if (baseline.usdPerTask <= s.challenge.targetUsdPerTask) ctx.addIssue({ code: 'custom', message: 'the baseline already meets the target' })
    if (!solveChallenge(s)) ctx.addIssue({ code: 'custom', message: 'the challenge has no solution within maxLevers' })
  })

export type CostWaterfallScenario = z.infer<typeof costWaterfallScenario>
type Core = Pick<CostWaterfallScenario, 'components' | 'levers' | 'baselineQuality' | 'tasksPerMonth'>

export interface Waterfall {
  steps: Array<{ leverId: string; label: string; savedPerTask: number; after: number }>
  byComponent: Record<string, number>
  usdPerTask: number
  usdPerMonth: number
  quality: number
  conflicts: Array<[string, string]>
}

/** Apply levers in order; each multiplies the components it touches. */
export function applyLevers(s: Core, selected: string[]): Waterfall {
  const byComponent = Object.fromEntries(s.components.map((c) => [c.id, c.usdPerTask]))
  const sum = () => Object.values(byComponent).reduce((a, b) => a + b, 0)
  const steps: Waterfall['steps'] = []
  let quality = s.baselineQuality
  for (const id of selected) {
    const lever = s.levers.find((l) => l.id === id)
    if (!lever) continue
    const before = sum()
    for (const e of lever.effects) byComponent[e.component] *= e.multiplier
    quality += lever.qualityDelta
    steps.push({ leverId: id, label: lever.label, savedPerTask: before - sum(), after: sum() })
  }
  const conflicts: Array<[string, string]> = []
  for (const id of selected) {
    for (const c of s.levers.find((l) => l.id === id)?.conflictsWith ?? []) if (selected.includes(c) && id < c) conflicts.push([id, c])
  }
  const usdPerTask = sum()
  return { steps, byComponent, usdPerTask, usdPerMonth: usdPerTask * s.tasksPerMonth, quality: Math.min(1, Math.max(0, quality)), conflicts }
}

export function meetsChallenge(s: Core & Pick<CostWaterfallScenario, 'challenge'>, selected: string[]) {
  const w = applyLevers(s, selected)
  return (
    selected.length <= s.challenge.maxLevers &&
    w.conflicts.length === 0 &&
    w.usdPerTask <= s.challenge.targetUsdPerTask + 1e-12 &&
    w.quality >= s.challenge.minQuality - 1e-12
  )
}

/** Brute force (at most 2^10 subsets): proves the authored challenge is solvable. */
export function solveChallenge(s: Core & Pick<CostWaterfallScenario, 'challenge'>): string[] | undefined {
  const ids = s.levers.map((l) => l.id)
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const pick = ids.filter((_, i) => mask & (1 << i))
    if (pick.length <= s.challenge.maxLevers && meetsChallenge(s, pick)) return pick
  }
  return undefined
}
