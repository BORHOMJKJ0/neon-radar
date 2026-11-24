// The notification compatibility gate: vue-sonner under the production CSP of ui/nginx.conf,
// served by the real UI image. `npm run test:notifications:compat` builds the image and the
// fixture page (/__compat/) and sets NR_NOTIFICATIONS_COMPAT; playwright.config.ts skips it otherwise.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const NGINX = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf-8')
const CSP = /Content-Security-Policy "([^"]+)"/.exec(NGINX)?.[1]
const SEVERITIES = ['success', 'info', 'warning', 'error']

/** Collects console errors, page errors and CSP violations; install before navigating. */
async function problems(page: Page): Promise<string[]> {
  const found: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') found.push(message.text())
  })
  page.on('pageerror', (error) => found.push(error.message))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  return found
}

for (const dir of ['ltr', 'rtl']) {
  for (const width of [1280, 390]) {
    test(`toasts work under the production CSP (${dir}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      const found = await problems(page)
      const response = await page.goto(`/__compat/?dir=${dir}`)
      expect(response?.headers()['content-security-policy']).toBe(CSP)

      for (const severity of SEVERITIES) {
        await page.getByRole('button', { name: severity, exact: true }).click()
      }
      const toaster = page.locator('[data-sonner-toaster]')
      const toasts = page.locator('[data-sonner-toast]')
      await expect(toasts).toHaveCount(4)
      for (const severity of SEVERITIES) {
        await expect(page.locator(`[data-sonner-toast][data-type="${severity}"]`)).toHaveCount(1)
      }
      // Sonner's stylesheet applies, the toasts stack (three shown) at the inline end.
      expect(await toaster.evaluate((list) => getComputedStyle(list).position)).toBe('fixed')
      await expect(toaster).toHaveAttribute('dir', dir)
      await expect(toaster).toHaveAttribute('data-x-position', dir === 'rtl' ? 'left' : 'right')
      await expect(page.locator('[data-sonner-toast][data-visible="true"]')).toHaveCount(3)
      const box = await page.locator('[data-sonner-toast][data-front="true"]').boundingBox()
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)

      // The newest (error) closes with the button, the next (warning) from the keyboard.
      const close = (type: string) =>
        page.locator(`[data-sonner-toast][data-type="${type}"]`).getByRole('button', {
          name: 'Close toast',
        })
      await close('error').click()
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
      await close('warning').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-sonner-toast][data-type="warning"]')).toHaveCount(0)
      expect(found).toEqual([])
    })
  }
}

test('the application loads the host and its styles before its notices', async ({ page }) => {
  const found = await problems(page)
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 503, json: {} }))
  await page.goto('/')
  await expect(page.getByTestId('meta-error')).toBeVisible()
  await expect(page.getByTestId('notification-host')).toHaveCount(1)
  const sonnerRules = await page.evaluate(() =>
    [...document.styleSheets].some((sheet) =>
      [...sheet.cssRules].some((rule) => rule.cssText.includes('[data-sonner-toaster]')),
    ),
  )
  expect(sonnerRules).toBe(true)
  // The browser reports the refused /meta (503) as a failed load; nothing else may appear.
  expect(found.filter((text) => !text.includes('status of 503'))).toEqual([])
})
