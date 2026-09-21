import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const output = 'output/playwright/team-pagination'
await mkdir(output, { recursive: true })
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{Pagination}from'/src/components/ui/Pagination.jsx';import'/src/index.css';
function App(){const[page,setPage]=useState(2);return <div style={{width:280,maxWidth:'100%',padding:16}}><Pagination compact currentPage={page} onPageChange={setPage} pageSize={8} totalItems={14}/></div>};createRoot(document.getElementById('root')).render(<App/>);`
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'pagination-fixture',
    resolveId(id) { if (id === '/__pagination.jsx') return id },
    load(id) { if (id === '/__pagination.jsx') return entry },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url !== '/pagination.html') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__pagination.jsx"></script></body></html>'))
    }) },
  }],
})
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/pagination.html`)
  for (const width of [1346, 390]) {
    await page.setViewportSize({ width, height: 700 })
    const label = page.getByText('2 of 2', { exact: true })
    await label.waitFor()
    assert.equal(await label.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el)
      return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size
    }), 1, 'page indicator remains on one line')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const controls = await page.getByRole('button').evaluateAll(buttons => buttons.map(el => ({height:el.getBoundingClientRect().height,overflows:el.scrollWidth>el.clientWidth})))
    assert.ok(controls.every(button => button.height >= 44 && !button.overflows))
    await page.screenshot({ path: `${output}/${width}.png` })
  }
  assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await page.getByText('Showing 1 to 8 of 14').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Previous', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByText('Showing 9 to 14 of 14').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: compact Teams pagination fits narrow desktop and phone columns, retains touch targets and paging.')
} finally { await browser.close(); await server.close() }
