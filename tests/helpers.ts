import { resolve } from 'node:path'
import { readContentDir } from '../scripts/content-files'
import { loadContent, type ContentFiles } from '../src/mantle/content/load'

export const contentFiles = (): ContentFiles => structuredClone(readContentDir(resolve(__dirname, '../content')))
export const realRegistry = () => loadContent(contentFiles())

/** A controllable clock for deterministic runtime tests. */
export function fakeClock(startIso = '2026-10-15T09:00:00.000Z') {
  let t = Date.parse(startIso)
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms
    },
  }
}

/** A minimal second tentacle, used to prove plug-in needs zero Mantle code changes. */
export function fixtureTentacle(id = 'fixture-memory', prereq = 'six-components'): ContentFiles {
  const root = `tentacles/${id}`
  const concept = (cid: string, prerequisites: string[]) => ({
    schemaVersion: 1,
    id: cid,
    tentacle: id,
    title: `Concept ${cid}`,
    point: 'Memory reads are bounded and every item carries a source.',
    definition: 'A test concept for the plug-in contract.',
    level: 1,
    objective: { id: `${cid}-obj`, text: 'Classify four memory reads by tier and justify each choice.' },
    misconceptions: [
      { claim: 'More memory is always better.', correction: 'Unbounded reads blow the context budget.' },
      { claim: 'Memory needs no provenance.', correction: 'Every item must carry its source.' },
    ],
    layers: { l1: ['Layer one.'], l2: ['Layer two.'], l3: ['Layer three.'] },
    prerequisites,
    labs: [],
    drills: [],
    goals: ['interview'],
    minutes: 10,
  })
  const card = (n: number, conceptId: string) => ({
    id: `${id}-c${n}`,
    conceptId,
    depth: 1,
    front: `Front ${n}?`,
    back: `Back ${n}.`,
    kind: 'recall',
    tags: ['memory'],
  })
  return {
    [`${root}/manifest.json`]: {
      id,
      version: '0.1.0',
      schemaVersion: 1,
      title: 'Memory & retrieval',
      summary: 'Fixture tentacle.',
      route: `/t/${id}`,
      bookSource: 'Fixture',
      audience: ['engineer'],
      order: 6,
      concepts: 'concepts/*.json',
      labs: [],
      cards: 'cards.json',
      checks: 'checks.json',
      drills: 'drills.json',
      prerequisites: ['foundations'],
      depthLevels: [1, 2, 3],
      capabilities: { coach: false, tutor: true },
      estimatedMinutes: 60,
    },
    [`${root}/concepts/fx-tiers.json`]: concept('fx-tiers', [prereq]),
    [`${root}/concepts/fx-history.json`]: concept('fx-history', ['fx-tiers']),
    [`${root}/cards.json`]: {
      schemaVersion: 1,
      cards: [1, 2, 3].map((n) => card(n, 'fx-tiers')).concat([4, 5, 6].map((n) => card(n, 'fx-history'))),
    },
    [`${root}/checks.json`]: {
      schemaVersion: 1,
      items: [
        {
          id: `${id}-k1`,
          conceptId: 'fx-tiers',
          depth: 2,
          kind: 'mcq',
          stem: 'Pick one.',
          explanation: 'Because.',
          options: [
            { id: 'a', text: 'A', feedback: 'Right.' },
            { id: 'b', text: 'B', feedback: 'Wrong.' },
          ],
          answer: 'a',
        },
      ],
    },
    [`${root}/drills.json`]: { schemaVersion: 1, drills: [] },
  }
}
