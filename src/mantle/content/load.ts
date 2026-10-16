import type { z } from 'zod'
import { ENGINE_SCHEMAS } from '../../labs/engines'
import {
  cardsFileSchema,
  checksFileSchema,
  conceptSchema,
  diagnosticFileSchema,
  drillsFileSchema,
  manifestSchema,
  rulesSchema,
  type Card,
  type CheckItem,
  type Concept,
  type DiagnosticItem,
  type DiagnosticTrack,
  type Drill,
  type LabRef,
  type Manifest,
  type Rules,
} from './schemas'

/** Raw content files keyed by path relative to the content root, e.g. "tentacles/foundations/manifest.json". */
export type ContentFiles = Record<string, unknown>

export interface TentacleLab {
  ref: LabRef
  scenario: unknown
}

export interface TentaclePackage {
  manifest: Manifest
  concepts: Concept[]
  cards: Card[]
  checks: CheckItem[]
  drills: Drill[]
  labs: TentacleLab[]
}

export interface ContentIssue {
  where: string
  message: string
}

export interface ContentRegistry {
  packages: TentaclePackage[]
  concepts: Map<string, Concept>
  cards: Map<string, Card>
  checks: Map<string, CheckItem>
  drills: Map<string, Drill>
  labs: Map<string, TentacleLab & { tentacle: string }>
  /** Readiness checks keyed by track (technical, enablement). */
  diagnostics: Partial<Record<DiagnosticTrack, { title: string; items: DiagnosticItem[] }>>
  rules: Rules
  /** Packages that failed validation are reported here and skipped, never a crash. */
  errors: ContentIssue[]
  warnings: ContentIssue[]
}

const TENTACLE_ROOT = 'tentacles/'

function formatZod(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string, errors: ContentIssue[]): T | undefined {
  if (value === undefined) {
    errors.push({ where, message: 'file not found' })
    return undefined
  }
  const r = schema.safeParse(value)
  if (!r.success) {
    errors.push({ where, message: formatZod(r.error) })
    return undefined
  }
  return r.data
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const id of ids) (seen.has(id) ? dup : seen).add(id)
  return [...dup]
}

/** Validate one tentacle folder in isolation. Returns undefined (with errors) if unusable. */
function loadPackage(dir: string, files: ContentFiles, errors: ContentIssue[]): TentaclePackage | undefined {
  const at = (rel: string) => `${TENTACLE_ROOT}${dir}/${rel}`
  const before = errors.length
  const manifest = parse(manifestSchema, files[at('manifest.json')], at('manifest.json'), errors)
  if (!manifest) return undefined
  if (manifest.id !== dir) errors.push({ where: at('manifest.json'), message: `id "${manifest.id}" must match folder "${dir}"` })

  const conceptRe = globToRegExp(at(manifest.concepts))
  const concepts: Concept[] = []
  for (const [path, raw] of Object.entries(files)) {
    if (!conceptRe.test(path)) continue
    const c = parse(conceptSchema, raw, path, errors)
    if (!c) continue
    if (c.tentacle !== manifest.id) errors.push({ where: path, message: `tentacle "${c.tentacle}" must be "${manifest.id}"` })
    concepts.push(c)
  }
  if (concepts.length === 0) errors.push({ where: at(manifest.concepts), message: 'no concepts found' })

  const cards = parse(cardsFileSchema, files[at(manifest.cards)], at(manifest.cards), errors)?.cards ?? []
  const checks = parse(checksFileSchema, files[at(manifest.checks)], at(manifest.checks), errors)?.items ?? []
  const drills = parse(drillsFileSchema, files[at(manifest.drills)], at(manifest.drills), errors)?.drills ?? []

  const labs: TentacleLab[] = []
  for (const ref of manifest.labs) {
    const schema = ENGINE_SCHEMAS[ref.engine]
    if (!schema) {
      errors.push({ where: at('manifest.json'), message: `lab "${ref.id}" uses unknown engine "${ref.engine}"` })
      continue
    }
    const scenario = parse(schema, files[at(ref.scenario)], at(ref.scenario), errors)
    if (scenario !== undefined) labs.push({ ref, scenario })
  }

  // In-package references.
  const conceptIds = new Set(concepts.map((c) => c.id))
  const labIds = new Set(manifest.labs.map((l) => l.id))
  const drillIds = new Set(drills.map((d) => d.id))
  const ref = (where: string, kind: string, id: string, set: Set<string>) => {
    if (!set.has(id)) errors.push({ where, message: `unknown ${kind} "${id}"` })
  }
  for (const c of concepts) {
    c.labs.forEach((id) => ref(at(`concepts/${c.id}.json`), 'lab', id, labIds))
    c.drills.forEach((id) => ref(at(`concepts/${c.id}.json`), 'drill', id, drillIds))
  }
  cards.forEach((c) => ref(at(manifest.cards), 'concept', c.conceptId, conceptIds))
  checks.forEach((c) => ref(at(manifest.checks), 'concept', c.conceptId, conceptIds))
  drills.forEach((d) => d.concepts.forEach((id) => ref(at(manifest.drills), 'concept', id, conceptIds)))
  manifest.labs.forEach((l) => l.concepts.forEach((id) => ref(at('manifest.json'), 'concept', id, conceptIds)))

  for (const [kind, ids] of [
    ['concept', concepts.map((c) => c.id)],
    ['card', cards.map((c) => c.id)],
    ['check', checks.map((c) => c.id)],
    ['drill', drills.map((d) => d.id)],
  ] as const) {
    for (const d of duplicates([...ids])) errors.push({ where: at(''), message: `duplicate ${kind} id "${d}"` })
  }

  if (errors.length > before) return undefined
  return { manifest, concepts, cards, checks, drills, labs }
}

/** Returns one cycle (as a list of ids) if the prerequisite graph has one. */
export function findCycle(edges: Map<string, string[]>): string[] | undefined {
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const visit = (n: string): string[] | undefined => {
    state.set(n, 1)
    stack.push(n)
    for (const m of edges.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m]
      if (!state.has(m)) {
        const c = visit(m)
        if (c) return c
      }
    }
    stack.pop()
    state.set(n, 2)
    return undefined
  }
  for (const n of edges.keys()) {
    if (!state.has(n)) {
      const c = visit(n)
      if (c) return c
    }
  }
  return undefined
}

/**
 * Discover and validate every tentacle package plus the shared engine rules and
 * onboarding diagnostic. Packages are discovered from folder layout only.
 */
export function loadContent(files: ContentFiles): ContentRegistry {
  const errors: ContentIssue[] = []
  const warnings: ContentIssue[] = []

  const dirs = new Set<string>()
  for (const path of Object.keys(files)) {
    const m = path.match(/^tentacles\/([^/]+)\/manifest\.json$/)
    if (m) dirs.add(m[1])
  }

  let packages = [...dirs]
    .map((dir) => loadPackage(dir, files, errors))
    .filter((p): p is TentaclePackage => p !== undefined)

  // Cross-package references: drop packages whose prerequisites do not resolve,
  // repeating until stable because dropping one can orphan another.
  for (;;) {
    const tentacleIds = new Set(packages.map((p) => p.manifest.id))
    const conceptIds = new Set(packages.flatMap((p) => p.concepts.map((c) => c.id)))
    const bad = new Set<string>()
    for (const p of packages) {
      for (const t of p.manifest.prerequisites) {
        if (!tentacleIds.has(t)) {
          errors.push({ where: `tentacles/${p.manifest.id}/manifest.json`, message: `unknown prerequisite tentacle "${t}"` })
          bad.add(p.manifest.id)
        }
      }
      for (const c of p.concepts) {
        for (const pre of c.prerequisites) {
          if (!conceptIds.has(pre)) {
            errors.push({ where: `tentacles/${p.manifest.id}/concepts/${c.id}.json`, message: `unknown prerequisite concept "${pre}"` })
            bad.add(p.manifest.id)
          }
        }
      }
    }
    const dupConcepts = duplicates(packages.flatMap((p) => p.concepts.map((c) => c.id)))
    for (const d of dupConcepts) {
      for (const p of packages.filter((p) => p.concepts.some((c) => c.id === d))) {
        errors.push({ where: `tentacles/${p.manifest.id}`, message: `concept id "${d}" is declared by more than one tentacle` })
        bad.add(p.manifest.id)
      }
    }
    if (bad.size === 0) break
    packages = packages.filter((p) => !bad.has(p.manifest.id))
  }

  const edges = new Map<string, string[]>()
  for (const p of packages) for (const c of p.concepts) edges.set(c.id, c.prerequisites)
  const cycle = findCycle(edges)
  if (cycle) {
    errors.push({ where: 'concept graph', message: `prerequisite cycle: ${cycle.join(' → ')}` })
    const involved = new Set(cycle)
    packages = packages.filter((p) => !p.concepts.some((c) => involved.has(c.id)))
  }

  packages.sort((a, b) => a.manifest.order - b.manifest.order || a.manifest.id.localeCompare(b.manifest.id))

  const rules = parse(rulesSchema, files['engine/rules.json'], 'engine/rules.json', errors)
  if (!rules) throw new Error(`engine/rules.json is invalid: ${errors.map((e) => e.message).join('; ')}`)

  const conceptMap = new Map(packages.flatMap((p) => p.concepts.map((c) => [c.id, c] as const)))
  const diagnostics: ContentRegistry['diagnostics'] = {}
  for (const path of Object.keys(files).filter((p) => /^onboarding\/diagnostic[^/]*\.json$/.test(p)).sort()) {
    const file = parse(diagnosticFileSchema, files[path], path, errors)
    if (!file) continue
    if (diagnostics[file.track]) {
      errors.push({ where: path, message: `a diagnostic for track "${file.track}" already exists` })
      continue
    }
    for (const item of file.items) {
      const unknown = item.concepts.filter((c) => !conceptMap.has(c))
      if (unknown.length) warnings.push({ where: `${path}#${item.id}`, message: `concepts not installed yet: ${unknown.join(', ')}` })
    }
    diagnostics[file.track] = { title: file.title, items: file.items }
  }

  return {
    packages,
    concepts: conceptMap,
    cards: new Map(packages.flatMap((p) => p.cards.map((c) => [c.id, c] as const))),
    checks: new Map(packages.flatMap((p) => p.checks.map((c) => [c.id, c] as const))),
    drills: new Map(packages.flatMap((p) => p.drills.map((d) => [d.id, d] as const))),
    labs: new Map(packages.flatMap((p) => p.labs.map((l) => [l.ref.id, { ...l, tentacle: p.manifest.id }] as const))),
    diagnostics,
    rules,
    errors,
    warnings,
  }
}

const BANNED = /\b(TODO|TBD|lorem|ipsum|FIXME)\b/i
const MAX_SENTENCE_WORDS = 40

function proseOf(p: TentaclePackage): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = []
  const add = (where: string, ...texts: string[]) => texts.forEach((text) => out.push({ where, text }))
  for (const c of p.concepts) {
    add(`concept ${c.id}`, c.point, c.definition, c.objective.text, ...c.layers.l1, ...c.layers.l2, ...c.layers.l3)
    c.misconceptions.forEach((m) => add(`concept ${c.id}`, m.claim, m.correction))
  }
  p.cards.forEach((c) => add(`card ${c.id}`, c.front, c.back))
  for (const i of p.checks) {
    add(`check ${i.id}`, i.stem, i.explanation)
    if (i.kind === 'order') i.items.forEach((x) => add(`check ${i.id}`, x.text))
    else i.options.forEach((o) => add(`check ${i.id}`, o.text, o.feedback))
  }
  for (const d of p.drills) {
    add(`drill ${d.id}`, d.prompt, ...d.outline)
    d.rubric.forEach((r) => add(`drill ${d.id}`, r.criterion, ...r.levels))
  }
  return out
}

/**
 * Publication gates that run in CI and the content studio, not at learner load time:
 * objective coverage (every objective has ≥ 3 cards) and a language check.
 */
export function publicationIssues(registry: ContentRegistry): ContentIssue[] {
  const issues: ContentIssue[] = []
  for (const p of registry.packages) {
    for (const c of p.concepts) {
      const n = p.cards.filter((card) => card.conceptId === c.id).length
      if (n < 3) issues.push({ where: `concept ${c.id}`, message: `objective "${c.objective.id}" has ${n} cards; needs ≥ 3` })
    }
    for (const { where, text } of proseOf(p)) {
      if (BANNED.test(text)) issues.push({ where, message: `placeholder text: "${text.slice(0, 60)}"` })
      if (/ {2,}/.test(text)) issues.push({ where, message: `double space in "${text.slice(0, 60)}"` })
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        const words = sentence.split(/\s+/).filter(Boolean).length
        if (words > MAX_SENTENCE_WORDS) issues.push({ where, message: `sentence of ${words} words (max ${MAX_SENTENCE_WORDS}): "${sentence.slice(0, 60)}…"` })
      }
    }
  }
  return issues
}
