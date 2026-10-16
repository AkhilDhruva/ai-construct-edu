import type { Depth, LabRef } from '../mantle/content/schemas'

export interface LabEvidence {
  itemId: string
  correct: boolean
  depth: Depth
  answer: unknown
  latencyMs: number
}

/** Every lab engine receives validated scenario data and reports evidence; it never touches storage. */
export interface LabProps<S = unknown> {
  labRef: LabRef
  scenario: S
  onEvidence: (e: LabEvidence) => Promise<void>
}
