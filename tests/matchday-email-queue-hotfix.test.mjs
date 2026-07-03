import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const manageQueueSource = readFileSync(
  new URL('../netlify/functions/manage-scheduled-emails.js', import.meta.url),
  'utf8',
)
const emailQueuePageSource = readFileSync(
  new URL('../src/pages/EmailQueuePage.jsx', import.meta.url),
  'utf8',
)
const matchDayPageSource = readFileSync(
  new URL('../src/pages/MatchDayPage.jsx', import.meta.url),
  'utf8',
)
const availabilityFunctionSource = readFileSync(
  new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url),
  'utf8',
)
const selectVolunteerFunctionSource = readFileSync(
  new URL('../netlify/functions/select-match-day-volunteer.js', import.meta.url),
  'utf8',
)

test('visible email queue excludes internal Match Day operational notifications', () => {
  assert.match(manageQueueSource, /function isVisibleHoldingQueuePayload\(payload\)/)
  assert.match(manageQueueSource, /payload\.visibleInEmailQueue === false/)
  assert.match(manageQueueSource, /payload\.matchDayAvailability \|\| payload\.matchDayRoleSelection \|\| payload\.matchDayAvailabilityChange/)
  assert.match(manageQueueSource, /actorEmail[\s\S]*match-day-system/)
  assert.match(manageQueueSource, /\.filter\(\(row\) => isVisibleHoldingQueuePayload\(row\.payload\)\)/)
  assert.match(manageQueueSource, /\.slice\(0, 100\)[\s\S]*\.map\(normalizeRow\)/)

  assert.match(availabilityFunctionSource, /matchDayAvailability:\s*\{/)
  assert.match(selectVolunteerFunctionSource, /matchDayRoleSelection:\s*\{/)
})

test('queue list returns a plain preview instead of raw email html', () => {
  const normalizeRowStart = manageQueueSource.indexOf('function normalizeRow(row)')
  const normalizeRowEnd = manageQueueSource.indexOf('async function getQueueRow', normalizeRowStart)
  assert.notEqual(normalizeRowStart, -1)
  assert.notEqual(normalizeRowEnd, -1)
  const normalizeRowSource = manageQueueSource.slice(normalizeRowStart, normalizeRowEnd)

  assert.match(manageQueueSource, /function htmlToPlainText\(value\)/)
  assert.match(normalizeRowSource, /previewText: htmlToPlainText\(html\)/)
  assert.doesNotMatch(normalizeRowSource, /\n\s*html:\s*String\(resendPayload\.html/)
})

test('email queue modal hides raw html and shows action errors inside the modal', () => {
  assert.match(emailQueuePageSource, /Message preview/)
  assert.match(emailQueuePageSource, /editDraft\.previewText/)
  assert.match(emailQueuePageSource, /errorMessage=\{errorMessage\}/)
  assert.match(emailQueuePageSource, /errorMessage && !isQueueModalOpen/)
  assert.doesNotMatch(emailQueuePageSource, /Email HTML/)
  assert.doesNotMatch(emailQueuePageSource, /dangerouslySetInnerHTML/)
})

test('queued email updates preserve existing html when the UI only edits metadata', () => {
  assert.match(manageQueueSource, /Object\.prototype\.hasOwnProperty\.call\(body, 'html'\)/)
  assert.match(manageQueueSource, /String\(existingResendPayload\.html \?\? ''\)\.trim\(\) \|\| '<p>No content<\/p>'/)
})

test('match day select and deselect stays unlocked after optional refresh trouble', () => {
  const handlerStart = matchDayPageSource.indexOf('const handleVolunteerSelection = async')
  const handlerEnd = matchDayPageSource.indexOf('const updateGoalForm =', handlerStart)
  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  const handlerSource = matchDayPageSource.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /const result = await selectMatchDayVolunteer/)
  assert.match(handlerSource, /try \{\s*await loadData\(\)\s*\} catch \(refreshError\)/)
  assert.match(handlerSource, /Volunteer selection was saved, but Match Day could not be refreshed/)
  assert.match(handlerSource, /finally \{\s*setActiveMatchId\(''\)/)
  assert.match(selectVolunteerFunctionSource, /catch \(notificationError\)[\s\S]*Volunteer selection was saved, but notification email could not be queued\./)
})
