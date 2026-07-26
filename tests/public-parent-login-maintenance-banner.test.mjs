import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const loginHeaderUrl = new URL('../src/components/login/LoginHeader.jsx', import.meta.url)
const publicPageUrls = [
  new URL('../src/pages/LoginPage.jsx', import.meta.url),
  new URL('../src/pages/PublicLandingPage.jsx', import.meta.url),
  new URL('../src/pages/PublicFeaturesPage.jsx', import.meta.url),
  new URL('../src/pages/PublicParentsPage.jsx', import.meta.url),
  new URL('../src/pages/PublicPricingPage.jsx', import.meta.url),
  new URL('../src/pages/PublicParentPortalLoginPage.jsx', import.meta.url),
]

test('shared public header shows the temporary parent login maintenance notice', async () => {
  const source = await readFile(loginHeaderUrl, 'utf8')

  assert.match(source, /role="status"/)
  assert.match(source, /aria-label="Parent login service update"/)
  assert.match(
    source,
    /Parent login is currently being worked on and may not work until 8:00am on Monday 27 July\./,
  )
})

test('every public landing and login page renders the shared notice header', async () => {
  const pageSources = await Promise.all(publicPageUrls.map((pageUrl) => readFile(pageUrl, 'utf8')))

  for (const source of pageSources) {
    assert.match(source, /import \{ LoginHeader \} from '\.\.\/components\/login\/LoginHeader\.jsx'/)
    assert.match(source, /<LoginHeader logo=\{fallbackLogo\} \/>/)
  }
})
