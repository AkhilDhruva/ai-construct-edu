import { z } from 'zod'

export const FIELD_KEYS = [
  'tasksPerDay',
  'peakToAverage',
  'stepsPerTask',
  'tokensPerStep',
  'secondsPerStep',
  'stepSuccess',
  'latencyTargetSec',
  'costCeiling',
] as const
export const fieldKey = z.enum(FIELD_KEYS)
export type FieldKey = z.infer<typeof fieldKey>
export type EightNumbers = Record<FieldKey, number>

const values = z.object({
  tasksPerDay: z.number(),
  peakToAverage: z.number(),
  stepsPerTask: z.number(),
  tokensPerStep: z.number(),
  secondsPerStep: z.number(),
  stepSuccess: z.number(),
  latencyTargetSec: z.number(),
  costCeiling: z.number(),
})

export const eightNumbersScenario = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('eight-numbers'),
    id: z.string().min(1),
    brief: z.array(z.string().min(1)).min(1),
    constants: z.object({
      pricePerMTok: z.number().positive(),
      tailFactor: z.number().min(1),
      concurrencyLimit: z.number().positive(),
    }),
    fields: z
      .array(
        z.object({
          key: fieldKey,
          label: z.string().min(1),
          unit: z.string(),
          role: z.enum(['requirement', 'design']),
          min: z.number(),
          max: z.number(),
          step: z.number().positive(),
          help: z.string().min(1),
        }),
      )
      .length(8),
    presets: z
      .array(
        z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          story: z.string().min(1),
          successTarget: z.number().min(0).max(1),
          values,
        }),
      )
      .min(1),
    challenge: z.object({ presetId: z.string().min(1), instruction: z.string().min(1) }),
  })
  .refine((s) => new Set(s.fields.map((f) => f.key)).size === 8, { message: 'fields must cover all eight keys once' })
  .refine((s) => s.presets.some((p) => p.id === s.challenge.presetId), { message: 'challenge.presetId must be a preset' })

export type EightNumbersScenario = z.infer<typeof eightNumbersScenario>
