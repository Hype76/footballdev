import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const port = 5200 + Math.floor(Math.random() * 300)
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VITE_APP_URL: base, VITE_PARENT_APP_URL: base } })
let output = ''
server.stdout.on('data', (data) => { output += data })
server.stderr.on('data', (data) => { output += data })
const browser = await chromium.launch({ headless: true })
try {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* Wait for the local server. */ }
    if (attempt === 149) throw new Error(output)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await mkdir('output/playwright/guest-scorer', { recursive: true })
  for (const [width, mode] of [[390, 'light'], [320, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: mode })
    await context.addInitScript(({ mode }) => {
      localStorage.setItem('app-theme-mode', mode)
      localStorage.setItem('fp-guest-scorer', JSON.stringify({ invite: 'a'.repeat(64), token: 'b'.repeat(64), claimed: true, expires: Date.now() + 3600000 }))
    }, { mode })
    const page = await context.newPage()
    const errors = []
    const commands = []
    page.on('pageerror', (error) => errors.push(error.message))
    let match = { id: 'fp-test-match', clubName: 'FP TEST Club', clubLogoUrl: `${base}/test-crest.svg`, themeAccent: '#1d4ed8', teamName: 'U17 Green', opponent: 'Westham', homeAway: 'away', homeScore: 0, awayScore: 0, matchDurationMinutes: 10, clockMode: 'fixed', currentMatchPhase: 'second_half', status: 'second_half', timerStatus: 'paused', timerElapsedSeconds: 340, isToday: true, events: [], players: [{ name: 'Alex', shirtNumber: '9' }, { name: 'Clyde Bates', shirtNumber: '4' }] }
    await page.route('**/*', async (route) => {
      const url = route.request().url()
      if (url.endsWith('/test-crest.svg')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54"><rect width="54" height="54" rx="8" fill="#1d4ed8"/><text x="8" y="34" font-size="23" fill="white">FP</text></svg>' })
      if (url.includes('/.netlify/functions/guest-match-day-scorer')) {
        const command = route.request().postDataJSON()
        if (command.action !== 'read') {
          commands.push(command)
          if (command.action === 'goal') {
            match = { ...match, homeScore: match.homeScore + Number(command.details.teamSide === 'opponent'), awayScore: match.awayScore + Number(command.details.teamSide === 'club'), events: [{ ...command.details, id: 'goal-1', eventType: 'goal' }, ...match.events] }
          }
          if (command.action === 'event') match = { ...match, events: [{ ...command.details, id: `event-${commands.length}`, scorerName: command.details.playerName, assistName: command.details.playerOnName }, ...match.events] }
          if (command.action === 'remove_event') match = { ...match, events: match.events.filter((event) => event.id !== command.details.eventId) }
        }
        return route.fulfill({ json: { success: true, status: 'approved', name: 'FP TEST Guest', saved: command.action !== 'read', match } })
      }
      if (url.startsWith(base)) return route.continue()
      if (url.includes('/auth/v1/')) return route.fulfill({ json: { user: null, session: null } })
      return route.fulfill({ json: [] })
    })
    await page.goto(`${base}/guest-scorer`)
    await page.getByRole('button', { name: 'Add goal', exact: true }).waitFor()
    assert.equal(await page.getByAltText('FP TEST Club crest').count(), 1)
    await page.getByText('10 minute match, 5 minutes per half.', { exact: true }).waitFor()
    await page.getByText('5:40', { exact: true }).waitFor()
    for (const name of ['Yellow card', 'Red card', 'Substitution']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Add goal', exact: true }).click()
    const goal = page.getByRole('dialog', { name: 'Add goal', exact: true })
    await goal.getByLabel('Scorer selection', { exact: true }).selectOption('1')
    assert.equal(await goal.getByLabel('Scorer selection', { exact: true }).inputValue(), '1')
    await goal.getByText('Selected: Clyde Bates', { exact: true }).waitFor()
    await goal.getByLabel('Own goal', { exact: true }).check()
    assert.equal(await goal.getByLabel('Goal awarded to').inputValue(), 'opponent')
    assert.equal(await goal.getByLabel('Scorer name', { exact: true }).inputValue(), 'Clyde Bates')
    assert.equal(await goal.getByLabel('Minute', { exact: true }).inputValue(), '6')
    await page.screenshot({ path: `output/playwright/guest-scorer/${mode}-own-goal.png` })
    await goal.getByRole('button', { name: 'Save goal', exact: true }).click()
    await goal.waitFor({ state: 'hidden' })
    assert.equal(commands.at(-1).details.teamSide, 'opponent')
    assert.equal(commands.at(-1).details.isOwnGoal, true)
    await page.getByText('1 : 0', { exact: true }).waitFor()
    for (const [eventType, label] of [['yellow_card', 'Yellow card'], ['red_card', 'Red card'], ['substitution', 'Substitution']]) {
      await page.getByRole('button', { name: label, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: label, exact: true })
      await dialog.getByLabel(`${eventType === 'substitution' ? 'Player off' : 'Player'} selection`, { exact: true }).selectOption('1')
      if (eventType === 'substitution') await dialog.getByLabel('Player on selection', { exact: true }).selectOption('0')
      await dialog.getByRole('button', { name: `Save ${label.toLowerCase()}`, exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(commands.at(-1).action, 'event')
      assert.equal(commands.at(-1).details.eventType, eventType)
      assert.equal(commands.at(-1).details.minute, 6)
    }
    await page.getByRole('button', { name: /Substitution: Clyde Bates/ }).click()
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal(commands.at(-1).action, 'remove_event')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: `output/playwright/guest-scorer/${mode}-timeline.png`, fullPage: true })
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('PASS guest scorer: branding, selected player, own-goal credit, cards, substitutions, removal, 10 minute clock, light/dark and 320/390 widths')
} finally { await browser.close(); server.kill() }
