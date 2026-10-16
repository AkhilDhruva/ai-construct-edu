import { z } from 'zod'

export const choiceQuality = z.enum(['best', 'acceptable', 'risky'])

const stepSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  choices: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        quality: choiceQuality,
        outcome: z.string().min(1),
        next: z.string().min(1).optional(),
      }),
    )
    .min(2),
})

const scenarioSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    setting: z.string().min(1),
    start: z.string().min(1),
    steps: z.array(stepSchema).min(1),
    debrief: z.string().min(1),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.steps.map((st) => st.id))
    if (!ids.has(s.start)) ctx.addIssue({ code: 'custom', message: `start "${s.start}" is not a step`, path: ['start'] })
    for (const st of s.steps) {
      if (!st.choices.some((c) => c.quality === 'best')) ctx.addIssue({ code: 'custom', message: `step "${st.id}" has no best choice`, path: ['steps'] })
      for (const c of st.choices) {
        if (c.next && !ids.has(c.next)) ctx.addIssue({ code: 'custom', message: `choice "${c.id}" points to unknown step "${c.next}"`, path: ['steps'] })
      }
    }
    // Every path must end: no cycles through "next".
    const state = new Map<string, 1 | 2>()
    const byId = new Map(s.steps.map((st) => [st.id, st]))
    const visit = (id: string): boolean => {
      if (state.get(id) === 1) return false
      if (state.get(id) === 2) return true
      state.set(id, 1)
      for (const c of byId.get(id)?.choices ?? []) if (c.next && !visit(c.next)) return false
      state.set(id, 2)
      return true
    }
    if (ids.has(s.start) && !visit(s.start)) ctx.addIssue({ code: 'custom', message: 'scenario steps form a cycle', path: ['steps'] })
  })

export const scenarioSimScenario = z.object({
  schemaVersion: z.literal(1),
  engine: z.literal('scenario-sim'),
  id: z.string().min(1),
  brief: z.array(z.string().min(1)).min(1),
  scenarios: z.array(scenarioSchema).min(1),
})

export type ScenarioSimScenario = z.infer<typeof scenarioSimScenario>
export type MicroScenario = ScenarioSimScenario['scenarios'][number]
export type ChoiceQuality = z.infer<typeof choiceQuality>

/** A scenario passes when no risky choice was taken along the path. */
export function scorePath(qualities: ChoiceQuality[]): { passed: boolean; best: number; risky: number } {
  const best = qualities.filter((q) => q === 'best').length
  const risky = qualities.filter((q) => q === 'risky').length
  return { passed: qualities.length > 0 && risky === 0, best, risky }
}
