import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  DEFAULT_ASSESSMENT_SCORE_GUIDE,
  formatDefaultAssessmentScoreForParent,
  getDefaultAssessmentScoreOptions,
} from '../src/lib/assessment-scoring.js'
import { buildAssessmentPdfHtml } from '../src/lib/assessment-pdf-html.js'
import { canEditEvaluation } from '../src/lib/auth-permissions.js'
import { getDefaultFormFields } from '../src/lib/domain/core-defaults.js'
import { buildEmailHtml } from '../src/lib/email-builder.js'
import { buildPreviousAssessmentItems } from '../src/hooks/evaluations/evaluationFormUtils.js'
import { buildPlayerProgressionData } from '../src/lib/player-progression.js'
import { buildProgressionChartMarkup, getProgressionChartSummary } from '../src/lib/progression-chart-markup.js'

test('default assessment score options and guide use the 1 to 10 model', () => {
  const options = getDefaultAssessmentScoreOptions()

  assert.equal(options.length, 10)
  assert.deepEqual(options.map((option) => option.value), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
  assert.equal(options[0].label, '1 - Well Below Standard')
  assert.equal(options[5].label, '6 - Slightly Above Expected')
  assert.equal(options[9].label, '10 - Exceptional')
  assert.equal(DEFAULT_ASSESSMENT_SCORE_GUIDE.some((item) => /perfect/i.test(item.description)), false)
})

test('built-in development score fields default to score_1_10 without enabling fitness scores', () => {
  const fields = getDefaultFormFields()
  const scoreFields = fields.filter((field) =>
    ['Technical', 'Tactical', 'Physical', 'Mentality', 'Coachability'].includes(field.label),
  )
  const fitnessFields = fields.filter((field) => field.benchmarkKey)

  assert.equal(scoreFields.length, 5)
  assert.equal(scoreFields.every((field) => field.type === 'score_1_10'), true)
  assert.equal(scoreFields.every((field) => field.includeInProgressChart === true), true)
  assert.equal(fitnessFields.every((field) => field.type === 'number'), true)
  assert.equal(fitnessFields.every((field) => field.includeInProgressChart === false), true)
})

test('parent email and PDF scoring guide render 1 to 10 language', () => {
  const responses = [
    { label: 'Technical', value: 6 },
    { label: 'Bleep Test', value: '6.2' },
    { label: 'Overall Comments', value: 'Working well.' },
  ]
  const emailHtml = buildEmailHtml({
    clubName: 'Club',
    parentName: 'Parent',
    playerName: 'Player',
    responses,
    teamName: 'U12',
  })
  const pdfHtml = buildAssessmentPdfHtml({
    clubName: 'Club',
    playerName: 'Player',
    responseItems: responses,
    teamName: 'U12',
  })

  for (const html of [emailHtml, pdfHtml]) {
    assert.match(html, /scored out of 10/i)
    assert.match(html, /6 \/ 10 - Slightly Above Expected/)
    assert.match(html, /10 - Exceptional/)
    assert.doesNotMatch(html, /out of 5|\/ 5|perfect/i)
  }
})

test('parent email uses club logo before Football Player fallback', () => {
  const brandedEmail = buildEmailHtml({
    clubLogoUrl: 'https://cdn.example.com/club.png',
    clubName: 'Club',
    parentName: 'Parent',
    playerName: 'Player',
    responses: [],
    teamName: 'U12',
  })
  const fallbackEmail = buildEmailHtml({
    clubName: 'Club',
    parentName: 'Parent',
    playerName: 'Player',
    responses: [],
    teamName: 'U12',
  })

  assert.match(brandedEmail, /data-logo-source="club"/)
  assert.match(brandedEmail, /https:\/\/cdn\.example\.com\/club\.png/)
  assert.match(fallbackEmail, /data-logo-source="football-player"/)
  assert.match(fallbackEmail, /football-player-logo\.png/)
})

test('parent email and PDF place scoring guide after report sections', () => {
  const responses = [
    { label: 'Technical', value: 6 },
    { label: 'Tactical', value: 7 },
  ]
  const emailSections = [
    {
      key: 'coachUpdate',
      title: 'Coach update marker',
      body: 'Player-specific notes belong before the scoring guide.',
    },
  ]
  const emailHtml = buildEmailHtml({
    clubName: 'Club',
    parentName: 'Parent',
    playerName: 'Player',
    responses,
    emailSections,
    teamName: 'U12',
  })
  const pdfHtml = buildAssessmentPdfHtml({
    clubName: 'Club',
    playerName: 'Player',
    responseItems: responses,
    emailSections,
    teamName: 'U12',
  })

  for (const html of [emailHtml, pdfHtml]) {
    const coachUpdateIndex = html.indexOf('Coach update marker')
    const scoringGuideIndex = html.indexOf('How scoring works')

    assert.notEqual(coachUpdateIndex, -1)
    assert.notEqual(scoringGuideIndex, -1)
    assert.ok(scoringGuideIndex > coachUpdateIndex)
  }
})

test('submitted assessment summaries show default 1 to 10 labels only for default score fields', () => {
  const items = buildPreviousAssessmentItems({
    formResponses: {
      Technical: 8,
      'Bleep Test': 7.1,
      Strengths: 'Quick feet',
    },
    scores: {},
    comments: {},
  })

  assert.equal(items.find((item) => item.label === 'Technical')?.value, '8 / 10 - Very Good')
  assert.equal(items.find((item) => item.label === 'Bleep Test')?.value, '7.1')
})

test('progression chart scoring is displayed on a 10 point scale', () => {
  const progression = buildPlayerProgressionData({
    fields: [
      { label: 'Technical', type: 'score_1_5', includeInProgressChart: true },
      { label: 'Tactical', type: 'score_1_10', includeInProgressChart: true },
    ],
    evaluations: [
      {
        id: 'evaluation-1',
        createdAt: '2026-06-01T10:00:00.000Z',
        formResponses: { Technical: 4, Tactical: 6 },
      },
      {
        id: 'evaluation-2',
        createdAt: '2026-06-08T10:00:00.000Z',
        formResponses: { Technical: 5, Tactical: 8 },
      },
    ],
  })
  const summary = getProgressionChartSummary(progression.scoreTrend)

  assert.equal(progression.scoreTrend[0].value, 7)
  assert.equal(progression.scoreTrend[1].value, 9)
  assert.match(summary, /\/ 10/)
  assert.doesNotMatch(summary, /\/ 5/)
})

test('PDF progression chart uses clean static chart labels without raw value dumps', () => {
  const progression = buildPlayerProgressionData({
    currentDate: '2026-06-18',
    fields: [
      { label: 'Technical', type: 'score_1_10', includeInProgressChart: true },
    ],
    evaluations: [
      {
        id: 'first',
        date: '2026-06-12',
        averageScore: 6,
        formResponses: { Technical: 6 },
      },
      {
        id: 'second',
        date: '2026-06-12',
        averageScore: 7.5,
        formResponses: { Technical: 7.5 },
      },
    ],
  })
  const chartMarkup = buildProgressionChartMarkup(progression.scoreTrend)
  const pdfHtml = buildAssessmentPdfHtml({
    clubName: 'Club',
    playerName: 'Player',
    emailSections: [
      {
        key: 'progressionChart',
        title: 'Progression chart',
        body: 'Scores are charted oldest to newest out of 10.',
        chartPoints: progression.scoreTrend,
      },
    ],
    teamName: 'U12',
  })

  assert.match(chartMarkup, />12 Jun #1</)
  assert.match(chartMarkup, />12 Jun #2</)
  assert.doesNotMatch(chartMarkup, /12 Jun 2026 #1: 6\.0 \/ 10/)
  assert.doesNotMatch(pdfHtml, /12 Jun 2026 #1: 6\.0\s*\|\s*12 Jun 2026 #2: 7\.5/)
  assert.doesNotMatch(pdfHtml, /No date entered/)
})

test('score migration is guarded and converts only built-in score labels', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20260616085824_default_assessment_scores_10_point.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /default_score_scale_version/)
  assert.match(migration, /coalesce\(e\.default_score_scale_version, 1\) < 2/)
  assert.match(migration, /jsonb_typeof\(result\) <> 'object'/)
  assert.match(migration, /array\['Technical', 'Tactical', 'Physical', 'Mentality', 'Coachability'\]/)
  assert.match(migration, /numeric_score \* 2/)
  assert.doesNotMatch(migration, /\bBleep\b|\bfitness\b|benchmark|run time/i)
  assert.doesNotMatch(migration, /\b(drop table|drop column|truncate|delete from)\b/i)
})

test('edit permissions fail closed for parents, cross-club users, and club admins without team context', () => {
  const evaluation = {
    clubId: 'club-1',
    teamId: 'team-1',
    coachId: 'coach-1',
  }
  const manager = {
    id: 'manager-1',
    clubId: 'club-1',
    activeTeamId: 'team-1',
    role: 'manager',
    roleRank: 50,
  }

  assert.equal(canEditEvaluation(manager, evaluation), true)
  assert.equal(canEditEvaluation({ ...manager, clubId: 'club-2' }, evaluation), false)
  assert.equal(canEditEvaluation({ ...manager, role: 'parent_portal', roleRank: 0 }, evaluation), false)
  assert.equal(canEditEvaluation({ ...manager, role: 'admin', roleRank: 90, activeTeamId: '' }, evaluation), false)
  assert.equal(canEditEvaluation({ ...manager, activeTeamId: 'team-2' }, evaluation), false)
})

test('default score formatter is parent friendly and avoids perfect wording', () => {
  assert.equal(formatDefaultAssessmentScoreForParent(10), '10 / 10 - Exceptional')
  assert.doesNotMatch(formatDefaultAssessmentScoreForParent(10), /perfect/i)
})
