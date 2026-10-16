import { expect, test, type Page } from '@playwright/test'
import { asOf, type BitemporalScenario } from '../src/labs/bitemporal-timeline/schema'
import { solveChallenge, type CostWaterfallScenario } from '../src/labs/cost-waterfall/schema'
import type { SortingBoardScenario } from '../src/labs/sorting-board/schema'
import type { TraceDebuggerScenario } from '../src/labs/trace-debugger/schema'
import { evaluate, type TrifectaAgent, type TrifectaScenario } from '../src/labs/trifecta/schema'
import { axe, onboard, readContent } from './helpers'

async function solveSorting(page: Page, file: string) {
  const s = readContent<SortingBoardScenario>(file)
  for (const item of s.items) {
    const label = s.buckets.find((b) => b.id === item.bucket)!.label
    await page.getByLabel(`Bucket for: ${item.text}`).selectOption({ label })
  }
  await page.getByRole('button', { name: 'Check my sorting' }).click()
  await expect(page.getByTestId('sort-result')).toContainText(`${s.items.length} of ${s.items.length} placed correctly`)
}

/** Brute-force a safe-and-useful configuration, the same search the schema runs. */
function safeConfig(a: TrifectaAgent) {
  const optional = a.tools.filter((t) => !t.required).map((t) => t.id)
  const required = a.tools.filter((t) => t.required).map((t) => t.id)
  for (let x = 0; x < 1 << optional.length; x++) {
    for (let y = 0; y < 1 << a.mitigations.length; y++) {
      const state = { enabled: [...required, ...optional.filter((_, i) => x & (1 << i))], mitigations: a.mitigations.filter((_, i) => y & (1 << i)).map((m) => m.id) }
      if (evaluate(a, state).safeAndUseful) return state
    }
  }
  throw new Error(`no safe configuration for ${a.id}`)
}

test.beforeEach(async ({ page }) => {
  await onboard(page)
})

test('memory: sort the four tiers and answer bitemporal as-of questions', async ({ page }) => {
  await page.goto('/t/memory-retrieval/lab/memory-sorter')
  await solveSorting(page, 'tentacles/memory-retrieval/labs/memory-sorter.json')
  await axe(page)

  const bt = readContent<BitemporalScenario>('tentacles/memory-retrieval/labs/bitemporal.json')
  await page.goto('/t/memory-retrieval/lab/bitemporal-lab')
  for (const q of bt.questions) {
    const answer = asOf(bt.facts, q.validAt, q.knownAt)
    const label = answer ? `${answer.id}: ${answer.value}` : 'Nothing recorded'
    await page.getByRole('group', { name: q.prompt }).getByLabel(label, { exact: true }).check()
  }
  await page.getByRole('button', { name: 'Check my answers' }).click()
  await expect(page.getByTestId('bt-result')).toContainText(`${bt.questions.length} of ${bt.questions.length} correct`)
  await axe(page)
})

test('evaluation: find the root cause in every trace and sort the evaluation pyramid', async ({ page }) => {
  const td = readContent<TraceDebuggerScenario>('tentacles/evaluation-observability/labs/trace-debugger.json')
  await page.goto('/t/evaluation-observability/lab/trace-debugger')
  for (const t of td.traces) {
    await page.getByLabel('Trace').selectOption(t.id)
    const span = t.spans.find((s) => s.id === t.rootCause)!
    await page.getByTestId('span-table').getByRole('button', { name: span.name, exact: true }).first().click()
    await page.getByRole('button', { name: 'This span is the root cause' }).click()
    await expect(page.getByTestId('td-verdict')).toContainText('Found it.')
  }
  await axe(page)
  await page.goto('/t/evaluation-observability/lab/eval-pyramid-sorter')
  await solveSorting(page, 'tentacles/evaluation-observability/labs/eval-pyramid.json')
})

test('cost: hit the target with the solver’s lever set', async ({ page }) => {
  const cw = readContent<CostWaterfallScenario>('tentacles/cost-finops/labs/cost-waterfall.json')
  const solution = solveChallenge(cw)!
  await page.goto('/t/cost-finops/lab/cost-waterfall')
  await expect(page.getByTestId('cw-challenge')).not.toContainText('Challenge complete')
  for (const id of solution) {
    await page.getByRole('checkbox', { name: new RegExp(`^${cw.levers.find((l) => l.id === id)!.label}`) }).check()
  }
  await expect(page.getByTestId('cw-challenge')).toContainText('Challenge complete')
  await axe(page)
})

test('safety: break the trifecta without breaking the task, and place the gates', async ({ page }) => {
  const tf = readContent<TrifectaScenario>('tentacles/safety-governance/labs/trifecta.json')
  await page.goto('/t/safety-governance/lab/trifecta-check')
  for (const agent of tf.agents) {
    await page.getByLabel('Agent').selectOption(agent.id)
    await expect(page.getByTestId('tf-status')).toContainText('Lethal trifecta')
    const target = safeConfig(agent)
    for (const t of agent.tools) {
      const box = page.getByRole('checkbox', { name: new RegExp(`^${t.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
      if (target.enabled.includes(t.id)) await box.check()
      else await box.uncheck()
    }
    for (const m of agent.mitigations) {
      const box = page.getByRole('checkbox', { name: new RegExp(`^${m.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
      if (target.mitigations.includes(m.id)) await box.check()
      else await box.uncheck()
    }
    await expect(page.getByTestId('tf-status')).toContainText('Trifecta broken and the task still works.')
    await page.getByRole('button', { name: 'Lock in this design' }).click()
    await expect(page.getByTestId('tf-verdict')).toContainText('Safe and useful.')
  }
  await axe(page)
  await page.goto('/t/safety-governance/lab/gate-placement')
  await solveSorting(page, 'tentacles/safety-governance/labs/gate-placement.json')
})
