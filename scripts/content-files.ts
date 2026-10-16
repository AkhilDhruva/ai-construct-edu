import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Read every JSON file under a content root into the same shape the browser glob produces. */
export function readContentDir(root: string): Record<string, unknown> {
  const files: Record<string, unknown> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.json')) {
        const key = relative(root, full).split(sep).join('/')
        try {
          files[key] = JSON.parse(readFileSync(full, 'utf8'))
        } catch (e) {
          files[key] = { __parseError: String(e) }
        }
      }
    }
  }
  walk(root)
  return files
}
