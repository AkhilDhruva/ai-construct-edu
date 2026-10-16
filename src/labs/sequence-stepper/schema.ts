import { z } from 'zod'

export const toolResult = z.enum(['SUCCESS', 'EMPTY', 'DENIED', 'UNAVAILABLE', 'INVALID'])

export const traceStepSchema = z.object({
  kind: z.enum(['think', 'tool', 'answer']),
  label: z.string().min(1),
  tokens: z.number().int().nonnegative(),
  ms: z.number().int().nonnegative(),
  // Did this step add new information? N consecutive "false" trips the no-progress detector.
  progress: z.boolean(),
  result: toolResult.optional(),
})

export const boundsSchema = z.object({
  maxSteps: z.number().int().positive(),
  tokenBudget: z.number().int().positive(),
  wallClockSec: z.number().positive(),
  noProgressWindow: z.number().int().positive(),
})

const range = z.object({ min: z.number(), max: z.number(), step: z.number().positive() })

export const traceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  steps: z.array(traceStepSchema).min(1),
})

export const sequenceStepperScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('sequence-stepper'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    defaults: boundsSchema,
    ranges: z.object({ maxSteps: range, tokenBudget: range, wallClockSec: range, noProgressWindow: range }),
    traces: z.array(traceSchema).min(1),
    challenge: z.object({ instruction: z.string().min(1), traceIds: z.array(z.string()).min(1) }),
  })
  .refine((s) => s.challenge.traceIds.every((id) => s.traces.some((t) => t.id === id)), {
    message: 'challenge.traceIds must reference traces',
  })

export type TraceStep = z.infer<typeof traceStepSchema>
export type Trace = z.infer<typeof traceSchema>
export type Bounds = z.infer<typeof boundsSchema>
export type SequenceStepperScenario = z.infer<typeof sequenceStepperScenario>
