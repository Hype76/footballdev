import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildFeedbackFormSnapshot,
  getExplicitTeamAge,
  getStarterFeedbackFormSelectionId,
  isStarterTemplateRecommendedForAge,
  normalizeStarterFeedbackFormRow,
  parseStarterFeedbackFormSelectionId,
  updateFeedbackFormEditorFields,
  validateFeedbackFormDraft,
} from '../src/lib/domain/feedback-forms.js'

const migrationPath = new URL('../supabase/migrations/20260723152244_fp_v1_finish_polish_combined_14.sql', import.meta.url)
const feedbackPagePath = new URL('../src/pages/FeedbackFormsPage.jsx', import.meta.url)
const createEvaluationPagePath = new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url)
const matchDayPagePath = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)

test('form builder draft state preserves ordinary spaces until save validation', () => {
  const initialFields = [{
    id: 'label',
    label: 'Overall',
    type: 'select',
    options: 'Good',
    orderIndex: 1,
  }]
  const withSpacedLabel = updateFeedbackFormEditorFields(initialFields, 'label', {
    label: 'Overall  feedback ',
    options: 'Good first touch, Needs support',
  })

  assert.equal(withSpacedLabel[0].label, 'Overall  feedback ')
  assert.equal(withSpacedLabel[0].options, 'Good first touch, Needs support')
  const saved = validateFeedbackFormDraft({
    name: ' Match day feedback ',
    fields: withSpacedLabel,
  })
  assert.equal(saved.name, 'Match day feedback')
  assert.equal(saved.fields[0].label, 'Overall  feedback')
  assert.deepEqual(saved.fields[0].options, ['Good first touch', 'Needs support'])
})

test('form builder keyboard handling never prevents the spacebar or normalizes on every change', async () => {
  const source = await readFile(feedbackPagePath, 'utf8')
  const spaceHandler = source.slice(
    source.indexOf('function stopTextInputSpacePropagation'),
    source.indexOf('function createEditorState'),
  )
  assert.match(source, /onKeyDown=\{stopTextInputSpacePropagation\}/)
  assert.match(spaceHandler, /event\.stopPropagation\(\)/)
  assert.doesNotMatch(spaceHandler, /preventDefault\(\)/)
  assert.match(source, /updateFeedbackFormEditorFields\(current\.fields, fieldId, nextValues\)/)
  assert.doesNotMatch(source, /normalizeFeedbackFormField\(\{\s*\.\.\.field,\s*\.\.\.nextValues/)
})

test('starter selection identity, explicit age recommendations, and historical snapshots are stable', () => {
  const selectionId = getStarterFeedbackFormSelectionId('u17-u18-progression-review', 1)
  assert.equal(selectionId, 'platform-starter:u17-u18-progression-review:1')
  assert.deepEqual(parseStarterFeedbackFormSelectionId(selectionId), {
    templateKey: 'u17-u18-progression-review',
    version: 1,
  })
  assert.equal(getExplicitTeamAge('U17'), 17)
  assert.equal(getExplicitTeamAge('U17 Green'), null)
  assert.equal(isStarterTemplateRecommendedForAge({ ageMin: 17, ageMax: 18 }, 'U17'), true)
  assert.equal(isStarterTemplateRecommendedForAge({ ageMin: 17, ageMax: 18 }, ''), false)

  const starter = normalizeStarterFeedbackFormRow({
    id: '11111111-1111-4111-8111-111111111111',
    template_key: 'u17-u18-progression-review',
    version: 1,
    age_band: 'U17-U18',
    age_min: 17,
    age_max: 18,
    name: 'U17-U18 Progression Review',
    fields: [{ id: 'focus', label: 'Priority development objective', type: 'textarea', parentVisible: true }],
  }, { ageGroup: 'U17', teamId: 'team-1' })
  const snapshot = buildFeedbackFormSnapshot({
    form: starter,
    formResponses: { 'Priority development objective': 'Decision making' },
  })

  assert.equal(starter.isRecommended, true)
  assert.equal(starter.id, '11111111-1111-4111-8111-111111111111')
  assert.equal(snapshot.formId, null)
  assert.equal(snapshot.templateKey, 'u17-u18-progression-review')
  assert.equal(snapshot.formVersion, 1)
  assert.equal(snapshot.fields[0].parentVisible, true)
  assert.equal(snapshot.fields[0].value, 'Decision making')
})

test('starter templates use their stable selection identity in direct-use navigation and the normal form selector', async () => {
  const [feedbackPage, createEvaluationPage] = await Promise.all([
    readFile(feedbackPagePath, 'utf8'),
    readFile(createEvaluationPagePath, 'utf8'),
  ])
  assert.match(feedbackPage, /\/assess-player\/new\?feedbackForm=\$\{encodeURIComponent\(template\.selectionId\)\}/)
  assert.match(createEvaluationPage, /form\.selectionId \|\| form\.id/)
  assert.match(createEvaluationPage, /searchParams\.get\('feedbackForm'\)/)
  assert.match(createEvaluationPage, /form\.isPlatformTemplate \? ' \| Starter' : ''/)
})

test('starter migration is additive, idempotent, versioned, and seeds the exact catalogue', async () => {
  const migration = await readFile(migrationPath, 'utf8')
  const expectedKeys = [
    'u7-u8-foundation-development-review',
    'u9-u10-skill-development-review',
    'u11-u12-game-understanding-review',
    'u13-u14-player-development-review',
    'u15-u16-performance-development-review',
    'u17-u18-progression-review',
    'u7-u10-goalkeeper-foundation-review',
    'u11-u14-goalkeeper-development-review',
    'u15-u18-goalkeeper-performance-review',
  ]

  for (const key of expectedKeys) {
    assert.match(migration, new RegExp(`'${key}'`))
  }
  assert.match(migration, /primary key \(template_key, version\)/)
  assert.match(migration, /primary key \(team_id, template_key\)/)
  assert.match(migration, /on conflict \(template_key, version\) do update/)
  assert.match(migration, /on public\.feedback_form_starter_templates \(template_key\)\s*where is_current/)
  assert.match(migration, /feedback_form_starter_preferences_manager_update/)
  assert.match(migration, /"Not observed"/)
  assert.doesNotMatch(migration, /"1","2","3","4","5","6","7","8","9","10"/)
  assert.doesNotMatch(migration, /update public\.feedback_forms|update public\.evaluations/)
})

test('pre-match Game Mode entry remains read only and keeps a separate deliberate start action', async () => {
  const source = await readFile(matchDayPagePath, 'utf8')
  const handler = source.slice(
    source.indexOf('const handleGameModeOpen'),
    source.indexOf('const handleStartMatch'),
  )
  assert.match(handler, /hydrateMatchDay\(match\)/)
  assert.match(handler, /setGameModeMatchId\(match\.id\)/)
  assert.doesNotMatch(handler, /startMatchDay|persistTimerAction|onStatusChange|create|insert|update/)
  assert.match(source, /Game Mode is open, but the match clock has not started/)
  assert.match(source, /onClick=\{\(\) => onStartMatch\(match\)\}/)
  assert.match(source, /Open Game Mode/)
  assert.match(source, /Start match/)
  const cardSource = source.slice(
    source.indexOf('function MatchDayCard'),
    source.indexOf('function LiveMatchQuickActions'),
  )
  assert.match(cardSource, /canOpenPreMatchGameMode = \['scheduled', 'scorer_request'\]\.includes\(match\.status\)/)
  assert.match(cardSource, /canOpenPreMatchGameMode[\s\S]*onClick=\{\(\) => onGameModeStart\(match\)\}[\s\S]*Open Game Mode[\s\S]*primaryLiveAction[\s\S]*onStartMatch\(match\)[\s\S]*onClick=\{onToggle\}/)
})

test('starter visibility audit uses the platform template UUID and keeps the key in metadata', async () => {
  const [pageSource, domainSource] = await Promise.all([
    readFile(feedbackPagePath, 'utf8'),
    readFile(new URL('../src/lib/domain/feedback-forms.js', import.meta.url), 'utf8'),
  ])
  assert.match(pageSource, /templateId: template\.id/)
  assert.match(domainSource, /entityId: normalizedTemplateId \|\| null/)
  assert.match(domainSource, /templateKey: normalizedTemplateKey/)
})
