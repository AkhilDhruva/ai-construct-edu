import { expect, test } from '@playwright/test'
import { axe, onboard, readContent } from './helpers'

interface Coach {
  scenarios: Array<{ id: string; title: string; strongPrompt: string }>
}
interface Sim {
  scenarios: Array<{ id: string; title: string; start: string; steps: Array<{ id: string; prompt: string; choices: Array<{ text: string; quality: string; next?: string }> }> }>
}
const coach = readContent<Coach>('tentacles/enablement-basics/labs/prompt-coach.json')
const sim = readContent<Sim>('tentacles/enablement-basics/labs/workplace-scenarios.json')

test('non-technical journey: enablement plan, no drills, prompt coach and a workplace scenario', async ({ page }) => {
  await onboard(page, { role: 'non-technical', goal: 'enablement' })
  await expect(page.getByTestId('plan-week').getByRole('link').first()).toHaveAttribute('href', /\/t\/enablement-basics\/c\//)
  await expect(page.getByTestId('tentacles-h')).toContainText('Enablement Basics')
  await expect(page.getByTestId('other-h')).toContainText('Tools, Gateway & MCP')
  await axe(page)

  await page.goto('/t/enablement-basics')
  await expect(page.getByRole('heading', { name: 'Design drills' })).toHaveCount(0)
  await axe(page)

  await page.goto('/t/enablement-basics/lab/prompt-coach')
  const s = coach.scenarios[0]
  await page.getByLabel('Workplace task').selectOption(s.id)
  await page.getByLabel('Your prompt').fill(s.strongPrompt)
  await expect(page.getByTestId('coach-score')).toContainText('100%')
  await page.getByRole('button', { name: 'Submit to the coach' }).click()
  await expect(page.getByTestId('coach-result')).toContainText('Strong prompt.')
  await expect(page.getByRole('heading', { name: 'Before and after' })).toBeVisible()
  await axe(page)

  await page.goto('/t/enablement-basics/lab/workplace-scenarios')
  const sc = sim.scenarios[0]
  await page.getByLabel('Scenario').selectOption(sc.id)
  let step = sc.steps.find((x) => x.id === sc.start)
  while (step) {
    const best = step.choices.find((c) => c.quality === 'best')!
    await page.getByTestId('scenario-step').getByRole('button', { name: best.text, exact: true }).click()
    step = best.next ? sc.steps.find((x) => x.id === best.next) : undefined
  }
  await expect(page.getByTestId('scenario-result')).toContainText('Handled safely.')
  await axe(page)
})

test('gateway walkthrough: reorder the stages until every call is correct and safe', async ({ page }) => {
  await onboard(page)
  await page.goto('/t/tools-gateway/lab/gateway-walkthrough')
  await expect(page.getByTestId('gateway-score')).not.toContainText('6 of 6')
  await axe(page)

  const want = ['Authori', 'Validat', 'Execut', 'Type']
  const list = page.getByTestId('stage-order')
  for (let pos = 0; pos < want.length; pos++) {
    for (;;) {
      const labels = await list.locator('li strong').allTextContents()
      const at = labels.findIndex((l) => l.startsWith(want[pos]) || l.toLowerCase().includes(want[pos].toLowerCase()))
      if (at <= pos) break
      await list.locator('li').nth(at).getByRole('button', { name: /up$/ }).click()
    }
  }
  await expect(page.getByTestId('gateway-score')).toContainText('6 of 6')
  await page.getByRole('button', { name: 'Lock in this order' }).click()
  await expect(page.getByRole('button', { name: 'Recorded' })).toBeDisabled()
})

test('concept map and content studio', async ({ page }) => {
  await onboard(page)
  await page.goto('/map')
  await expect(page.getByTestId('concept-map').locator('.react-flow__node.cmap-node')).toHaveCount(20)
  await expect(page.getByTestId('concept-map').locator('.react-flow__node.cmap-lane')).toHaveCount(3)
  await axe(page)

  await page.goto('/settings')
  await page.getByTestId('author-mode').check()
  await page.getByRole('link', { name: 'Studio' }).click()
  await expect(page.getByTestId('studio-gates')).toContainText('All gates green')
  await axe(page)

  await page.getByRole('tab', { name: 'Edit' }).click()
  await page.getByLabel('File').selectOption('tentacles/foundations/cards.json')
  await expect(page.getByTestId('studio-validation')).toContainText('Valid.')
  await page.getByLabel('Front').fill('What does a typed EMPTY result tell the model?')
  await page.getByLabel('Back').fill('The call worked and found nothing, so the model can change its query.')
  await page.getByRole('button', { name: /Add card fnd-031/ }).click()
  await expect(page.getByTestId('studio-validation')).toContainText('Valid.')
  await expect(page.getByText('unsaved draft')).toBeVisible()

  await page.getByLabel('JSON').fill('{ "schemaVersion": 1, "cards": [')
  await expect(page.getByTestId('studio-validation')).toContainText('Not valid JSON')
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page.getByTestId('studio-validation')).toContainText('Valid.')

  await page.getByRole('tab', { name: 'Item health' }).click()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await axe(page)
})
