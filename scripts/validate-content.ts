// CI gate: schema validation, cross-references, prerequisite acyclicity,
// objective-to-card coverage and the language check. Exits non-zero on any error.
import { resolve } from 'node:path'
import { loadContent, publicationIssues } from '../src/mantle/content/load'
import { readContentDir } from './content-files'

const root = resolve(process.argv[2] ?? 'content')
const files = readContentDir(root)
const registry = loadContent(files)
const publication = publicationIssues(registry)

for (const w of registry.warnings) console.warn(`warn  ${w.where}: ${w.message}`)
for (const e of registry.errors) console.error(`error ${e.where}: ${e.message}`)
for (const e of publication) console.error(`error ${e.where}: ${e.message}`)

for (const p of registry.packages) {
  const m = p.manifest
  console.log(
    `ok    ${m.id}@${m.version}: ${p.concepts.length} concepts, ${p.cards.length} cards, ${p.checks.length} checks, ` +
      `${p.drills.length} drills, ${p.labs.length} labs`,
  )
}
console.log(`ok    diagnostic: ${registry.diagnostic.length} items; rules: ${registry.rules.strategy}`)

const failures = registry.errors.length + publication.length
if (failures > 0) {
  console.error(`\n${failures} content error(s). Nothing is publishable until they are fixed.`)
  process.exit(1)
}
console.log('\nContent is publishable.')
