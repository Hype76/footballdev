import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { formatUkDateWords, formatUkMonthYear } from '../src/lib/date-format.js'
import { buildPlayerProgressionData } from '../src/lib/player-progression.js'
import { buildFieldMovement, formatTrendDate } from '../src/hooks/players/playerProfileUtils.js'

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

test('field movement only renders numeric field metadata as range cards', () => {
  const fields = [
    { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Coachability', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Strengths', type: 'textarea', includeInProgressChart: false },
    { label: 'Improvements', type: 'textarea', includeInProgressChart: false },
    { label: 'Overall Comments', type: 'textarea', includeInProgressChart: false },
    { label: 'Legacy Narrative', type: 'text', includeInProgressChart: false },
  ]
  const evaluations = [
    {
      id: 'evaluation-1',
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
      formResponses: {
        Technical: 6,
        Coachability: 7,
        Strengths: '1',
        Improvements: '',
        'Overall Comments': '1',
        'Legacy Narrative': '2',
      },
    },
    {
      id: 'evaluation-2',
      createdAt: new Date('2026-06-08T10:00:00.000Z'),
      formResponses: {
        Technical: 8,
        Coachability: 7,
        Strengths: '1',
        Improvements: '0',
        'Overall Comments': '1',
        'Legacy Narrative': '3',
      },
    },
  ]

  const movement = buildFieldMovement(evaluations, fields)

  assert.deepEqual(movement.map((item) => item.label), ['Technical', 'Coachability'])
  assert.equal(movement.find((item) => item.label === 'Technical')?.change, 2)
  assert.equal(movement.some((item) => item.label === 'Strengths'), false)
  assert.equal(movement.some((item) => item.label === 'Improvements'), false)
  assert.equal(movement.some((item) => item.label === 'Overall Comments'), false)
  assert.equal(movement.some((item) => item.label === 'Legacy Narrative'), false)
})

test('progression focus areas ignore text fields and future involvement months', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-17',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Physical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Strengths', type: 'textarea', includeInProgressChart: false },
      { label: 'Overall Comments', type: 'textarea', includeInProgressChart: false },
    ],
    evaluations: [
      {
        id: 'past-training',
        date: '2026-06-01',
        formResponses: {
          Technical: 6,
          Physical: 7,
          Strengths: '1',
          'Overall Comments': '1',
        },
        session: 'Training',
      },
      {
        id: 'current-match',
        date: '2026-06-17',
        formResponses: {
          Technical: 8,
          Physical: 7,
          Strengths: '1',
          'Overall Comments': '0',
        },
        session: 'Match vs City',
      },
      {
        id: 'future-training',
        date: '2026-08-12',
        formResponses: {
          Technical: 10,
          Physical: 10,
          Strengths: 'Future note',
          'Overall Comments': 'Future comment',
        },
        session: 'Training',
      },
    ],
  })

  assert.deepEqual(progression.involvementByMonth.map((item) => item.label), ['Jun 2026'])
  assert.equal(progression.involvementByMonth.some((item) => item.label === 'Aug 2026'), false)
  assert.deepEqual(progression.focusAreas.map((item) => item.label), ['Physical', 'Technical'])
  assert.equal(progression.focusAreas.some((item) => item.label === 'Strengths'), false)
  assert.equal(progression.focusAreas.some((item) => item.label === 'Overall Comments'), false)
  assert.deepEqual(progression.scoreTrend.map((point) => point.id), ['past-training', 'current-match'])
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
