import { describe, expect, it } from 'vitest'
import { loadContent, publicationIssues } from '../src/mantle/content/load'
import { contentFiles, fixtureTentacle, realRegistry } from './helpers'

describe('content registry', () => {
  it('loads the shipped content with no errors and passes the publication gates', () => {
    const reg = realRegistry()
    expect(reg.errors).toEqual([])
    expect(publicationIssues(reg)).toEqual([])
    const f = reg.packages.find((p) => p.manifest.id === 'foundations')!
    expect(f.concepts).toHaveLength(8)
    expect(f.cards).toHaveLength(30)
    expect(f.checks).toHaveLength(12)
    expect(f.drills).toHaveLength(2)
    expect(f.labs.map((l) => l.ref.engine).sort()).toEqual(['eight-numbers', 'sequence-stepper'])
    expect(reg.diagnostic).toHaveLength(12)
  })

  it('plugs in a second tentacle from files alone, with cross-tentacle prerequisites', () => {
    const reg = loadContent({ ...contentFiles(), ...fixtureTentacle() })
    expect(reg.errors).toEqual([])
    expect(reg.packages.map((p) => p.manifest.id)).toEqual(['foundations', 'memory-retrieval'])
    expect(reg.concepts.get('memory-tiers')?.prerequisites).toEqual(['six-components'])
  })

  it('skips a package that fails validation instead of crashing', () => {
    const bad = fixtureTentacle('broken-one')
    ;(bad['tentacles/broken-one/manifest.json'] as Record<string, unknown>).version = 'one'
    const reg = loadContent({ ...contentFiles(), ...bad })
    expect(reg.packages.map((p) => p.manifest.id)).toEqual(['foundations'])
    expect(reg.errors.some((e) => e.where.includes('broken-one') && e.message.includes('semver'))).toBe(true)
  })

  it('rejects unresolved prerequisites and unknown lab engines', () => {
    const files = { ...contentFiles(), ...fixtureTentacle('memory-retrieval', 'no-such-concept') }
    const reg = loadContent(files)
    expect(reg.packages.map((p) => p.manifest.id)).toEqual(['foundations'])
    expect(reg.errors.some((e) => e.message.includes('no-such-concept'))).toBe(true)

    const files2 = contentFiles()
    const m = files2['tentacles/foundations/manifest.json'] as { labs: Array<{ engine: string }> }
    m.labs[0].engine = 'warp-drive'
    const reg2 = loadContent(files2)
    expect(reg2.packages).toHaveLength(0)
    expect(reg2.errors.some((e) => e.message.includes('warp-drive'))).toBe(true)
  })

  it('detects a prerequisite cycle across tentacles', () => {
    const files = { ...contentFiles(), ...fixtureTentacle() }
    const c = files['tentacles/foundations/concepts/what-is-an-agent.json'] as { prerequisites: string[] }
    c.prerequisites = ['bitemporal']
    const reg = loadContent(files)
    expect(reg.errors.some((e) => e.message.startsWith('prerequisite cycle'))).toBe(true)
  })

  it('flags coverage below three cards per objective', () => {
    const files = contentFiles()
    const cards = files['tentacles/foundations/cards.json'] as { cards: Array<{ conceptId: string }> }
    cards.cards = cards.cards.filter((c) => c.conceptId !== 'bounded-loop')
    const issues = publicationIssues(loadContent(files))
    expect(issues.some((i) => i.message.includes('bounded-loop-obj'))).toBe(true)
  })
})
