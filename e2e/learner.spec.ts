import { expect, test } from '@playwright/test'
import { axe, onboard, readContent } from './helpers'

interface CheckFixture {
  stem: string
  kind: 'mcq' | 'multi' | 'order'
  answer?: string | string[]
  answers?: string[]
  options?: Array<{ id: string; text: string }>
  items?: Array<{ id: string; text: string }>
}
const CHECKS = readContent<{ items: CheckFixture[] }>('tentacles/foundations/checks.json').items
const optionText = (item: CheckFixture, id: string) => item.options!.find((o) => o.id === id)!.text

test('onboarding mints an ID, runs the diagnostic and builds a plan', async ({ page }) => {
  await onboard(page)
  await expect(page.getByTestId('rung-badge')).toContainText('Rung 4')
  await expect(page.getByText(/Why your plan changed/)).toBeVisible()
  await axe(page)
})

test('concept explainer → bounded loop lab → predict-the-bound challenge', async ({ page }) => {
  await onboard(page)
  await page.goto('/t/foundations/c/bounded-loop')
  await expect(page.getByTestId('explainer')).toBeVisible()
  await axe(page)

  await page.getByRole('link', { name: /Open Bounded Loop Simulator/ }).click()
  await page.getByLabel('Recorded trace').selectOption('giant-document')
  await page.getByRole('button', { name: 'Skip to end' }).click()
  await expect(page.getByTestId('termination')).toContainText('token-budget')
  await axe(page)

  await page.getByRole('tab', { name: /Challenge/ }).click()
  const challenge = page.getByTestId('loop-challenge')
  for (const [trace, answer] of [
    ['Flip-flopping planner', 'step-ceiling'],
    ['Re-reading a giant document', 'token-budget'],
    ['Slow dependency', 'wall-clock'],
  ]) {
    await challenge.getByRole('group', { name: trace }).getByLabel(answer).check()
  }
  await page.getByRole('button', { name: 'Lock in predictions' }).click()
  await expect(page.getByText('3 of 3 predicted correctly.')).toBeVisible()
})

test('design console challenge passes when steps are cut', async ({ page }) => {
  await onboard(page)
  await page.goto('/t/foundations/lab/design-console')
  await page.getByRole('button', { name: 'Start the challenge' }).click()
  await expect(page.getByTestId('check-success')).toContainText('fail')
  await expect(page.getByLabel(/p95 latency target/)).toBeDisabled()
  const steps = page.getByLabel(/Steps per task/)
  await steps.fill('7')
  await expect(page.getByTestId('console-challenge')).toContainText('Challenge complete')
  await axe(page)
})

test('the full knowledge check is passed at 80% through the UI', async ({ page }) => {
  await onboard(page)
  await page.goto('/t/foundations/check')
  const runner = page.getByTestId('check-runner')
  for (let i = 0; i < CHECKS.length; i++) {
    await expect(runner.getByText(`Question ${i + 1} of ${CHECKS.length}`)).toBeVisible()
    const stem = (await runner.getByRole('heading', { level: 3 }).textContent())!.trim()
    const item = CHECKS.find((c) => c.stem === stem)!
    if (item.kind === 'mcq') {
      await runner.getByRole('radio', { name: optionText(item, item.answer as string), exact: true }).check()
    } else if (item.kind === 'multi') {
      for (const a of item.answers!) await runner.getByRole('checkbox', { name: optionText(item, a), exact: true }).check()
    } else {
      const want = (item.answer as string[]).map((id) => item.items!.find((x) => x.id === id)!.text)
      for (let pos = 0; pos < want.length; pos++) {
        const current = await runner.locator('ol.step-list > li span[style*="flex: 1"]').allTextContents()
        for (let j = current.indexOf(want[pos]); j > pos; j--) {
          await runner.getByRole('button', { name: `Move "${want[pos]}" up` }).click()
        }
      }
    }
    await runner.getByRole('radio', { name: 'high', exact: true }).check()
    await page.getByRole('button', { name: 'Check answer' }).click()
    await expect(runner.getByText('Correct.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: i === CHECKS.length - 1 ? 'See result' : 'Next question' }).click()
  }
  await expect(page.getByTestId('check-summary')).toContainText('12 of 12 correct')
  await expect(page.getByTestId('check-summary')).toContainText('Passed')
  await page.goto('/t/foundations')
  await expect(page.getByText('Best so far: 100%')).toBeVisible()
})

test('review, trace, settings and offline mode', async ({ page, context }) => {
  await onboard(page)
  await page.goto('/t/foundations/c/what-is-an-agent')
  await expect(page.getByTestId('explainer')).toBeVisible()

  await page.goto('/review')
  await expect(page.getByTestId('flashcard')).toBeVisible()
  await page.getByRole('button', { name: /Show answer/ }).click()
  await page.getByRole('button', { name: /Good/ }).click()
  await axe(page)

  await page.goto('/trace')
  await expect(page.getByText('learner.card').first()).toBeVisible()
  await expect(page.getByText('concept.open').first()).toBeVisible()
  await axe(page)

  await page.goto('/settings')
  const id = await page.getByTestId('settings-learner-id').textContent()
  await axe(page)

  // Offline floor: once the service worker has the app cached, a reload with no network still works.
  await page.waitForFunction(async () => Boolean(await navigator.serviceWorker?.ready))
  await page.reload()
  await context.setOffline(true)
  await page.goto('/t/foundations/lab/bounded-loop-sim')
  await expect(page.getByRole('heading', { name: 'Bounded Loop Simulator' })).toBeVisible()
  await page.goto('/settings')
  await expect(page.getByTestId('settings-learner-id')).toHaveText(id!)
  await context.setOffline(false)
})
