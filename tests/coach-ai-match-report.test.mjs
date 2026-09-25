import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCoachAiFacts, buildCoachAiPrompt, canUseCoachAiReport, PILOT_CLUB_ID, validateCoachAiAnswers, validateCoachAiNarrative } from '../netlify/functions/lib/_coach-ai-report.js'
import { canUseCoachAiReportUi } from '../src/lib/coach-ai-report-pilot.js'
import { buildCompletedReportPdf } from '../src/lib/matchday-report-export.js'

const actorId = '125f8546-6050-4622-a71e-e4d544f79132'
const match = {
  id: '6ba209e5-37a8-4c3f-9cc5-a8487605603a', club_id: PILOT_CLUB_ID,
  status: 'full_time', concluded_at: '2026-09-25T10:00:00Z', concluded_by: actorId,
  home_score: 2, away_score: 1, home_away: 'home', opponent: 'Visitors',
  match_date: '2026-09-25', teams: { name: 'Demo FC' }, clubs: { name: 'Football Player Demo FC' },
}
const profile = { club_id: PILOT_CLUB_ID, status: 'active', role: 'coach', role_rank: 20 }

test('pilot generation and save belong only to the concluding coach', () => {
  assert.equal(canUseCoachAiReport(match, actorId, profile), true)
  assert.equal(canUseCoachAiReport({ ...match, club_id: '9fd27b98-f29a-4b07-b809-3ffb3b2df7da' }, actorId, profile), false)
  assert.equal(canUseCoachAiReport({ ...match, concluded_by: 'someone-else' }, actorId, profile), false)
  assert.equal(canUseCoachAiReport({ ...match, concluded_at: null }, actorId, profile), false)
  assert.equal(canUseCoachAiReport(match, actorId, { ...profile, role: 'parent_portal' }), false)
  assert.equal(canUseCoachAiReport(match, actorId, { ...profile, status: 'suspended' }), false)
  assert.equal(canUseCoachAiReportUi({ clubId: PILOT_CLUB_ID, status: 'full_time', concludedAt: match.concluded_at, concludedBy: actorId }, actorId), true)
  assert.equal(canUseCoachAiReportUi({ clubId: PILOT_CLUB_ID, status: 'full_time', concludedAt: match.concluded_at, concludedBy: actorId }, 'another-coach'), false)
})

test('optional coach answers are bounded and cannot alter fact fields', () => {
  assert.deepEqual(validateCoachAiAnswers({}), { flow: '', outstandingPlayers: '', standoutMoment: '', disagreements: '', eventComments: '' })
  assert.throws(() => validateCoachAiAnswers({ score: '3-1' }))
  assert.throws(() => validateCoachAiAnswers({ flow: 'x'.repeat(1001) }))
  assert.throws(() => validateCoachAiNarrative(''))
})

test('generation prompt separates recorded facts from coach opinion', () => {
  const facts = buildCoachAiFacts(match)
  assert.equal(facts.score, '2 - 1')
  const prompt = buildCoachAiPrompt(facts, validateCoachAiAnswers({ disagreements: 'I thought it was 3-1.' }))
  assert.match(prompt, /verified Match Day facts.*authoritative/i)
  assert.match(prompt, /coach.s view/i)
  assert.match(prompt, /2 - 1/)
  assert.match(prompt, /I thought it was 3-1/)
})

test('long edited narrative creates a valid multi-page branded PDF', () => {
  const pdf = buildCompletedReportPdf({ ...match, clubId: PILOT_CLUB_ID, homeScore: 2, awayScore: 1, teamName: 'Demo FC', homeAway: 'home', matchDate: match.match_date, events: [] }, {
    audience: 'staff', coachNarrative: 'A detailed match report. '.repeat(190), accessContext: { planKey: 'matchday' },
  })
  const content = Buffer.from(pdf).toString('latin1')
  assert.match(content, /^%PDF-1\.4/)
  assert.match(content, /\/Count [2-9]/)
  assert.match(content, /Coach match report/)
})
