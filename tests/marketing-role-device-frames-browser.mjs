import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {createServer} from 'vite'
import {chromium} from 'playwright'

const [hosted, label = 'local'] = process.argv.slice(2)
const directory = `output/playwright/role-device-frames/${label}`
await fs.mkdir(directory, {recursive: true})
const references = JSON.parse(await fs.readFile('src/components/marketing/reference-pages.json', 'utf8'))
const mapping = {
 home: {path: '/', heading: 'A different view.The same team.', initial: 'coach'},
 teams: {path: '/for-teams', heading: 'A different view.The same team.', initial: 'coach'},
 clubs: {path: '/clubs', heading: 'Support the club.Keep teams moving.', initial: 'club'},
}
assert.deepEqual(Object.keys(references).filter(key => references[key].html.includes('data-view-image')).sort(), Object.keys(mapping).sort(), 'Every shared role-tab instance must be covered')
const roles = {
 coach: {kind: 'mobile', image: '/marketing-v70/assets/coach-light.png', title: 'Know what needs your attention.'},
 parent: {kind: 'mobile', image: '/marketing-v70/assets/parent-matchday.png', title: 'The plan, without the guesswork.'},
 club: {kind: 'desktop', image: '/marketing-v70/assets/club-settings-simon.png?v=76', title: 'A shared home for your teams.'},
}
// Forward, reverse, then alternating transitions expose retained frame state.
const sequence = ['coach', 'parent', 'club', 'parent', 'coach', 'club', 'coach', 'parent', 'club']
let server, origin = hosted
if (!hosted) {
 await fs.writeFile('output/role-device-frames.html', `<html><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import {MarketingPage} from '/src/components/marketing/MarketingPage.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(React.createElement(MarketingPage,{page:new URLSearchParams(location.search).get('page')}));</script></body></html>`)
 server = await createServer({server: {host: '127.0.0.1', port: 0, watch: {ignored: ['**/output/**']}}})
 await server.listen()
 origin = 'http://127.0.0.1:' + server.httpServer.address().port
}
const browser = await chromium.launch({headless: true}), page = await browser.newPage()
const errors = [], writes = [], results = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => {
 const request = route.request(), url = new URL(request.url())
 if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {writes.push(url.pathname); return route.abort()}
 if (!hosted && url.origin !== origin) return route.abort()
 if (!hosted && url.pathname.startsWith('/.netlify/functions/')) return route.fulfill({json: {success: true, promotion: null}})
 return route.continue()
})
try {
 for (const width of [320, 390, 768, 1280, 1440]) for (const [key, instance] of Object.entries(mapping)) {
  console.log(`Checking ${key} role frames at ${width}px`)
  await page.setViewportSize({width, height: 900})
  await page.goto(origin + (hosted ? instance.path : '/output/role-device-frames.html?page=' + key), {waitUntil: 'networkidle'})
  const section = page.locator('.feature-layout').filter({has: page.locator('[data-view-image]')})
  assert.equal(await section.count(), 1, key + ' mapped role section')
  assert.equal((await section.locator('h2').textContent()).replace(/\s+/g, ' ').trim(), instance.heading)
  const visited = new Set()
  for (const [index, role] of [instance.initial, ...sequence].entries()) {
   if (index) await section.locator(`[data-view="${role}"]`).click()
   const expected = roles[role], image = section.locator('[data-view-image]')
   await image.scrollIntoViewIfNeeded()
   await page.waitForFunction(src => {
    const image = document.querySelector('.feature-layout [data-view-image]')
    return image?.getAttribute('src') === src && image.complete && image.naturalWidth > 0
   }, expected.image)
   await image.evaluate(element => element.decode())
   const state = await image.evaluate(element => {
    const frame = element.closest('.feature-device'), style = getComputedStyle(element)
    const after = frame ? getComputedStyle(frame, '::after') : null
    return {src: element.getAttribute('src'), kind: frame?.dataset.viewKind, frameCount: element.closest('.feature-visual').querySelectorAll('.feature-device').length,
     fixedLaptop: !!element.closest('.laptop-frame,.laptop-screen,.laptop-scene'), imageClass: element.className, imageWidth: element.naturalWidth, imageHeight: element.naturalHeight,
     radius: style.borderRadius, frameDisplay: frame && getComputedStyle(frame).display, baseContent: after?.content, baseDisplay: after?.display, baseHeight: after?.height, baseBackground: after?.backgroundImage}
   })
   const context = `${key} ${width}px switch${index} ${role}`
   assert.equal(state.frameCount, 1, context + ' has one role-aware frame')
   assert.equal(state.kind, expected.kind, context + ' semantic frame type')
   assert.equal(state.fixedLaptop, false, context + ' must not inherit a fixed laptop shell')
   assert.equal(state.src, expected.image, context + ' original role image')
   assert.equal(await section.locator('[aria-pressed="true"]').getAttribute('data-view'), role)
   assert.equal(await section.locator('[data-view-title]').textContent(), expected.title)
   assert.equal(await section.locator('[data-view-caption]').textContent(), role === 'club' ? 'Screens from Football Player in a web browser' : 'Screens from the Football Player mobile app')
   if (role === 'club') {
    assert.ok(state.imageWidth > state.imageHeight, context + ' landscape Club screenshot')
    assert.equal(state.imageClass, 'desktop'); assert.equal(state.frameDisplay, 'block')
    assert.equal(state.radius, '8px 8px 2px 2px', context + ' laptop screen corners')
    assert.equal(state.baseContent, '""', context + ' visible laptop base generated')
    assert.equal(state.baseDisplay, 'block'); assert.equal(state.baseHeight, '14px')
    assert.ok(state.baseBackground.includes('linear-gradient'), context + ' laptop base material')
   } else {
    assert.ok(state.imageHeight > state.imageWidth * 1.7, context + ' portrait app screenshot')
    assert.equal(state.imageClass, 'mobile'); assert.equal(state.frameDisplay, 'contents')
    assert.equal(state.radius, '28px', context + ' phone corners')
    assert.ok(['none', 'normal'].includes(state.baseContent), context + ' no laptop base on a phone')
   }
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, context + ' no overflow')
   if (!visited.has(role)) {await section.screenshot({path: `${directory}/${key}-${role}-${width}.png`}); visited.add(role)}
   results.push({page: key, width, switch: index, role, semanticFrame: role === 'club' ? 'laptop' : 'phone'})
  }
  // Separate hero laptop placements must retain their original screenshot and shell.
  if (key === 'teams') assert.equal(await page.locator('.subhero .laptop-screen img').getAttribute('src'), roles.club.image)
  if (key === 'clubs') assert.equal(await page.locator('.club-wide-screen img').getAttribute('src'), roles.club.image)
 }
 assert.deepEqual(errors, []); assert.deepEqual(writes, [])
 await fs.writeFile(directory + '/results.json', JSON.stringify({mapping, sequence, results, errors, writes}, null, 2))
 console.log(JSON.stringify({status: 'PASS', instances: 3, viewports: 5, semanticStates: results.length, repeatedSwitches: results.length - 15, errors, writes}))
} finally {await browser.close(); if (server) await server.close()}
