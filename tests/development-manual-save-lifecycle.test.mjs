import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildPrivateEvaluationDraftContext,
  createPrivateEvaluationDraftPayload,
  getEvaluationDraftContextKey,
} from '../src/lib/evaluation-drafts.js'
import {
  buildFeedbackFormSnapshot,
  normalizeStarterFeedbackFormRow,
} from '../src/lib/domain/feedback-forms.js'

const pageSource = readFileSync(
  new URL('../src/pages/CreateEvaluationPage.jsx', import.meta.url),
  'utf8',
)
const submitSource = readFileSync(
  new URL('../src/components/evaluations/SubmitExportSection.jsx', import.meta.url),
  'utf8',
)
const draftSource = readFileSync(
  new URL('../src/lib/evaluation-drafts.js', import.meta.url),
  'utf8',
)

test('Development Record draft persistence is an explicit manual action only', () => {
  assert.match(submitSource, /'Save Draft'/)
  assert.match(pageSource, /const handleSaveDraft = async/)
  assert.match(pageSource, /manualDraftSavePromiseRef/)
  assert.doesNotMatch(pageSource, /privateDraftSaveTimerRef/)
  assert.doesNotMatch(pageSource, /privateDraftQueueRef/)
  assert.doesNotMatch(pageSource, /flushPrivateDraftSave/)
  assert.doesNotMatch(pageSource, /\bsaveDraft\(/)
  assert.doesNotMatch(pageSource, /createOfflineEvaluationDraft/)
  assert.doesNotMatch(pageSource, /navigator\.onLine/)
})

test('manual draft state changes only after a genuine user edit', () => {
  assert.match(pageSource, /const markDraftUnsaved = useCallback/)
  assert.match(pageSource, /hasMeaningfulUserChangeRef\.current = true/)
  assert.match(pageSource, /meaningfulDraftSignature !== meaningfulDraftBaselineRef\.current/)
  assert.match(pageSource, /setPrivateDraftStatus\(isDirty \? 'unsaved' : 'idle'\)/)
  assert.doesNotMatch(pageSource, /Changes are being prepared for private draft saving\./)
})

test('manual draft save is keyed to actor, team, player, and selected form', () => {
  assert.match(pageSource, /selectedFeedbackFormId/)
  assert.match(pageSource, /buildPrivateEvaluationDraftContext\(\{[\s\S]+selectedFeedbackFormId/)
  assert.match(draftSource, /formId: normalizeText\(context\.formId\)/)
  assert.match(draftSource, /normalizedContext\.formId \|\| 'unselected-form'/)
})

test('unsaved Development Record navigation uses the exact approved warning', () => {
  assert.match(pageSource, /useBlocker/)
  assert.match(pageSource, /You have unsaved changes\. Leave without saving\?/)
  assert.match(pageSource, /Stay and continue editing/)
  assert.match(pageSource, /Leave without saving/)
})

test('final submit remains separate from Save Draft and uses explicit outcome labels', () => {
  const submitHandler = pageSource.slice(
    pageSource.indexOf('const handleSubmit = async'),
    pageSource.indexOf('const handleContinueWithDefaultTemplate'),
  )

  assert.doesNotMatch(submitHandler, /handleSaveDraft/)
  assert.doesNotMatch(submitHandler, /flushPrivateDraftSave/)
  assert.match(pageSource, /Final Development submission review/)
  assert.match(pageSource, /Development record saved with output action needed/)
  assert.match(submitSource, /getDevelopmentSubmissionActionLabel/)
})

test('starter template draft and final snapshot preserve template key, version, and answers', () => {
  const starterForm = normalizeStarterFeedbackFormRow({
    id: 'starter-template-row',
    template_key: 'foundation-u12',
    version: 4,
    name: 'Foundation U12',
    fields: [
      {
        id: 'starter-first-touch',
        label: 'First touch',
        type: 'score_1_10',
        required: true,
        isEnabled: true,
      },
    ],
  }, {
    ageGroup: 'U12',
    teamId: 'team-u12',
  })
  const user = {
    id: 'coach-1',
    clubId: 'club-1',
    activeTeamId: 'team-u12',
    activeTeamName: 'U12',
  }
  const context = buildPrivateEvaluationDraftContext({
    formData: {
      playerId: 'player-1',
      playerName: 'Fixture Player',
      team: 'U12',
    },
    selectedFeedbackFormId: starterForm.selectionId,
    user,
  })
  const payload = createPrivateEvaluationDraftPayload({
    formData: {
      playerId: 'player-1',
      playerName: 'Fixture Player',
      session: '2026-07-26',
      team: 'U12',
    },
    responseValues: {
      'starter-first-touch': '8',
    },
    selectedFeedbackFormId: starterForm.selectionId,
  })
  const snapshot = buildFeedbackFormSnapshot({
    form: starterForm,
    formResponses: {
      'First touch': '8',
    },
  })

  assert.match(getEvaluationDraftContextKey(context), /platform-starter_foundation-u12_4/)
  assert.equal(payload.selectedFeedbackFormId, 'platform-starter:foundation-u12:4')
  assert.equal(payload.responseValues['starter-first-touch'], '8')
  assert.equal(snapshot.templateKey, 'foundation-u12')
  assert.equal(snapshot.formVersion, 4)
  assert.equal(snapshot.fields[0].value, '8')
})
