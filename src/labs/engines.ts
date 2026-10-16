import type { z } from 'zod'
import { bitemporalScenario } from './bitemporal-timeline/schema'
import { costWaterfallScenario } from './cost-waterfall/schema'
import { eightNumbersScenario } from './eight-numbers/schema'
import { gatewayPipelineScenario } from './gateway-pipeline/schema'
import { promptCoachScenario } from './prompt-coach/schema'
import { scenarioSimScenario } from './scenario-sim/schema'
import { sequenceStepperScenario } from './sequence-stepper/schema'
import { sortingBoardScenario } from './sorting-board/schema'
import { traceDebuggerScenario } from './trace-debugger/schema'
import { trifectaScenario } from './trifecta/schema'

// The lab-engine kit Mantle ships. A tentacle names an engine in its manifest and
// supplies scenario data; it never ships rendering code of its own. This module is
// React-free so the CLI validator can import it.
export const ENGINE_SCHEMAS: Record<string, z.ZodType> = {
  'sequence-stepper': sequenceStepperScenario,
  'eight-numbers': eightNumbersScenario,
  'gateway-pipeline': gatewayPipelineScenario,
  'prompt-coach': promptCoachScenario,
  'scenario-sim': scenarioSimScenario,
  'sorting-board': sortingBoardScenario,
  'bitemporal-timeline': bitemporalScenario,
  'trace-debugger': traceDebuggerScenario,
  'cost-waterfall': costWaterfallScenario,
  trifecta: trifectaScenario,
}

export const ENGINE_NAMES = Object.keys(ENGINE_SCHEMAS)
