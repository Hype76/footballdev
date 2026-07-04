import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const tempRoot = await mkdtemp(path.join(tmpdir(), 'fp-confirm-modal-smoke-'))
const tempSrc = path.join(tempRoot, 'src')
const toFsImport = (localPath) => `/@fs/${localPath.replace(/\\/g, '/')}`
const confirmModalImport = toFsImport(path.join(repoRoot, 'src/components/ui/ConfirmModal.jsx'))
const stylesImport = toFsImport(path.join(repoRoot, 'src/index.css'))

const appSource = `
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfirmModal } from '${confirmModalImport}'
import '${stylesImport}'

function App() {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState('light')
  const [requirePassword, setRequirePassword] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', mode === 'dark')
    document.documentElement.classList.toggle('theme-light', mode !== 'dark')
    document.body.classList.toggle('theme-dark', mode === 'dark')
    document.body.classList.toggle('theme-light', mode !== 'dark')
  }, [mode])

  const openDefault = () => {
    setRequirePassword(false)
    setIsOpen(true)
  }

  const openPassword = () => {
    setRequirePassword(true)
    setIsOpen(true)
  }

  return (
    <main className="min-h-screen bg-[var(--app-bg)] p-6 text-[var(--text-primary)]">
      <div
        hidden
        className="border-[var(--border-color)] border-[var(--accent)] border-[var(--danger-border)] bg-[var(--panel-bg)] bg-[var(--panel-soft)] bg-[var(--accent-soft)] bg-[var(--button-primary)] bg-[var(--danger-soft)] text-[var(--text-primary)] text-[var(--text-muted)] text-[var(--text-secondary)] text-[var(--button-primary-text)] text-[var(--danger-text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:bg-[var(--panel-bg)] focus:ring-[var(--accent-soft)] focus:ring-[var(--danger-border)] focus-within:border-[var(--accent)] focus-within:bg-[var(--panel-bg)] focus-within:ring-[var(--accent-soft)] hover:border-[var(--accent)] hover:border-[var(--danger-text)] hover:bg-[var(--panel-bg)] hover:bg-[var(--accent-soft)] hover:bg-[var(--danger-soft)] hover:bg-[var(--accent)]"
      />
      <button type="button" id="light-mode" onClick={() => setMode('light')}>Light mode</button>
      <button type="button" id="dark-mode" onClick={() => setMode('dark')}>Dark mode</button>
      <button type="button" id="open-default" onClick={openDefault}>Open default modal</button>
      <button type="button" id="open-password" onClick={openPassword}>Open password modal</button>
      <ConfirmModal
        isOpen={isOpen}
        onCancel={() => setIsOpen(false)}
        onConfirm={async () => setIsOpen(false)}
        requirePassword={requirePassword}
        confirmLabel={requirePassword ? 'Delete team' : 'Confirm'}
        title="Confirm modal smoke"
        message="Local visual smoke for the shared confirmation modal."
        items={['Player: Alex Morgan', 'Team: Under 12 Green']}
      />
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
`

await mkdir(tempSrc, { recursive: true })
await writeFile(path.join(tempRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/App.jsx"></script>')
await writeFile(path.join(tempSrc, 'App.jsx'), appSource)

const server = await createServer({
  root: tempRoot,
  logLevel: 'silent',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: 'react/jsx-dev-runtime',
        replacement: path.join(repoRoot, 'node_modules/react/jsx-dev-runtime.js'),
      },
      {
        find: 'react/jsx-runtime',
        replacement: path.join(repoRoot, 'node_modules/react/jsx-runtime.js'),
      },
      {
        find: 'react-dom/client',
        replacement: path.join(repoRoot, 'node_modules/react-dom/client.js'),
      },
      {
        find: 'react',
        replacement: path.join(repoRoot, 'node_modules/react/index.js'),
      },
    ],
  },
  server: {
    fs: {
      allow: [repoRoot, tempRoot],
    },
    host: '127.0.0.1',
    port: 0,
  },
})

let browser

try {
  await server.listen()
  const url = server.resolvedUrls.local[0]
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      pageErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })

  await page.goto(url)
  await page.locator('#open-default').waitFor({ timeout: 10000 }).catch(async (error) => {
    const bodyText = await page.locator('body').innerText().catch(() => '')
    throw new Error(`ConfirmModal smoke harness did not render. Body: ${bodyText}. Errors: ${pageErrors.join(' | ')}`, {
      cause: error,
    })
  })
  await page.locator('#open-default').click()

  const dialog = page.locator('[role="dialog"]')
  await assertVisibleAndContained(page, dialog, 1280, 900, pageErrors)

  const lightPanelStyles = await readPanelStyles(dialog)
  assert.equal(lightPanelStyles.backgroundColor, 'rgb(255, 255, 255)')
  assert.notEqual(lightPanelStyles.color, 'rgb(255, 255, 255)')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await dialog.waitFor({ state: 'detached' })

  await page.locator('#dark-mode').click()
  await page.locator('#open-default').click()
  await assertVisibleAndContained(page, dialog, 1280, 900, pageErrors)

  const darkPanelStyles = await readPanelStyles(dialog)
  assert.notEqual(darkPanelStyles.backgroundColor, lightPanelStyles.backgroundColor)

  await page.getByRole('button', { name: 'Cancel' }).click()
  await dialog.waitFor({ state: 'detached' })

  await page.locator('#light-mode').click()
  await page.locator('#open-password').click()
  await page.getByRole('button', { name: 'Delete team' }).click()
  await page.getByText('Enter your password to confirm this action.').waitFor()
  await page.getByLabel('Enter your password to confirm').fill('local-only-password')
  await page.getByRole('button', { name: 'Show' }).click()
  await page.getByRole('button', { name: 'Hide' }).waitFor()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await dialog.waitFor({ state: 'detached' })

  await page.setViewportSize({ width: 390, height: 740 })
  await page.locator('#open-default').click()
  await assertVisibleAndContained(page, dialog, 390, 740, pageErrors)
} finally {
  if (browser) {
    await browser.close()
  }

  await server.close()
  await rm(tempRoot, { recursive: true, force: true })
}

async function readPanelStyles(dialog) {
  return dialog.evaluate((element) => {
    const styles = getComputedStyle(element)

    return {
      backgroundColor: styles.backgroundColor,
      color: styles.color,
    }
  })
}

async function assertVisibleAndContained(page, dialog, viewportWidth, viewportHeight, pageErrors) {
  await dialog.waitFor().catch(async (error) => {
    const bodyText = await page.locator('body').innerText().catch(() => '')
    throw new Error(`ConfirmModal dialog did not render. Body: ${bodyText}. Errors: ${pageErrors.join(' | ')}`, {
      cause: error,
    })
  })

  const box = await dialog.boundingBox()
  assert.ok(box, 'ConfirmModal dialog should be visible')
  assert.ok(box.width <= viewportWidth, `dialog width ${box.width} should fit viewport ${viewportWidth}`)
  assert.ok(box.height <= viewportHeight, `dialog height ${box.height} should fit viewport ${viewportHeight}`)
  assert.ok(box.x >= 0, `dialog x position ${box.x} should stay inside the viewport`)
  assert.ok(box.y >= 0, `dialog y position ${box.y} should stay inside the viewport`)
}
