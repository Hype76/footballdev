import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { formatUkDateWords, formatUkMonthYear } from '../src/lib/date-format.js'
import { buildPlayerProgressionData, buildProgressionEmailSections } from '../src/lib/player-progression.js'
import { buildFieldMovement, buildRatingTrend, formatTrendDate } from '../src/hooks/players/playerProfileUtils.js'

test('British date helpers use unambiguous record and month labels', () => {
  assert.equal(formatUkDateWords('2026-05-27'), '27 May 2026')
  assert.equal(formatUkDateWords('11/06/2026'), '11 Jun 2026')
  assert.equal(formatUkDateWords('12 Jun 2026'), '12 Jun 2026')
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

test('progression trend lines stay oldest to newest for overall and numeric categories', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Physical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Strengths', type: 'textarea', includeInProgressChart: false },
    ],
    evaluations: [
      {
        id: 'newest',
        averageScore: 8,
        date: '2026-06-12',
        formResponses: {
          Technical: 8,
          Physical: 6,
          Strengths: 'Good energy',
        },
      },
      {
        id: 'oldest',
        averageScore: 5,
        date: '2026-05-01',
        formResponses: {
          Technical: 5,
          Physical: 7,
          Strengths: 'Settling in',
        },
      },
      {
        id: 'middle',
        averageScore: 7,
        date: '2026-05-24',
        formResponses: {
          Technical: 7,
          Physical: 6,
          Strengths: 'Improving',
        },
      },
      {
        id: 'future',
        averageScore: 10,
        date: '2026-08-01',
        formResponses: {
          Technical: 10,
          Physical: 10,
        },
      },
    ],
  })

  const overallLine = progression.trendLines.find((line) => line.key === 'overall')
  const technicalLine = progression.trendLines.find((line) => line.label === 'Technical')
  const physicalLine = progression.trendLines.find((line) => line.label === 'Physical')

  assert.deepEqual(progression.scoreTrend.map((point) => point.id), ['oldest', 'middle', 'newest'])
  assert.deepEqual(overallLine.points.map((point) => point.evaluationId), ['oldest', 'middle', 'newest'])
  assert.deepEqual(technicalLine.points.map((point) => point.evaluationId), ['oldest', 'middle', 'newest'])
  assert.deepEqual(physicalLine.points.map((point) => point.value), [7, 6, 6])
  assert.equal(progression.trendLines.some((line) => line.label === 'Strengths'), false)
  assert.equal(progression.trendLines.some((line) => line.points.some((point) => point.evaluationId === 'future')), false)
})

test('progression excludes undated scored records from chart points and reports eligibility breakdown', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Strengths', type: 'textarea', includeInProgressChart: false },
    ],
    evaluations: [
      {
        id: 'dated-explicit',
        date: '2026-06-01',
        averageScore: 6,
        formResponses: {
          Technical: 6,
        },
      },
      {
        id: 'dated-linked-session',
        sessionDate: '2026-06-08',
        averageScore: 7,
        formResponses: {
          Technical: 7,
        },
      },
      {
        id: 'legacy-created-at',
        createdAt: '2026-06-15T09:00:00.000Z',
        averageScore: 8,
        formResponses: {
          Technical: 8,
        },
      },
      {
        id: 'undated-scored',
        averageScore: 9,
        formResponses: {
          Technical: 9,
        },
      },
      {
        id: 'future-scored',
        date: '2026-08-01',
        averageScore: 10,
        formResponses: {
          Technical: 10,
        },
      },
      {
        id: 'text-only',
        date: '2026-06-10',
        formResponses: {
          Strengths: 'Great attitude',
        },
      },
    ],
  })

  assert.deepEqual(
    progression.scoreTrend.map((point) => point.id),
    ['dated-explicit', 'dated-linked-session', 'legacy-created-at'],
  )
  assert.equal(progression.scoreTrend.some((point) => point.label === 'No date entered'), false)
  assert.equal(progression.eligibilityBreakdown.totalDevelopmentRecords, 6)
  assert.equal(progression.eligibilityBreakdown.scoredRecords, 5)
  assert.equal(progression.eligibilityBreakdown.datedScoredRecords, 3)
  assert.equal(progression.eligibilityBreakdown.undatedScoredRecords, 1)
  assert.equal(progression.eligibilityBreakdown.futureDatedScoredRecords, 1)
  assert.equal(progression.eligibilityBreakdown.textOnlyRecordsExcluded, 1)
  assert.equal(progression.eligibilityBreakdown.chartEligibleRecords, 3)
})

test('one dated scored record gives an honest no-trend state', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
    ],
    evaluations: [
      {
        id: 'single-record',
        date: '2026-06-01',
        averageScore: 6,
        formResponses: {
          Technical: 6,
        },
      },
    ],
  })

  assert.equal(progression.evaluationCount, 1)
  assert.equal(progression.hasScoreTrend, false)
  assert.equal(progression.eligibilityBreakdown.chartEligibleRecords, 1)
})

test('same day scored records get stable sequenced chart labels', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
    ],
    evaluations: [
      {
        id: 'same-day-second',
        date: '2026-06-12',
        averageScore: 7,
        formResponses: {
          Technical: 7,
        },
      },
      {
        id: 'same-day-first',
        date: '2026-06-12',
        averageScore: 6,
        formResponses: {
          Technical: 6,
        },
      },
    ],
  })

  assert.equal(progression.hasScoreTrend, true)
  assert.deepEqual(progression.scoreTrend.map((point) => point.dateKey), ['2026-06-12#01', '2026-06-12#02'])
  assert.deepEqual(progression.scoreTrend.map((point) => point.label), ['12 Jun 2026 #1', '12 Jun 2026 #2'])
})

test('progression uses merge-visible player records including no-session same-day and section-mixed scores', () => {
  const fields = [
    { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Tactical', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Physical', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Mentality', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Coachability', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Strengths', type: 'textarea', includeInProgressChart: false },
  ]
  const evaluations = [
    { id: '12-jun-high', date: '12 Jun 2026', session: '', section: 'Squad', averageScore: 7.6, formResponses: { Technical: 7.6, Tactical: 7.6, Physical: 7.6, Mentality: 7.6, Coachability: 7.6 } },
    { id: '12-jun-low', date: '12 Jun 2026', session: '', section: 'Squad', averageScore: 6.0, formResponses: { Technical: 6, Tactical: 6, Physical: 6, Mentality: 6, Coachability: 6 } },
    { id: '11-jun-high', date: '11 Jun 2026', session: '2026-06-11', section: 'Squad', averageScore: 5.6, formResponses: { Technical: 5.6, Tactical: 5.6, Physical: 5.6, Mentality: 5.6, Coachability: 5.6 } },
    { id: '11-jun-low', date: '11 Jun 2026', session: '2026-06-11', section: 'Squad', averageScore: 3.6, formResponses: { Technical: 3.6, Tactical: 3.6, Physical: 3.6, Mentality: 3.6, Coachability: 3.6 } },
    { id: '9-jun-low', date: '9 Jun 2026', session: '', section: 'Squad', averageScore: 4.0, formResponses: { Technical: 4, Tactical: 4, Physical: 4, Mentality: 4, Coachability: 4 } },
    { id: '9-jun-high', date: '9 Jun 2026', session: '', section: 'Squad', averageScore: 5.6, formResponses: { Technical: 5.6, Tactical: 5.6, Physical: 5.6, Mentality: 5.6, Coachability: 5.6 } },
    { id: '27-may-mobile', date: '27 May 2026', session: 'Mobile assessment', section: 'Squad', averageScore: 6.0, formResponses: { Technical: 6, Tactical: 6, Physical: 6, Mentality: 6, Coachability: 6 } },
    { id: '8-may-squad', date: '8 May 2026', session: '2026-05-06', section: 'Squad', averageScore: 6.8, formResponses: { Technical: 6.8, Tactical: 6.8, Physical: 6.8, Mentality: 6.8, Coachability: 6.8 } },
    { id: '8-may-trial', date: '8 May 2026', session: '2026-05-08', section: 'Trial', averageScore: 6.8, formResponses: { Technical: 6.8, Tactical: 6.8, Physical: 6.8, Mentality: 6.8, Coachability: 6.8 } },
  ]
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    evaluations,
    fields,
  })
  const overallLine = progression.trendLines.find((line) => line.key === 'overall')

  assert.equal(progression.historicalEvaluationCount, 9)
  assert.equal(progression.eligibilityBreakdown.scoredRecords, 9)
  assert.equal(progression.eligibilityBreakdown.chartEligibleRecords, 9)
  assert.equal(progression.evaluationCount, 9)
  assert.equal(progression.hasScoreTrend, true)
  assert.equal(progression.trainingCount, 9)
  assert.equal(progression.matchCount, 0)
  assert.equal(overallLine.points.length, 9)
  assert.deepEqual(
    progression.scoreTrend.map((point) => point.id),
    ['8-may-squad', '8-may-trial', '27-may-mobile', '9-jun-low', '9-jun-high', '11-jun-high', '11-jun-low', '12-jun-high', '12-jun-low'],
  )
  assert.deepEqual(
    progression.scoreTrend.map((point) => point.label),
    ['8 May 2026 #1', '8 May 2026 #2', '27 May 2026', '9 Jun 2026 #1', '9 Jun 2026 #2', '11 Jun 2026 #1', '11 Jun 2026 #2', '12 Jun 2026 #1', '12 Jun 2026 #2'],
  )
  assert.equal(progression.scoreTrend.some((point) => point.label === 'No date entered'), false)
  assert.deepEqual(progression.focusAreas.map((item) => item.label), ['Technical', 'Tactical', 'Physical', 'Mentality'])
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
      date: '2026-06-01',
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
      date: '2026-06-08',
      createdAt: new Date('2026-06-08T10:00:00.000Z'),
      formResponses: {
        Technical: 7,
        Coachability: 7,
      },
    },
    {
      id: 'evaluation-3',
      date: '2026-06-18',
      createdAt: new Date('2026-06-18T10:00:00.000Z'),
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
  const technicalMovement = movement.find((item) => item.label === 'Technical')
  assert.equal(technicalMovement?.firstValue, 6)
  assert.equal(technicalMovement?.latestValue, 8)
  assert.equal(technicalMovement?.change, 2)
  assert.equal(technicalMovement?.firstDateLabel, '1 Jun 2026')
  assert.equal(technicalMovement?.previousValue, 7)
  assert.equal(technicalMovement?.previousDateLabel, '8 Jun 2026')
  assert.equal(technicalMovement?.currentValue, 8)
  assert.equal(technicalMovement?.currentDateLabel, '18 Jun 2026')
  assert.equal(technicalMovement?.recordedCount, 3)
  assert.equal(movement.some((item) => item.label === 'Strengths'), false)
  assert.equal(movement.some((item) => item.label === 'Improvements'), false)
  assert.equal(movement.some((item) => item.label === 'Overall Comments'), false)
  assert.equal(movement.some((item) => item.label === 'Legacy Narrative'), false)
})

test('profile trend helpers exclude future dated records', () => {
  const fields = [
    { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
    { label: 'Strengths', type: 'textarea', includeInProgressChart: false },
  ]
  const evaluations = [
    {
      id: 'past-scored',
      date: '2026-06-01',
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
      averageScore: 6,
      formResponses: {
        Technical: 6,
        Strengths: '1',
      },
    },
    {
      id: 'current-scored',
      date: '2026-06-18',
      createdAt: new Date('2026-06-18T10:00:00.000Z'),
      averageScore: 7,
      formResponses: {
        Technical: 7,
      },
    },
    {
      id: 'future-scored',
      date: '2026-08-01',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      averageScore: 10,
      formResponses: {
        Technical: 10,
      },
    },
  ]

  const ratingTrend = buildRatingTrend(evaluations, { currentDate: '2026-06-18' })
  const movement = buildFieldMovement(evaluations, fields, { currentDate: '2026-06-18' })

  assert.deepEqual(ratingTrend.map((evaluation) => evaluation.id), ['past-scored', 'current-scored'])
  assert.equal(movement.find((item) => item.label === 'Technical')?.latestValue, 7)
  assert.equal(movement.some((item) => item.label === 'Strengths'), false)
})

test('website and email next focus areas use the same shared ordering', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Physical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Coachability', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Overall Comments', type: 'textarea', includeInProgressChart: false },
    ],
    evaluations: [
      {
        id: 'first',
        date: '2026-06-01',
        averageScore: 7,
        formResponses: {
          Technical: 7,
          Physical: 6,
          Coachability: 8,
          'Overall Comments': 'Bright start',
        },
      },
      {
        id: 'latest',
        date: '2026-06-12',
        averageScore: 6,
        formResponses: {
          Technical: 6,
          Physical: 6,
          Coachability: 6,
          'Overall Comments': 'Needs focus',
        },
      },
    ],
  })
  const emailFocus = buildProgressionEmailSections({
    progressionData: progression,
    sections: {
      attendanceSummary: false,
      coachComments: false,
      latestSessionNotes: false,
      matchNotes: false,
      progressionChart: false,
      nextFocusAreas: true,
    },
  }).find((section) => section.key === 'nextFocusAreas')

  assert.deepEqual(progression.focusAreas.map((item) => item.label), ['Coachability', 'Technical', 'Physical'])
  assert.equal(emailFocus.body, 'Coachability: latest score 6\nTechnical: latest score 6\nPhysical: latest score 6')
  assert.equal(progression.focusAreas.some((item) => item.label === 'Overall Comments'), false)
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

test('progression counts saved scored records even when old records lack current chart fields or session links', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Physical', type: 'score_1_10', includeInProgressChart: true },
      { label: 'Strengths', type: 'textarea', includeInProgressChart: false },
      { label: 'Overall Comments', type: 'textarea', includeInProgressChart: false },
    ],
    evaluations: [
      {
        id: 'legacy-scored-no-session-1',
        averageScore: 5.2,
        date: '2026-05-01',
        formResponses: {
          'Old technical score': 5,
          Strengths: '1',
        },
        session: '',
      },
      {
        id: 'legacy-scored-no-session-2',
        averageScore: 5.6,
        date: '2026-05-08',
        formResponses: {
          'Archived coach rating': 6,
          'Overall Comments': '1',
        },
        session: '',
      },
      {
        id: 'current-training',
        averageScore: 6,
        date: '2026-05-15',
        formResponses: {
          Technical: 6,
          Physical: 6,
        },
        session: 'Training',
      },
      {
        id: 'current-match',
        averageScore: 7,
        date: '2026-05-22',
        formResponses: {
          Technical: 7,
          Physical: 7,
        },
        session: 'Match vs City',
      },
      {
        id: 'current-no-session',
        averageScore: 7.5,
        date: '2026-06-01',
        formResponses: {
          Technical: 8,
          Physical: 7,
        },
        session: '',
      },
      {
        id: 'future-scored',
        averageScore: 10,
        date: '2026-08-01',
        formResponses: {
          Technical: 10,
          Physical: 10,
        },
        session: 'Training',
      },
      {
        id: 'past-text-only',
        date: '2026-06-02',
        formResponses: {
          Strengths: 'Great attitude',
          'Overall Comments': 'Keep going',
        },
        session: 'Training',
      },
    ],
  })

  assert.equal(progression.historicalEvaluationCount, 7)
  assert.equal(progression.evaluationCount, 5)
  assert.equal(progression.eligibilityBreakdown.futureDatedScoredRecords, 1)
  assert.equal(progression.eligibilityBreakdown.textOnlyRecordsExcluded, 1)
  assert.equal(progression.hasScoreTrend, true)
  assert.deepEqual(
    progression.scoreTrend.map((point) => point.id),
    ['legacy-scored-no-session-1', 'legacy-scored-no-session-2', 'current-training', 'current-match', 'current-no-session'],
  )
  assert.deepEqual(progression.scoreTrend.map((point) => point.value), [5.2, 5.6, 6, 7, 7.5])
  assert.equal(progression.trainingCount, 4)
  assert.equal(progression.matchCount, 1)
  assert.equal(progression.involvementByMonth.some((item) => item.label === 'Aug 2026'), false)
  assert.equal(progression.focusAreas.some((item) => item.label === 'Strengths'), false)
  assert.equal(progression.focusAreas.some((item) => item.label === 'Overall Comments'), false)
})

test('progression component labels scored record counts when saved history differs', () => {
  const source = readFileSync(
    new URL('../src/components/players/PlayerProgressionCharts.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /label="Scored records"/)
  assert.match(source, /scored records from/)
  assert.match(source, /saved development records are eligible/)
  assert.match(source, /Selectable score trends/)
  assert.match(source, /Show all/)
  assert.match(source, /Overall only/)
  assert.match(source, /xKeys\.indexOf\(point\.dateKey\)/)
  assert.match(source, /Oldest records are on the left and newest records are on the right/)
  assert.match(source, /Progression trend will appear after at least two dated scored records/)
  assert.match(source, /need a valid date before charting/)
})

test('player overview field movement cards label saved-record context clearly', () => {
  const source = readFileSync(
    new URL('../src/components/players/PlayerOverview.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /First recorded/)
  assert.match(source, /Previous record/)
  assert.match(source, /Current record/)
  assert.match(source, /change since first recorded/)
  assert.doesNotMatch(source, /firstValue\} to \{item\.latestValue/)
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
