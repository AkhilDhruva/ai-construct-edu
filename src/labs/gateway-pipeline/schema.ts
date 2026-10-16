import { z } from 'zod'
import { runPipeline } from './run'

export const STAGES = ['authorize', 'validate', 'execute', 'type-result'] as const
export const stageId = z.enum(STAGES)
export const typedResult = z.enum(['SUCCESS', 'EMPTY', 'DENIED', 'INVALID', 'UNAVAILABLE'])

export const gatewayPipelineScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('gateway-pipeline'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    stages: z.array(z.object({ id: stageId, label: z.string().min(1), description: z.string().min(1) })).length(4),
    correctOrder: z.array(stageId).length(4),
    startOrder: z.array(stageId).length(4),
    timeoutMs: z.number().int().positive(),
    tool: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      argsSchema: z.string().min(1),
      allowedPrincipals: z.array(z.string().min(1)).min(1),
    }),
    calls: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          principal: z.string().min(1),
          args: z.string().min(1),
          argsValid: z.boolean(),
          latencyMs: z.number().int().nonnegative(),
          upstream: z.enum(['ok', 'empty', 'error']),
          expected: typedResult,
        }),
      )
      .min(3),
    challenge: z.object({ instruction: z.string().min(1) }),
  })
  .refine((s) => new Set(s.correctOrder).size === 4 && new Set(s.startOrder).size === 4, { message: 'orders must be permutations of the four stages' })
  .refine((s) => new Set(s.stages.map((x) => x.id)).size === 4, { message: 'stages must cover all four ids' })
  .superRefine((s, ctx) => {
    // Authored expectations must match what the correct pipeline actually returns.
    for (const call of s.calls) {
      const got = runPipeline(s.correctOrder, call, s.tool.allowedPrincipals, s.timeoutMs)
      if (got.result !== call.expected || got.hazards.length) {
        ctx.addIssue({ code: 'custom', path: ['calls'], message: `call "${call.id}" expects ${call.expected} but the correct order gives ${got.result}` })
      }
    }
  })

export type GatewayPipelineScenario = z.infer<typeof gatewayPipelineScenario>
export type StageId = z.infer<typeof stageId>
export type TypedResult = z.infer<typeof typedResult>
export type GatewayCall = GatewayPipelineScenario['calls'][number]
