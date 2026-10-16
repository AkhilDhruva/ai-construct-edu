import { z } from 'zod'

const regex = z.string().refine(
  (s) => {
    try {
      new RegExp(s, 'i')
      return true
    } catch {
      return false
    }
  },
  { message: 'must be a valid regular expression' },
)

export const promptCoachScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('prompt-coach'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    /** The prompt elements the coach looks for (Role, Task, Context, Format). */
    elements: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          question: z.string().min(1),
          patterns: z.array(regex).min(1),
          tip: z.string().min(1),
        }),
      )
      .min(2),
    /** Patterns that suggest sensitive data was pasted into the prompt. */
    redFlags: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), pattern: regex, advice: z.string().min(1) })),
    scenarios: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          situation: z.string().min(1),
          weakPrompt: z.string().min(1),
          strongPrompt: z.string().min(1),
          notes: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
    /** Fraction of elements a learner prompt must contain to pass. */
    passScore: z.number().min(0).max(1),
  })
  .refine((s) => new Set(s.elements.map((e) => e.id)).size === s.elements.length, { message: 'element ids must be unique' })

export type PromptCoachScenario = z.infer<typeof promptCoachScenario>
