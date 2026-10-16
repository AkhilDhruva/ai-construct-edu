import { z } from 'zod'

/** Generic "place each item in the right bucket" lab: memory tiers, gate placement, cost levers… */
export const sortingBoardScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('sorting-board'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    buckets: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), description: z.string().min(1) })).min(2).max(6),
    items: z
      .array(z.object({ id: z.string().min(1), text: z.string().min(1), bucket: z.string().min(1), explanation: z.string().min(1) }))
      .min(4),
    passScore: z.number().min(0).max(1),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.buckets.map((b) => b.id))
    if (ids.size !== s.buckets.length) ctx.addIssue({ code: 'custom', message: 'bucket ids must be unique' })
    if (new Set(s.items.map((i) => i.id)).size !== s.items.length) ctx.addIssue({ code: 'custom', message: 'item ids must be unique' })
    for (const i of s.items) if (!ids.has(i.bucket)) ctx.addIssue({ code: 'custom', message: `item "${i.id}" uses unknown bucket "${i.bucket}"` })
    for (const b of s.buckets) if (!s.items.some((i) => i.bucket === b.id)) ctx.addIssue({ code: 'custom', message: `bucket "${b.id}" has no items` })
  })

export type SortingBoardScenario = z.infer<typeof sortingBoardScenario>

export function scoreSort(s: Pick<SortingBoardScenario, 'items' | 'passScore'>, placed: Record<string, string>) {
  const results = s.items.map((i) => ({ id: i.id, correct: placed[i.id] === i.bucket }))
  const correct = results.filter((r) => r.correct).length
  return { results, correct, total: s.items.length, passed: correct / s.items.length >= s.passScore }
}
