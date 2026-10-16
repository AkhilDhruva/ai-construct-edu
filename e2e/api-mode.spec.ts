import { expect, test } from '@playwright/test'
import { API_URL } from '../playwright.config'
import { axe, onboard } from './helpers'
import { readFileSync } from 'node:fs'

interface Golden {
  items: Array<{ id: string; drillId: string; kind: string; answer: string; expected: Record<string, number> }>
}
const golden: Golden = JSON.parse(readFileSync(new URL('../api/evals/golden/grader.json', import.meta.url), 'utf8'))

test('API mode: sign in, sync, AI grade, tutor, then degrade to offline within one request', async ({ page }) => {
  await onboard(page)
  await page.goto('/settings')
  await expect(page.getByTestId('api-status')).toContainText('Not configured')
  await page.getByLabel('API URL').fill(API_URL)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByTestId('api-status')).toContainText('Connected')
  await expect(page.getByRole('banner').getByTestId('rung-badge')).toContainText('Rung 0')

  await page.getByLabel('Development user').fill(`e2e-${Date.now()}`)
  await page.getByRole('button', { name: 'Sign in (dev)' }).click()
  await expect(page.getByTestId('account')).toContainText('Signed in as')
  await expect(page.getByTestId('sync-status')).toContainText('Last synced')
  await axe(page)

  // Rubric grading with verified citations, alongside the self-score.
  const item = golden.items.find((i) => i.drillId === 'fnd-drill-support-agent' && i.kind === 'normal' && Object.values(i.expected).reduce((a, b) => a + b) === 12)!
  await page.goto('/t/foundations/drill/fnd-drill-support-agent')
  await page.getByLabel('Your design').fill(item.answer)
  await page.getByRole('button', { name: 'Done: score my answer' }).click()
  await page.getByRole('button', { name: 'Get an AI score' }).click()
  await expect(page.getByTestId('ai-grade-result')).toContainText('AI total:')
  await expect(page.getByTestId('ai-grade-result')).toContainText('Mock grader')
  await axe(page)

  // The tutor answers with its own loop trace.
  await page.goto('/t/foundations/c/bounded-loop')
  await page.getByLabel('Your question').fill('Why do I need four independent bounds?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByTestId('tutor-answer')).toContainText('termination: completed')
  await expect(page.getByTestId('tutor-answer')).toContainText('get_concept → SUCCESS')
  await axe(page)

  // Outage: every API request now fails. One request is enough to fall to rung 4.
  await page.route(`${API_URL}/**`, (route) => route.abort())
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByRole('banner').getByTestId('rung-badge')).toContainText('Rung 4')
  await expect(page.getByTestId('tutor-off')).toBeVisible()

  // The offline floor still works: the concept's quick check grades locally.
  await expect(page.getByTestId('check-runner')).toBeVisible()
  await page.getByTestId('check-runner').getByRole('radio').first().check()
  await page.getByRole('button', { name: 'Check answer' }).click()
  await expect(page.getByTestId('check-runner').getByRole('status').filter({ hasText: /Correct\.|Not quite\./ })).toBeVisible()
})

test('a second device signing in to the same account adopts its learner', async ({ browser }) => {
  const user = `e2e-two-${Date.now()}`
  const connectAndSignIn = async (page: import('@playwright/test').Page) => {
    await page.goto('/settings')
    await page.getByLabel('API URL').fill(API_URL)
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.getByLabel('Development user').fill(user)
    await page.getByRole('button', { name: 'Sign in (dev)' }).click()
    await expect(page.getByTestId('sync-status')).toContainText('Last synced')
  }

  const first = await (await browser.newContext()).newPage()
  await onboard(first)
  await connectAndSignIn(first)
  const firstId = await first.getByTestId('settings-learner-id').textContent()

  const second = await (await browser.newContext()).newPage()
  await onboard(second, { role: 'architect' })
  await second.goto('/settings')
  const before = await second.getByTestId('settings-learner-id').textContent()
  expect(before).not.toBe(firstId)
  await connectAndSignIn(second)
  await expect(second.getByTestId('settings-learner-id')).toHaveText(firstId!)
})
