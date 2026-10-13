import assert from 'node:assert/strict'
import test from 'node:test'
import { getParentVisibleDevelopmentEmailSections, getDevelopmentParentReport, repairDevelopmentParentReportProgression, resolveDevelopmentParentReport } from '../netlify/functions/lib/_development-parent-email-output.js'
import { buildDevelopmentParentReportContent } from '../src/lib/development-parent-report-content.js'
import { buildAssessmentPdfDocument, renderPdfDocumentHtml } from '../src/lib/pdf-document.js'

const formId = '6337c486-56a9-4e67-9ec4-3c2aa45499fd'
const fields = [{ id: 'fitness', label: 'Fitness', type: 'score_1_10', parentVisible: true, enabled: true }]
function record(id, date, score, overrides = {}) {
  return {
    id, date, created_at: `${date}T12:00:00.000Z`, average_score: score,
    feedback_form_id: formId, feedback_form_name: 'U14 JPL',
    feedback_form_snapshot: { id: formId, name: 'U14 JPL', version: 3, fields },
    form_responses: { fitness: score }, ...overrides,
  }
}
const history = [
  record('u14-5', '2026-10-05', 4.2),
  record('elite-1', '2026-10-07', 5, { feedback_form_id: null, feedback_form_name: 'Elite Attacking Review', feedback_form_snapshot: { id: 'platform-starter:elite-attacking-review:1', name: 'Elite Attacking Review', version: 1, fields } }),
  record('elite-2', '2026-10-07', 7.8, { feedback_form_id: null, feedback_form_name: 'Elite Attacking Review', feedback_form_snapshot: { id: 'platform-starter:elite-attacking-review:1', name: 'Elite Attacking Review', version: 1, fields } }),
  record('u14-7a', '2026-10-07', 2.7),
  record('u14-7b', '2026-10-07', 3.3, { created_at: '2026-10-07T13:00:00.000Z' }),
  record('u14-8', '2026-10-08', 3.3),
  record('u14-13', '2026-10-13', 3.2),
]
const current = history.at(-1)
const requestedSections = [{ key: 'progressionChart' }]
function points(evaluation, evaluations) {
  return getParentVisibleDevelopmentEmailSections({ evaluation, evaluations, requestedSections }).find(section => section.key === 'progressionChart')?.chartPoints || []
}

test('U14 phone report charts its own history including both same-day records and current review', () => {
  const result = points(current, history)
  assert.deepEqual(result.map(point => point.value), [4.2, 2.7, 3.3, 3.3, 3.2])
  assert.match(result[1].label, /7 Oct.*#1/)
  assert.match(result[2].label, /7 Oct.*#2/)
})

test('phone progression retains the saved overall displayed in history rather than recalculating it', () => {
  assert.deepEqual(points(current, [record('saved-average', '2026-10-05', 2.7, { form_responses: { fitness: 3.2 } }), current]).map(point => point.value), [2.7, 3.2])
})

test('stable form identity wins over renamed forms and unrelated forms with the same name', () => {
  assert.deepEqual(points(current, [
    history[0],
    record('renamed', '2026-10-06', 4, { feedback_form_name: 'Previous form name' }),
    record('same-name-other-id', '2026-10-07', 9, { feedback_form_id: 'other-form' }),
    current,
  ]).map(point => point.value), [4.2, 4, 3.2])
})

test('platform phone snapshots keep starter identity separate from installed forms', () => {
  const elite = history[2]
  assert.deepEqual(points(elite, history).map(point => point.value), [5, 7.8])
})

test('explicit chart exclusions, private fields and later records stay excluded', () => {
  assert.deepEqual(points(current, [
    record('opt-out', '2026-10-05', 8, { feedback_form_snapshot: { id: formId, fields: [{ ...fields[0], includeInProgressChart: false }] } }),
    record('private', '2026-10-06', 9, { feedback_form_snapshot: { id: formId, fields: [{ ...fields[0], parentVisible: false, staffPrivate: true }] } }),
    history[5], current,
    record('later', '2026-10-14', 10),
  ]).map(point => point.value), [3.3, 3.2])
})

test('private and disabled score fields remain excluded even with explicit chart flags and saved averages', () => {
  for (const exclusion of [{ staffPrivate: true }, { staff_private: true }, { parentVisible: false }, { enabled: false }, { isEnabled: false }, { is_enabled: false }]) {
    const snapshot = { id: formId, name: 'U14 JPL', fields: [
      { ...fields[0], includeInProgressChart: true },
      { id: 'excluded', label: 'Excluded', type: 'score_1_10', parentVisible: true, includeInProgressChart: true, ...exclusion },
    ] }
    const records = ['2026-10-05', '2026-10-13'].map((date, index) => record(`exclusion-${index}`, date, 6, { feedback_form_snapshot: snapshot, form_responses: { fitness: 2, excluded: 10 } }))
    assert.deepEqual(points(records[1], records).map(point => point.value), [2, 2], JSON.stringify(exclusion))
  }
})

test('PDF and email receive the same correctly scoped chart without Elite scores', () => {
  const report = resolveDevelopmentParentReport({ evaluation: current, evaluations: history, requestedSections, club: { name: 'FP TEST Club' }, team: { name: 'FP TEST Team' }, player: { player_name: 'FP TEST Player' } })
  const content = buildDevelopmentParentReportContent(report)
  const document = buildAssessmentPdfDocument({ content })
  assert.deepEqual(report.emailSections[0].chartPoints.map(point => point.value), [4.2, 2.7, 3.3, 3.3, 3.2])
  assert.doesNotMatch(renderPdfDocumentHtml(document), /7\.8|Elite Attacking Review/)
})

test('saved report output repairs only selected progression while preserving snapshot identity and cutoff', () => {
  const report = { version: 1, evaluationId: current.id, historyCutoffAt: current.created_at, finalizedAt: '2026-10-13T12:01:00Z', form: { id: formId }, responseItems: [{ label: 'Selected response', rawValue: 'Preserved' }], recipients: [{ linkId: 'selected-parent' }], progressionIncluded: true, emailSections: [{ key: 'attendanceSummary', body: 'Preserved summary' }, { key: 'progressionChart', chartPoints: [{ value: 5 }, { value: 7.8 }] }] }
  const original = structuredClone(report)
  const repaired = getDevelopmentParentReport({ context: { evaluation: { ...current, development_parent_report: report }, evaluations: [...history, record('later', '2026-10-14', 10)] }, requestedSections: [{ key: 'coachComments' }] })
  assert.deepEqual(repaired.emailSections[1].chartPoints.map(point => point.value), [4.2, 2.7, 3.3, 3.3, 3.2])
  assert.deepEqual(repaired.responseItems, report.responseItems)
  assert.deepEqual(repaired.recipients, report.recipients)
  assert.deepEqual(repaired.emailSections[0], report.emailSections[0])
  assert.equal(repaired.finalizedAt, report.finalizedAt)
  assert.deepEqual(report, original)
  const excluded = { ...report, progressionIncluded: false, emailSections: [report.emailSections[0]] }
  assert.equal(repairDevelopmentParentReportProgression(excluded, current, history), excluded)
  assert.equal(repairDevelopmentParentReportProgression(report, { ...current, id: 'other' }, history), report)
})
