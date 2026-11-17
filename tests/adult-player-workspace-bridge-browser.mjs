import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const compiled = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {switchToMainAppWorkspace,WorkspaceSessionBridge} from './src/lib/workspace-session-bridge.jsx';window.openWorkspace=switchToMainAppWorkspace;if(location.pathname==='/auth-session-bridge')createRoot(document.getElementById('root')).render(<WorkspaceSessionBridge/>);`, resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'import.meta.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES': '"false"', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'bridge-fixtures', setup(api) {
    api.onResolve({ filter: /app-origins\.js$/ }, () => ({ path: 'origins', namespace: 'fixture' }))
    api.onResolve({ filter: /supabase-client\.js$/ }, () => ({ path: 'session', namespace: 'fixture' }))
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'origins'
      ? `export const getMainAppOrigin=()=>'http://app.test';export const isParentPortalHost=host=>host==='parent.test';`
      : `export const supabase={auth:{setSession:async session=>{localStorage.setItem('fixture-session',JSON.stringify(session));return {error:null}}}};`, loader: 'js' }))
  } }],
})
const script = compiled.outputFiles[0].text
const browser = await chromium.launch({ headless: true })
try {
  for (const mode of ['player', 'team']) {
    for (const staleSession of [false, true]) {
      const context = await browser.newContext()
      await context.route(/^http:\/\/(app|parent)\.test\//, async route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script>${script}</script>` }))
      const main = await context.newPage()
      await main.goto('http://app.test/')
      await main.evaluate(stale => {
        sessionStorage.setItem('selected-access-mode', 'parent')
        sessionStorage.setItem('selected-club-id', 'child-club')
        if (stale) localStorage.setItem('fixture-session', 'stale-session')
      }, staleSession)
      // Use the same tab so the destination sessionStorage survives origin changes.
      await main.goto('http://parent.test/')
      await main.evaluate(mode => {
        void window.openWorkspace({ session: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }, targetPath: mode === 'player' ? '/player' : '/coach', accessMode: mode })
      }, mode)
      await main.waitForURL(mode === 'player' ? 'http://app.test/player' : 'http://app.test/coach')
      assert.equal(await main.evaluate(() => sessionStorage.getItem('selected-access-mode')), mode)
      assert.equal(await main.evaluate(() => sessionStorage.getItem('selected-access-mode-explicit')), 'true')
      assert.deepEqual(await main.evaluate(() => JSON.parse(localStorage.getItem('fixture-session'))), { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' })
      if (mode === 'player') assert.equal(await main.evaluate(() => sessionStorage.getItem('selected-club-id')), null)
      await context.close()
    }
  }
  console.log('PASS Player and Coach origin transfer replaces stale Parent mode and transfers absent or stale sessions')
} finally { await browser.close() }
