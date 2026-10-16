import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates are YYYY-MM-DD')

export const factSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1),
  /** Valid time: when this was true in the world. */
  validFrom: date,
  validTo: date.nullable(),
  /** System time: when the system learned it, and when a later record replaced it. */
  recordedAt: date,
  supersededAt: date.nullable(),
  note: z.string().min(1),
})

export type Fact = z.infer<typeof factSchema>

/**
 * The bitemporal "as of" query: what did the system believe, at system time `knownAt`,
 * about the world at valid time `validAt`? Dates compare lexicographically (YYYY-MM-DD).
 */
export function asOf(facts: Fact[], validAt: string, knownAt: string): Fact | undefined {
  const visible = facts.filter(
    (f) =>
      f.recordedAt <= knownAt &&
      (f.supersededAt === null || f.supersededAt > knownAt) &&
      f.validFrom <= validAt &&
      (f.validTo === null || validAt < f.validTo),
  )
  return visible.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]
}

export const bitemporalScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('bitemporal-timeline'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    subject: z.string().min(1),
    axis: z.object({ start: date, end: date }),
    facts: z.array(factSchema).min(2),
    questions: z
      .array(z.object({ id: z.string().min(1), prompt: z.string().min(1), validAt: date, knownAt: date, answer: z.string().min(1), explanation: z.string().min(1) }))
      .min(3),
  })
  .superRefine((s, ctx) => {
    for (const q of s.questions) {
      const got = asOf(s.facts, q.validAt, q.knownAt)?.id ?? 'none'
      if (got !== q.answer) ctx.addIssue({ code: 'custom', path: ['questions'], message: `question "${q.id}" expects ${q.answer} but the as-of query returns ${got}` })
    }
    for (const f of s.facts) {
      if (f.validTo !== null && f.validTo <= f.validFrom) ctx.addIssue({ code: 'custom', message: `fact "${f.id}" ends before it starts` })
      if (f.supersededAt !== null && f.supersededAt <= f.recordedAt) ctx.addIssue({ code: 'custom', message: `fact "${f.id}" is superseded before it is recorded` })
    }
  })

export type BitemporalScenario = z.infer<typeof bitemporalScenario>
