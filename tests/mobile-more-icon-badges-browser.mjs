import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const screens = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
const section = (start, end) => screens.slice(screens.indexOf(start), screens.indexOf(end, screens.indexOf(start)))
const rootModules = path.join(root, 'node_modules')
const parentModules = path.join(root, 'apps/parent-mobile/node_modules')
const result = await build({
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, { useMemo } from 'react'
    import { createRoot } from 'react-dom/client'
    import { Pressable, StyleSheet, Text, View } from 'react-native'
    import { createParentMobileTheme } from './apps/mobile-core/src/parentThemeCore.js'
    const ParentIcon = ({ color, iconKey, size }) => <View accessibilityLabel={iconKey + ' icon'} style={{ backgroundColor: color, borderRadius: 999, height: size, width: size }} />
    ${section('function colorsFor(', 'function Button(')}
    ${section('export function MoreScreen(', 'export async function openExternalParentUrl(')}
    const root = createRoot(document.getElementById('root'))
    window.renderMore = (mode, counts) => {
      const tokens = createParentMobileTheme({ mode }).tokens
      root.render(<View style={{ backgroundColor: tokens.portalBackground, minHeight: 500, padding: 16 }}><MoreScreen onOpen={() => {}} themeTokens={tokens} unansweredInvites={counts.invites} unansweredPolls={counts.polls} unreadNotifications={counts.notifications} /></View>)
    }
  ` },
  write: false,
  bundle: true,
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  alias: {
    'react-native': path.join(parentModules, 'react-native-web'),
    react: path.join(rootModules, 'react'),
    'react-dom': path.join(rootModules, 'react-dom'),
  },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
})
const output = path.join(root, 'output/playwright/more-icon-badges')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 620 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><div id="root"></div></body></html>')
    await page.addScriptTag({ content: result.outputFiles[0].text })
    await page.evaluate(() => window.renderMore('light', { invites: 1, notifications: 2, polls: 3 }))
    for (const [name, count] of [['Notifications, 2 new', '2'], ['Invites, 1 to answer', '1'], ['Polls, 3 to answer', '3']]) {
      const button = page.getByRole('button', { name, exact: true })
      await button.waitFor()
      const badge = button.getByLabel(`${count} new`, { exact: true })
      assert.equal(await badge.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(180, 35, 24)')
      assert.equal(await badge.getByText(count, { exact: true }).count(), 1)
    }
    assert.equal(await page.getByRole('button', { name: /Results/ }).getByLabel(/new/).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: path.join(output, `${width}.png`), fullPage: true })
    await page.close()
  }
  console.log('PASS Parent More icon badges: notifications, invites and polls at 320px and 390px')
} finally {
  await browser.close()
}
