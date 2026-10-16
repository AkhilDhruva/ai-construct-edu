import type { ContentRegistry } from '../content/load'
import type { Audience, Concept } from '../content/schemas'

export interface ConceptGraph {
  concepts: Map<string, Concept>
  /** Audiences of each concept's tentacle (from its manifest). */
  audience: Map<string, Audience[]>
  /** Topological order (prerequisites first), stable by tentacle order then id. */
  topo: string[]
  /** How many concepts transitively depend on each concept. */
  descendants: Map<string, number>
  contentVersions: Record<string, string>
}

export function buildGraph(registry: Pick<ContentRegistry, 'packages'>): ConceptGraph {
  const concepts = new Map<string, Concept>()
  const audience = new Map<string, Audience[]>()
  const rank = new Map<string, number>()
  registry.packages.forEach((p, i) =>
    p.concepts.forEach((c) => {
      concepts.set(c.id, c)
      audience.set(c.id, p.manifest.audience)
      rank.set(c.id, i)
    }),
  )
  const children = new Map<string, string[]>([...concepts.keys()].map((id) => [id, []]))
  for (const c of concepts.values()) for (const p of c.prerequisites) children.get(p)?.push(c.id)

  // Kahn's algorithm with a deterministic tie-break.
  const indeg = new Map([...concepts.values()].map((c) => [c.id, c.prerequisites.length]))
  const cmp = (a: string, b: string) => rank.get(a)! - rank.get(b)! || concepts.get(a)!.level - concepts.get(b)!.level || a.localeCompare(b)
  const ready = [...concepts.keys()].filter((id) => indeg.get(id) === 0).sort(cmp)
  const topo: string[] = []
  while (ready.length) {
    const id = ready.shift()!
    topo.push(id)
    for (const ch of children.get(id) ?? []) {
      indeg.set(ch, indeg.get(ch)! - 1)
      if (indeg.get(ch) === 0) {
        ready.push(ch)
        ready.sort(cmp)
      }
    }
  }
  if (topo.length !== concepts.size) throw new Error('concept graph has a cycle')

  const descendants = new Map<string, number>()
  const reach = (id: string, seen: Set<string>) => {
    for (const ch of children.get(id) ?? []) if (!seen.has(ch)) {
      seen.add(ch)
      reach(ch, seen)
    }
    return seen
  }
  for (const id of concepts.keys()) descendants.set(id, reach(id, new Set()).size)

  const contentVersions = Object.fromEntries(registry.packages.map((p) => [p.manifest.id, p.manifest.version]))
  return { concepts, audience, topo, descendants, contentVersions }
}
