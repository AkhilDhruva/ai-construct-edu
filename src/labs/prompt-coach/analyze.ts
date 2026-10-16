import type { PromptCoachScenario } from './schema'

export interface PromptAnalysis {
  elements: Array<{ id: string; label: string; present: boolean; tip: string }>
  redFlags: Array<{ id: string; label: string; advice: string }>
  score: number
  words: number
  passed: boolean
}

/**
 * Offline coach: deterministic pattern checks for each prompt element plus red
 * flags for sensitive data. API mode (Phase 2) adds a live rewrite on top; the
 * offline result stays the floor.
 */
export function analyzePrompt(text: string, s: Pick<PromptCoachScenario, 'elements' | 'redFlags' | 'passScore'>): PromptAnalysis {
  const elements = s.elements.map((e) => ({
    id: e.id,
    label: e.label,
    tip: e.tip,
    present: e.patterns.some((p) => new RegExp(p, 'i').test(text)),
  }))
  const redFlags = s.redFlags.filter((f) => new RegExp(f.pattern, 'i').test(text)).map(({ id, label, advice }) => ({ id, label, advice }))
  const score = elements.filter((e) => e.present).length / elements.length
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return { elements, redFlags, score, words, passed: score >= s.passScore && redFlags.length === 0 }
}

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string }

/** Word-level diff (LCS) for the before/after view. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/)
  const b = after.split(/(\s+)/)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('removed', a[i++])
    else push('added', b[j++])
  }
  while (i < n) push('removed', a[i++])
  while (j < m) push('added', b[j++])
  return out
}
