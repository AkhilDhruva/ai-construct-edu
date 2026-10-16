// Discovery is by folder layout: dropping content/tentacles/<id>/manifest.json (plus its
// files) into the repo is the whole act of installing a tentacle. Nothing here names a
// tentacle. This module is its own chunk, loaded at boot and precached for offline use.
const raw = import.meta.glob('/content/**/*.json', { eager: true, import: 'default' })

export const files: Record<string, unknown> = Object.fromEntries(
  Object.entries(raw).map(([path, value]) => [path.replace(/^\/content\//, ''), value]),
)
