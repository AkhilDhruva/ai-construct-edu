import type { z } from 'zod'
import { sequenceStepperScenario } from './sequence-stepper/schema'
import { eightNumbersScenario } from './eight-numbers/schema'

// The lab-engine kit Mantle ships. A tentacle names an engine in its manifest and
// supplies scenario data; it never ships rendering code of its own. This module is
// React-free so the CLI validator can import it.
export const ENGINE_SCHEMAS: Record<string, z.ZodType> = {
  'sequence-stepper': sequenceStepperScenario,
  'eight-numbers': eightNumbersScenario,
}

export const ENGINE_NAMES = Object.keys(ENGINE_SCHEMAS)
