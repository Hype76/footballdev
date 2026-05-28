import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseUrl = process.env.STAGING_URL || 'https://football-os-staging.staging.footballplayer.online'
const reportPath = process.env.AUDIT_REPORT_PATH || `staging-click-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
const maxTargetsPerPage = Number(process.env.MAX_TARGETS_PER_PAGE || 30)
const repeatClicksPerTarget = Number(process.env.REPEAT_CLICKS_PER_TARGET || 1)
const defaultTeamLabel = process.env.AUDIT_TEAM_LABEL || 'U12 Demo'
const roleFilter = cleanText(process.env.AUDIT_ROLE || '')
const pageFilter = cleanText(process.env.AUDIT_PATHS || '')

const roleProfiles = [
  { label: 'Club Admin', value: 'admin' },
  { label: 'Team Admin', value: 'head_manager' },
  { label: 'Coach', value: 'coach' },
]

const pagePaths = [
  '/coach',
  '/teams',
  '/players/current',
  '/sessions/start',
  '/match-day',
  '/club-settings',
  '/user-access',
  '/billing',
  '/parent-linking',
  '/polls',
  '/assess-player',
  '/information',
]

const selectedRoleProfiles = roleFilter
  ? roleProfiles.filter((role) => role.label.toLowerCase() === roleFilter.toLowerCase() || role.value.toLowerCase() === roleFilter.toLowerCase())
  : roleProfiles

const selectedPagePaths = pageFilter
  ? pagePaths.filter((path) => pageFilter.split(',').map((value) => cleanText(value)).includes(path))
  : pagePaths

const skipTextPattern = /\b(sign out|delete|confirm|archive|move to trial|move to squad|reset setup|reset previous|clear session|record all|save|upload|choose file|start records|send|mark done|training only|defaults are fine|one admin is enough|skip for now|expand|collapse)\b/i
const skipHrefPattern = /^#|^mailto:|^tel:/i

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function samePath(left, right) {
  return new URL(left, baseUrl).pathname === new URL(right, baseUrl).pathname
}

async function waitForSettled(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)
}

async function gotoWithRetry(page, url, attempts = 3) {
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      return
    } catch (error) {
      lastError = error
      await page.waitForTimeout(750 * attempt)
    }
  }

  throw lastError
}

async function openDemoAccount(page) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await gotoWithRetry(page, `${baseUrl}/sign-in`)
    await waitForSettled(page)

    const demoButton = page.getByRole('button', { name: /^Open demo account$/i })

    if (await demoButton.count()) {
      await demoButton.click()
      await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 30000 }).catch(() => {})
      await page.getByText('First run setup').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
      await waitForSettled(page)
    }

    if (!page.url().includes('/sign-in')) {
      return
    }

    await page.waitForTimeout(1500 * attempt)
  }

  throw new Error('Demo login did not open the authenticated workspace.')
}

async function chooseRoleAndTeam(page, roleValue) {
  const selects = page.locator('select')
  const count = await selects.count()

  if (count > 0 && roleValue) {
    await selects.nth(0).selectOption(roleValue).catch(() => {})
    await page.waitForTimeout(350)
  }

  const teamSelectIndex = await page.evaluate((teamLabel) => {
    const selectsOnPage = Array.from(document.querySelectorAll('select'))
    return selectsOnPage.findIndex((select) =>
      Array.from(select.options).some((option) => cleanOption(option.textContent).includes(teamLabel)))

    function cleanOption(value) {
      return String(value ?? '').replace(/\s+/g, ' ').trim()
    }
  }, defaultTeamLabel)

  if (teamSelectIndex >= 0) {
    const teamValue = await page.evaluate((payload) => {
      const select = Array.from(document.querySelectorAll('select'))[payload.teamSelectIndex]
      return Array.from(select?.options ?? []).find((option) =>
        String(option.textContent ?? '').replace(/\s+/g, ' ').trim().includes(payload.teamLabel))?.value || ''
    }, { teamLabel: defaultTeamLabel, teamSelectIndex })

    if (teamValue) {
      await selects.nth(teamSelectIndex).selectOption(teamValue).catch(() => {})
      await page.waitForTimeout(350)
    }
  }
}

async function collectState(page) {
  return page.evaluate(() => {
    const isVisible = (node) => {
      if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        return false
      }

      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()

      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 0 &&
        rect.height > 0
    }
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

    return {
      title: document.title,
      url: location.href,
      scrollY: window.scrollY,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(isVisible).slice(0, 12).map((node) => clean(node.textContent)),
      dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).map((node) => clean(node.textContent).slice(0, 240)),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).filter(isVisible).map((node) => clean(node.textContent)).slice(0, 12),
      accountUnavailable: document.body.textContent.includes('Account details unavailable'),
      buttons: Array.from(document.querySelectorAll('button')).filter(isVisible).map((node, index) => ({
        index,
        text: clean(node.textContent) || clean(node.getAttribute('aria-label')),
        disabled: node.disabled,
        type: node.type || '',
      })),
      links: Array.from(document.querySelectorAll('a[href]')).filter(isVisible).map((node, index) => ({
        index,
        text: clean(node.textContent) || clean(node.getAttribute('aria-label')),
        href: node.getAttribute('href') || '',
      })),
    }
  })
}

function getSafeTargets(state) {
  const buttonSeen = new Map()
  const buttonTargets = state.buttons
    .filter((button) => button.text && !button.disabled && !skipTextPattern.test(button.text))
    .map((button) => {
      const occurrence = buttonSeen.get(button.text) || 0
      buttonSeen.set(button.text, occurrence + 1)
      return { kind: 'button', index: button.index, occurrence, text: button.text }
    })

  const linkSeen = new Map()
  const linkTargets = state.links
    .filter((link) => link.text && link.href && !skipHrefPattern.test(link.href) && !skipTextPattern.test(link.text))
    .map((link) => {
      const key = `${link.text}|${link.href}`
      const occurrence = linkSeen.get(key) || 0
      linkSeen.set(key, occurrence + 1)
      return { kind: 'link', index: link.index, occurrence, text: link.text, href: link.href }
    })

  return [...buttonTargets, ...linkTargets].slice(0, maxTargetsPerPage)
}

async function closeDialog(page) {
  const dialog = page.locator('[role="dialog"]:visible')

  if (!(await dialog.count())) {
    return
  }

  const cancelButton = dialog.getByRole('button', { name: /^Cancel$/i })

  if (await cancelButton.count()) {
    await cancelButton.first().click().catch(() => {})
  } else {
    await page.keyboard.press('Escape').catch(() => {})
  }

  await page.waitForTimeout(250)
}

async function preparePage(page, path, roleValue) {
  await gotoWithRetry(page, `${baseUrl}${path}`)
  await waitForSettled(page)
  if (page.url().includes('/sign-in')) {
    throw new Error(`Route ${path} redirected to sign-in before audit could run.`)
  }
  await chooseRoleAndTeam(page, roleValue)
  await page.waitForTimeout(250)
}

async function clickTarget(page, path, role, target) {
  await preparePage(page, path, role.value)
  const before = await collectState(page)
  const startedAtTop = before.scrollY <= 20
  let clicked = false
  let error = ''

  try {
    if (target.kind === 'button') {
      const locator = page.locator('button').filter({ hasText: target.text }).nth(target.occurrence || 0)
      await locator.click({ timeout: 7000 })
      clicked = true
    } else {
      const locator = page.locator(`a[href="${target.href}"]`).filter({ hasText: target.text }).nth(target.occurrence || 0)
      await locator.click({ timeout: 7000 })
      clicked = true
    }
  } catch (clickError) {
    error = clickError.message
  }

  await waitForSettled(page)
  const after = await collectState(page)
  const openedDialog = after.dialogs.length > 0
  const navigated = !samePath(before.url, after.url)
  const stayedPut = !openedDialog && !navigated
  const clickRecoveredAfterTimeout = Boolean(error) && (openedDialog || navigated || stayedPut)

  if (clickRecoveredAfterTimeout) {
    error = ''
    clicked = true
  }

  await closeDialog(page)

  return {
    role: role.label,
    path,
    target,
    clicked,
    error,
    clickRecoveredAfterTimeout,
    beforeUrl: before.url,
    afterUrl: after.url,
    startedAtTop,
    openedDialog,
    navigated,
    stayedPut,
    afterHeadings: after.headings.slice(0, 5),
    alerts: after.alerts,
    accountUnavailable: after.accountUnavailable,
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const report = {
    baseUrl,
    createdAt: new Date().toISOString(),
    pagePaths: selectedPagePaths,
    roleProfiles: selectedRoleProfiles.map((role) => role.label),
    maxTargetsPerPage,
    repeatClicksPerTarget,
    pageStates: [],
    clicks: [],
  }

  try {
    await openDemoAccount(page)

    if (!selectedRoleProfiles.length) {
      throw new Error(`No role matched AUDIT_ROLE=${roleFilter}`)
    }

    if (!selectedPagePaths.length) {
      throw new Error(`No page matched AUDIT_PATHS=${pageFilter}`)
    }

    for (const role of selectedRoleProfiles) {
      for (const path of selectedPagePaths) {
        await preparePage(page, path, role.value)
        const state = await collectState(page)
        const targets = getSafeTargets(state)

        report.pageStates.push({
          role: role.label,
          path,
          url: state.url,
          scrollY: state.scrollY,
          headings: state.headings,
          alerts: state.alerts,
          accountUnavailable: state.accountUnavailable,
          safeTargetCount: targets.length,
          targets,
        })

        for (const target of targets) {
          for (let repeat = 1; repeat <= repeatClicksPerTarget; repeat += 1) {
            const clickResult = await clickTarget(page, path, role, target)
            report.clicks.push({ ...clickResult, repeat })
          }
        }
      }
    }
  } finally {
    await browser.close()
  }

  await writeFile(reportPath, JSON.stringify(report, null, 2))

  const failures = report.clicks.filter((click) =>
    click.error ||
    click.accountUnavailable ||
    (!click.openedDialog && !click.navigated && !click.stayedPut) ||
    !click.startedAtTop)

  const modalOpenCount = report.clicks.filter((click) => click.openedDialog).length
  const navigationCount = report.clicks.filter((click) => click.navigated).length
  const stayedPutCount = report.clicks.filter((click) => click.stayedPut).length

  console.log(JSON.stringify({
    reportPath,
    pages: report.pageStates.length,
    clicks: report.clicks.length,
    modalOpenCount,
    navigationCount,
    stayedPutCount,
    repeatClicksPerTarget,
    failureCount: failures.length,
    failures: failures.slice(0, 20),
  }, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
