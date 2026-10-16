import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { LabProps } from './types'

// Engines are lazy-loaded: a learner downloads a lab's code only when they open it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LAB_COMPONENTS: Record<string, LazyExoticComponent<ComponentType<LabProps<any>>>> = {
  'sequence-stepper': lazy(() => import('./sequence-stepper/SequenceStepperLab')),
  'eight-numbers': lazy(() => import('./eight-numbers/EightNumbersLab')),
}
