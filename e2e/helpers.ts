import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

export const readContent = <T>(rel: string): T => JSON.parse(readFileSync(new URL(`../content/${rel}`, import.meta.url), 'utf8')) as T

const ROLE_LABEL = { engineer: 'Engineer', architect: 'Architect', 'non-technical': /^Non-technical/ } as const
const GOAL_LABEL = {
  interview: /system design interview/,
  capstone: /production agent system/,
  enablement: /safely and productively at work/,
} as const

export async function onboard(page: Page, opts: { role?: keyof typeof ROLE_LABEL; goal?: keyof typeof GOAL_LABEL } = {}) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByTestId('learner-id')).toHaveText(/^[0-9A-Z]{26}$/)
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByRole('radio', { name: GOAL_LABEL[opts.goal ?? 'interview'] }).check()
  await page.getByRole('radio', { name: ROLE_LABEL[opts.role ?? 'engineer'] }).check()
  await page.getByRole('button', { name: 'Start the readiness check' }).click()
  for (let i = 0; i < 12; i++) {
    await page.getByTestId('diagnostic').getByRole('radio').first().check()
    await page.getByRole('button', { name: i === 11 ? 'Finish and build my plan' : 'Next' }).click()
  }
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('plan-week').getByRole('listitem').first()).toBeVisible()
}

export async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const where = (n: (typeof results.violations)[number]['nodes'][number]) => `${n.target.join(' ')} (${n.failureSummary?.split('\n')[1]?.trim() ?? ''})`
  expect(results.violations.map((v) => `${v.id}: ${v.help} @ ${v.nodes.map(where).join(' | ')}`)).toEqual([])
}
