import { loadContent, type ContentFiles, type ContentRegistry } from './load'

// Discovery is by folder layout: dropping content/tentacles/<id>/manifest.json (plus
// its files) into the repo is the whole act of installing a tentacle. Nothing here
// names a tentacle.
const raw = import.meta.glob('/content/**/*.json', { eager: true, import: 'default' })

export function contentFilesFromGlob(modules: Record<string, unknown>): ContentFiles {
  const files: ContentFiles = {}
  for (const [path, value] of Object.entries(modules)) files[path.replace(/^\/content\//, '')] = value
  return files
}

let cached: ContentRegistry | undefined

export function getRegistry(): ContentRegistry {
  if (!cached) {
    cached = loadContent(contentFilesFromGlob(raw))
    for (const e of cached.errors) console.error(`[mantle] content skipped — ${e.where}: ${e.message}`)
    for (const w of cached.warnings) console.warn(`[mantle] ${w.where}: ${w.message}`)
  }
  return cached
}
