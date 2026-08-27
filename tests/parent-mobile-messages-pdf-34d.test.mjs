import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  getSafeParentMessageUrl,
  presentParentMessageBody,
  presentParentMessages,
} from '../apps/parent-mobile/messagePresentation.js'

const parentAppSource = readFileSync(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const parentDataSource = readFileSync(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8')
const parentDevelopmentSource = readFileSync(new URL('../apps/parent-mobile/parentDevelopment.js', import.meta.url), 'utf8')
const parentPortalSource = readFileSync(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8')
const parentPackage = JSON.parse(readFileSync(new URL('../apps/parent-mobile/package.json', import.meta.url), 'utf8'))

test('plain text Parent messages remain readable', () => {
  const result = presentParentMessageBody('Training starts at 18:00. Bring a water bottle.')

  assert.equal(result.body, 'Training starts at 18:00. Bring a water bottle.')
  assert.deepEqual(result.links, [])
})

test('HTML Parent messages become readable text with HTTPS-only links', () => {
  const result = presentParentMessageBody(`
    <div><strong>Development update</strong></div>
    <p>Your report is ready.<br>Read the next steps.</p>
    <ul><li>Keep practising</li><li><a href="https://footballplayer.online/resources/first-touch">Open resource</a></li></ul>
    <a href="javascript:alert('unsafe')">Unsafe link</a>
    <script>window.privateMessage = 'do not render'</script>
  `)

  assert.match(result.body, /Development update/)
  assert.match(result.body, /Your report is ready\.\nRead the next steps\./)
  assert.match(result.body, /- Keep practising/)
  assert.match(result.body, /Open resource \(https:\/\/footballplayer\.online\/resources\/first-touch\)/)
  assert.match(result.body, /Unsafe link/)
  assert.doesNotMatch(result.body, /<[^>]+>|javascript:|window\.privateMessage|do not render/)
  assert.deepEqual(result.links, ['https://footballplayer.online/resources/first-touch'])
})

test('message presentation preserves relationship identity and rejects unsafe URL schemes', () => {
  const [message] = presentParentMessages([{
    id: 'message-34d',
    body: '<p>Hello &amp; welcome.</p>',
    evaluationId: 'evaluation-34d',
    subject: 'Club update',
  }])

  assert.equal(message.id, 'message-34d')
  assert.equal(message.evaluationId, 'evaluation-34d')
  assert.equal(message.body, 'Hello & welcome.')
  assert.equal(getSafeParentMessageUrl('https://footballplayer.online/help'), 'https://footballplayer.online/help')
  assert.equal(getSafeParentMessageUrl('http://footballplayer.online/help'), '')
  assert.equal(getSafeParentMessageUrl('javascript:alert(1)'), '')
  assert.equal(getSafeParentMessageUrl('data:text/html,unsafe'), '')
})

test('malformed blocked HTML fails closed without exposing script or style content', () => {
  const scriptResult = presentParentMessageBody('<p>Visible update</p><script>window.privateMessage = "do not render"')
  const styleResult = presentParentMessageBody('<p>Visible update</p><style>.tracking { display: block; }')

  assert.equal(scriptResult.body, 'Visible update')
  assert.equal(styleResult.body, 'Visible update')
})

test('Parent app sanitizes messages and exposes only canonical authorised Development PDFs', () => {
  assert.match(parentDataSource, /evaluationId: normalizeText\(/)
  assert.match(parentDataSource, /row\.evaluation_id/)
  assert.match(parentDataSource, /metadata\.reportId/)
  assert.match(parentAppSource, /function prepareResourceItems\(name, items\)/)
  assert.match(parentAppSource, /presentParentMessages\(normalizedItems\)\.filter\(isParentStaffAnnouncement\)/)
  assert.match(parentAppSource, /const linkedReport = development\.items\.find/)
  assert.match(parentAppSource, /linkedReport\?\.canDownloadPdf === true/)
  assert.match(parentAppSource, /label="View Development PDF"/)
  assert.match(parentAppSource, /label="Open secure link"/)
  assert.match(parentAppSource, /getSafeParentMessageUrl\(url\)/)
  assert.match(parentAppSource, /Development PDF unavailable/)
  assert.match(parentPortalSource, /development: '\/api\/parent-development\/history'/)
  assert.doesNotMatch(parentAppSource, /dangerouslySetInnerHTML|WebView/)
})

test('Parent PDF download retains server authority, validates PDF response, and keeps Android viewer access valid', () => {
  assert.match(parentDevelopmentSource, /getAccessToken\(\)/)
  assert.match(parentDevelopmentSource, /Authorization: `Bearer \$\{request\.accessToken\}`/)
  assert.match(parentDevelopmentSource, /parentLinkId: request\.parentLinkId/)
  assert.match(parentDevelopmentSource, /parentLinkId=\$\{encodeURIComponent\(request\.parentLinkId\)\}/)
  assert.match(parentDevelopmentSource, /reportId=\$\{encodeURIComponent\(request\.reportId\)\}/)
  assert.match(parentDevelopmentSource, /report\?\.canDownloadPdf !== true/)
  assert.match(parentDevelopmentSource, /FileSystem\.downloadAsync/)
  assert.match(parentDevelopmentSource, /contentType !== 'application\/pdf'/)
  assert.match(parentDevelopmentSource, /Sharing\.shareAsync/)
  assert.match(parentDevelopmentSource, /FileSystem\.moveAsync\(\{ from: download\.uri, to: destination \}\)/)
  assert.match(parentDevelopmentSource, /if \(await isUsablePdf\(destination\)\)/)
  assert.doesNotMatch(parentDevelopmentSource, /finally\s*\{[\s\S]*deleteAsync\(destination/)
  assert.equal(parentPackage.dependencies['expo-file-system'], '~19.0.24')
  assert.equal(parentPackage.dependencies['expo-sharing'], '~14.0.8')
})
