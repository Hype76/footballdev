import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { formatUkDateWords, formatUkMonthYear } from '../src/lib/date-format.js'
import { buildPlayerProgressionData } from '../src/lib/player-progression.js'
import { formatTrendDate } from '../src/hooks/players/playerProfileUtils.js'

test('British date helpers use unambiguous record and month labels', () => {
  assert.equal(formatUkDateWords('2026-05-27'), '27 May 2026')
  assert.equal(formatUkDateWords('11/06/2026'), '11 Jun 2026')
  assert.equal(formatUkMonthYear('2026-05-27'), 'May 2026')
})

test('player progression labels do not use ambiguous two digit years', () => {
  const progression = buildPlayerProgressionData({
    evaluations: [
      {
        id: 'evaluation-1',
        averageScore: 6,
        date: '2026-05-27',
        formResponses: {
          Technical: 6,
        },
        session: 'Training',
      },
      {
        id: 'evaluation-2',
        averageScore: 8,
        date: '2026-06-11',
        formResponses: {
          Technical: 8,
        },
        session: 'Match vs City',
      },
    ],
    fields: [
      {
        label: 'Technical',
        type: 'score_1_10',
        includeInProgressChart: true,
      },
    ],
  })

  assert.deepEqual(progression.scoreTrend.map((point) => point.label), ['27 May 2026', '11 Jun 2026'])
  assert.deepEqual(progression.involvementByMonth.map((item) => item.label), ['May 2026', 'Jun 2026'])
  assert.equal(progression.involvementByMonth.some((item) => /\b\d{2}$/.test(item.label)), false)
})

test('player profile rating cards format stored dates in British wording', () => {
  assert.equal(formatTrendDate({ date: '2026-05-27' }), '27 May 2026')
  assert.equal(formatTrendDate({ date: '08/05/2026' }), '8 May 2026')
})

test('player profile date displays use the shared British formatter', () => {
  const historyCard = readFileSync(
    new URL('../src/components/players/EvaluationHistoryCard.jsx', import.meta.url),
    'utf8',
  )
  const mergeAssessments = readFileSync(
    new URL('../src/components/players/PlayerMergeAssessments.jsx', import.meta.url),
    'utf8',
  )
  const profileModals = readFileSync(
    new URL('../src/components/players/PlayerProfileModals.jsx', import.meta.url),
    'utf8',
  )

  assert.match(historyCard, /formatTrendDate\(evaluation\)/)
  assert.match(mergeAssessments, /Date: \$\{formatTrendDate\(evaluation\)\}/)
  assert.match(profileModals, /formatTrendDate\(evaluationDeleteTarget\)/)
  assert.match(profileModals, /formatUkDateWords\(emailConfirmTarget\.inviteDate/)
})
