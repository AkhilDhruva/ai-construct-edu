import { z } from 'zod'

const scalar = z.union([z.string(), z.number(), z.boolean()])

export const spanSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().min(1),
  kind: z.enum(['agent', 'llm', 'tool', 'retrieval', 'guard']),
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  status: z.enum(['ok', 'error', 'slow', 'empty']),
  attributes: z.record(z.string(), scalar),
})

export type Span = z.infer<typeof spanSchema>

export const traceDebuggerScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('trace-debugger'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    traces: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          symptom: z.string().min(1),
          spans: z.array(spanSchema).min(3),
          rootCause: z.string().min(1),
          explanation: z.string().min(1),
        }),
      )
      .min(2),
  })
  .superRefine((s, ctx) => {
    for (const t of s.traces) {
      const ids = new Set(t.spans.map((x) => x.id))
      if (ids.size !== t.spans.length) ctx.addIssue({ code: 'custom', message: `trace "${t.id}" has duplicate span ids` })
      if (t.spans.filter((x) => x.parentId === null).length !== 1) ctx.addIssue({ code: 'custom', message: `trace "${t.id}" needs exactly one root span` })
      for (const x of t.spans) if (x.parentId !== null && !ids.has(x.parentId)) ctx.addIssue({ code: 'custom', message: `span "${x.id}" has unknown parent "${x.parentId}"` })
      if (!ids.has(t.rootCause)) ctx.addIssue({ code: 'custom', message: `trace "${t.id}" root cause "${t.rootCause}" is not a span` })
    }
  })

export type TraceDebuggerScenario = z.infer<typeof traceDebuggerScenario>

export interface SpanNode extends Span {
  depth: number
  children: SpanNode[]
}

/** Depth-first span tree, children in start order: the shape every trace UI renders. */
export function spanTree(spans: Span[]): SpanNode[] {
  const nodes = new Map(spans.map((s) => [s.id, { ...s, depth: 0, children: [] as SpanNode[] }]))
  let root: SpanNode | undefined
  for (const n of nodes.values()) {
    if (n.parentId === null) root = n
    else nodes.get(n.parentId)?.children.push(n)
  }
  const out: SpanNode[] = []
  const walk = (n: SpanNode, depth: number) => {
    n.depth = depth
    out.push(n)
    n.children.sort((a, b) => a.startMs - b.startMs).forEach((c) => walk(c, depth + 1))
  }
  if (root) walk(root, 0)
  return out
}

/** Self cost of each span as a share of the trace total: the "cost heat". */
export function costHeat(spans: Span[]): Map<string, number> {
  const total = spans.reduce((a, s) => a + s.costUsd, 0) || 1
  return new Map(spans.map((s) => [s.id, s.costUsd / total]))
}
