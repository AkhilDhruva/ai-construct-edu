import rulesJson from '../../../content/engine/rules.json'
import { loadContent, type ContentFiles, type ContentRegistry } from './load'
import { rulesSchema } from './schemas'

/** The raw files as shipped, for the content studio to edit and re-validate. */
export async function loadContentFiles(): Promise<ContentFiles> {
  return (await import('./files')).files
}

let pending: Promise<ContentRegistry> | undefined

/** Load and validate every tentacle once. Invalid packages are reported and skipped. */
export function loadRegistry(): Promise<ContentRegistry> {
  pending ??= loadContentFiles().then((files) => {
    const reg = loadContent(files)
    for (const e of reg.errors) console.error(`[mantle] content skipped — ${e.where}: ${e.message}`)
    for (const w of reg.warnings) console.warn(`[mantle] ${w.where}: ${w.message}`)
    return reg
  })
  return pending
}

/** A typed, empty registry for the moment before content loads (the app shows "Loading" then). */
export function emptyRegistry(): ContentRegistry {
  return {
    packages: [],
    concepts: new Map(),
    cards: new Map(),
    checks: new Map(),
    drills: new Map(),
    labs: new Map(),
    diagnostics: {},
    rules: rulesSchema.parse(rulesJson),
    errors: [],
    warnings: [],
  }
}
