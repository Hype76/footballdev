import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSquadDecisionEmail, cleanSquadNotificationCopy } from '../src/lib/squad-decision-email.js'

const match = { clubs: { name: 'Example FC', theme_accent: '#1eadb9' }, teams: { name: 'U17 Green' }, opponent: 'Leicester', home_away: 'away', match_date: '2026-10-11', kickoff_time: '10:30:00', venue: 'Town Ground' }

test('selected email contains club branding and home-first fixture details in HTML and plain text', () => {
  const email = buildSquadDecisionEmail({ match, receipt: { decision_status: 'selected', body: 'Alex is in the squad. We look forward to seeing you.' }, logoUrl: 'https://example.com/crest.png' })
  assert.equal(email.subject, 'Example FC: Squad update')
  assert.match(email.html, /#1eadb9/)
  assert.match(email.html, /alt="Example FC crest"/)
  for (const content of [email.html, email.text]) {
    for (const expected of ['U17 Green', 'Leicester v U17 Green', 'Sunday, 11 October 2026', '10:30', 'Town Ground', 'Alex is in the squad.']) assert.ok(content.includes(expected), expected)
  }
})

test('non-selected email is short and respectful without the old closing sentence', () => {
  const body = 'Alex has not been selected for the match this time. Thank you for your support.'
  const email = buildSquadDecisionEmail({ match, receipt: { decision_status: 'not_selected', body } })
  assert.match(email.html, /Squad selection update/)
  for (const content of [email.html, email.text]) {
    assert.match(content, /Not selected this time/)
    assert.match(content, /Alex has not been selected for the match this time\./)
    assert.doesNotMatch(content, /Thank you for your support|Squad confirmed/)
  }
  assert.equal(cleanSquadNotificationCopy('Selected. We look forward to seeing you.'), 'Selected. We look forward to seeing you.')
})

test('missing or unsafe crest uses club initials and text safely escapes user-entered values', () => {
  for (const logoUrl of ['', 'javascript:alert(1)', 'https://127.0.0.1/crest.png']) {
    const email = buildSquadDecisionEmail({ match: { ...match, clubs: { name: 'Town <FC>', theme_accent: 'red;background:url(unsafe)' }, opponent: '<script>bad()</script>' }, receipt: { body: '<img src=x onerror=alert(1)>' }, logoUrl })
    assert.doesNotMatch(email.html, /<img|<script>|onerror="|background:url\(unsafe\)/)
    assert.match(email.html, /Town &lt;FC&gt;/)
    assert.match(email.html, /&lt;img src=x/)
    assert.match(email.html, />T&lt;<\/div>/)
  }
})

test('pale club colours use dark readable initials, and unknown times stay TBC', () => {
  const email = buildSquadDecisionEmail({ match: { ...match, clubs: { name: 'Sunny FC', theme_accent: '#ffffcc' }, kickoff_time_tbc: true, match_date: null, venue: null } })
  assert.match(email.html, /background:#ffffcc;color:#(?:172b24|111827|000000|17362f|0f172a|07110d)/)
  assert.match(email.text, /Date to be confirmed/)
  assert.match(email.text, /Kick-off: Time to be confirmed/)
  assert.doesNotMatch(email.text, /10:30|Venue:|null|undefined/)
})
