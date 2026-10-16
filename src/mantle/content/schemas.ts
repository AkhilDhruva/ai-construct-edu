import { z } from 'zod'

// One schema set validates content at authoring time (scripts/validate-content.ts),
// in CI, and at load time in the browser (registry.ts). Content is data; nothing in
// Mantle lists tentacles, concepts or cards by name.

export const SCHEMA_VERSION = 1 as const

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case')
const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'must be semver x.y.z')
const prose = z.string().trim().min(1)
export const depth = z.union([z.literal(1), z.literal(2), z.literal(3)])
export const audience = z.enum(['engineer', 'architect', 'non-technical'])
export const goal = z.enum(['interview', 'enablement', 'capstone'])

// ── Tentacle manifest ────────────────────────────────────────────────────────
export const labRef = z.object({
  id: slug,
  title: prose,
  engine: slug,
  scenario: z.string().min(1),
  concepts: z.array(slug).min(1),
})

export const manifestSchema = z
  .object({
    id: slug,
    version: semver,
    schemaVersion: z.literal(SCHEMA_VERSION),
    title: prose,
    summary: prose,
    route: z.string().regex(/^\/t\/[a-z0-9-]+$/),
    bookSource: prose,
    audience: z.array(audience).min(1),
    order: z.number().int().nonnegative(),
    concepts: z.string().min(1),
    labs: z.array(labRef),
    cards: z.string().min(1),
    checks: z.string().min(1),
    drills: z.string().min(1),
    prerequisites: z.array(slug),
    depthLevels: z.array(depth).min(1),
    capabilities: z.object({ coach: z.boolean(), tutor: z.boolean() }),
    estimatedMinutes: z.number().int().positive(),
    passMark: z.number().min(0).max(1).default(0.8),
  })
  .refine((m) => m.route === `/t/${m.id}`, { message: 'route must be /t/<id>', path: ['route'] })

// ── Concept ──────────────────────────────────────────────────────────────────
export const conceptSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: slug,
  tentacle: slug,
  title: prose,
  point: prose,
  definition: prose,
  level: z.number().int().min(0).max(3),
  objective: z.object({ id: slug, text: prose }),
  misconceptions: z.array(z.object({ claim: prose, correction: prose })).length(2),
  layers: z.object({
    l1: z.array(prose).min(1),
    l2: z.array(prose).min(1),
    l3: z.array(prose).min(1),
  }),
  prerequisites: z.array(slug),
  labs: z.array(slug),
  drills: z.array(slug),
  goals: z.array(goal).min(1),
  minutes: z.number().int().positive(),
})

// ── Flashcards ───────────────────────────────────────────────────────────────
export const cardSchema = z.object({
  id: slug,
  conceptId: slug,
  depth,
  front: prose,
  back: prose,
  kind: z.enum(['recall', 'apply', 'cloze']),
  tags: z.array(z.string()),
})
export const cardsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  cards: z.array(cardSchema).min(1),
})

// ── Knowledge-check items (discriminated union; new kinds are new members) ──
const option = z.object({ id: slug, text: prose, feedback: prose })
const checkBase = {
  id: slug,
  conceptId: slug,
  depth,
  stem: prose,
  explanation: prose,
}
export const mcqItem = z
  .object({ ...checkBase, kind: z.literal('mcq'), options: z.array(option).min(2), answer: slug })
  .refine((i) => i.options.some((o) => o.id === i.answer), { message: 'answer must be an option id' })
export const multiItem = z
  .object({ ...checkBase, kind: z.literal('multi'), options: z.array(option).min(3), answers: z.array(slug).min(1) })
  .refine((i) => i.answers.every((a) => i.options.some((o) => o.id === a)), { message: 'answers must be option ids' })
export const orderItem = z
  .object({
    ...checkBase,
    kind: z.literal('order'),
    items: z.array(z.object({ id: slug, text: prose })).min(3),
    answer: z.array(slug),
  })
  .refine((i) => i.answer.length === i.items.length && i.items.every((x) => i.answer.includes(x.id)), {
    message: 'answer must be a permutation of item ids',
  })
export const checkItemSchema = z.union([mcqItem, multiItem, orderItem])
export const checksFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  items: z.array(checkItemSchema).min(1),
})

// ── Design drills ────────────────────────────────────────────────────────────
export const drillSchema = z.object({
  id: slug,
  title: prose,
  prompt: prose,
  minutes: z.number().int().positive(),
  concepts: z.array(slug).min(1),
  rubric: z
    .array(z.object({ id: slug, criterion: prose, levels: z.array(prose).length(4) }))
    .length(4),
  passMark: z.number().int().min(0).max(12),
  outline: z.array(prose).min(1),
})
export const drillsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  drills: z.array(drillSchema),
})

// ── Onboarding readiness diagnostic ─────────────────────────────────────────
export const diagnosticItemSchema = z
  .object({
    id: slug,
    stem: prose,
    options: z.array(z.object({ id: slug, text: prose })).min(2),
    answer: slug,
    concepts: z.array(slug).min(1),
  })
  .refine((i) => i.options.some((o) => o.id === i.answer), { message: 'answer must be an option id' })
export const diagnosticFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  items: z.array(diagnosticItemSchema).length(12),
})

// ── Adaptive-engine rules (weights and thresholds are data, not code) ───────
export const rulesSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    strategy: z.literal('rules-v1'),
    masteryThreshold: z.number().min(0).max(1),
    weights: z.object({
      goal: z.number().min(0),
      leverage: z.number().min(0),
      gap: z.number().min(0),
      recency: z.number().min(0),
    }),
    depth: z.object({
      l1Below: z.number().min(0).max(1),
      l3AtOrAbove: z.number().min(0).max(1),
      interviewFastTrackWeeks: z.number().int().positive(),
    }),
    cards: z.object({ dailyMax: z.number().int().positive(), minutesPerCard: z.number().positive() }),
    remediation: z.object({ missesToTrigger: z.number().int().positive() }),
    recency: z.object({ fullDecayDays: z.number().positive() }),
    bkt: z.object({
      learn: z.number().min(0).max(1),
      slip: z.number().min(0).max(1),
      guessMcq: z.number().min(0).max(1),
      guessDesign: z.number().min(0).max(1),
      guessRecall: z.number().min(0).max(1),
      depthFactor: z.tuple([z.number(), z.number(), z.number()]),
      lapseStep: z.number().min(0).max(1),
      diagnosticCorrect: z.number().min(0).max(1),
      diagnosticWrong: z.number().min(0).max(1),
      prior: z.number().min(0).max(1),
    }),
    roles: z.object({
      nonTechnicalMaxDepth: depth,
      nonTechnicalStartTentacle: slug,
      architectBoostTentacles: z.array(slug),
      architectBoost: z.number().min(0),
    }),
  })
  .refine((r) => Math.abs(r.weights.goal + r.weights.leverage + r.weights.gap + r.weights.recency - 1) < 1e-6, {
    message: 'weights must sum to 1',
  })

export type Manifest = z.infer<typeof manifestSchema>
export type LabRef = z.infer<typeof labRef>
export type Concept = z.infer<typeof conceptSchema>
export type Card = z.infer<typeof cardSchema>
export type CheckItem = z.infer<typeof checkItemSchema>
export type Drill = z.infer<typeof drillSchema>
export type DiagnosticItem = z.infer<typeof diagnosticItemSchema>
export type Rules = z.infer<typeof rulesSchema>
export type Depth = z.infer<typeof depth>
export type Audience = z.infer<typeof audience>
export type Goal = z.infer<typeof goal>
