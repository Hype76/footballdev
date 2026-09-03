import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const app = await readFile('apps/parent-mobile/App.js', 'utf8')
const section = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)))
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const result = await build({
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { View, Text, Pressable, ScrollView, StyleSheet, Platform, useWindowDimensions } from 'react-native'
    import { createParentMobileTheme } from './apps/mobile-core/src/parentThemeCore.js'
    const ParentIcon = () => <Text>*</Text>
    const ClubBrandLogo = () => null
    const NotificationStatusButton = () => null
    let theme
    const useParentTheme = () => theme
    ${section('function createParentAppPalette(', 'const styles = createParentAppStyles')}
    ${section('function AppHeader(', 'function NotificationStatusButton(')}
    ${section('function SummaryButton(', 'function InfoPanel(')}
    const root = createRoot(document.getElementById('root'))
    window.renderBadgePreview = (mode, unread = 2) => {
      const tokens = createParentMobileTheme({ mode }).tokens
      theme = { palette: createParentAppPalette(tokens), styles: createParentAppStyles(tokens) }
      const links = [{ id: 'one', playerName: 'Child One', teamName: 'Team One', clubName: 'FP TEST Club' }, { id: 'two', playerName: 'Child Two', teamName: 'Team Two' }]
      root.render(<View style={{ backgroundColor: tokens.background, minHeight: 550 }}>
        <AppHeader childCount={2} childSwitcherOpen childNotificationBadges={{ one: 0, two: unread }} links={links} selectedLink={links[0]} theme={mode} onChildChange={() => {}} onToggleChildSwitcher={() => {}} />
        <View style={{ flexDirection: 'row' }}><SummaryButton count={unread} label="Notifications" /><SummaryButton count={0} label="Polls" /></View>
      </View>)
    }
  ` },
  write: false, bundle: true, jsx: 'automatic', loader: { '.js': 'jsx' },
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
})
const output = path.join(root, 'output/playwright/notification-badges')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 600 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><div id="root"></div></body></html>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  for (const mode of ['light', 'dark']) {
    await page.evaluate((mode) => window.renderBadgePreview(mode), mode)
    await page.getByRole('button', { name: 'Child Two, Team Two, 2 unread notifications', exact: true }).waitFor()
    const badge = page.getByRole('button', { name: '2 Notifications', exact: true }).getByText('2', { exact: true })
    assert.equal(await badge.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(185, 28, 28)')
    assert.equal(await badge.evaluate((element) => getComputedStyle(element).color), 'rgb(255, 255, 255)')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    await page.screenshot({ path: path.join(output, `${mode}.png`) })
    await page.evaluate((mode) => window.renderBadgePreview(mode, 0), mode)
    await page.getByRole('button', { name: 'Child Two, Team Two', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: /unread notifications/ }).count(), 0)
  }
  assert.deepEqual(errors, [])
  console.log('PASS Parent badges: light/dark contrast, child-specific unread state, cleared counts, no horizontal overflow')
} finally { await browser.close() }
