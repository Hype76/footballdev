import assert from 'node:assert/strict'
import test from 'node:test'
import { getParentDevelopmentProgression, getParentProgressionPlot, normalizeParentProgressionPoints } from '../apps/mobile-core/src/parentDevelopmentProgression.js'
import { getDevelopmentParentProgressionPolicy } from '../netlify/functions/lib/_development-parent-email-output.js'
import { buildParentDevelopmentHistory } from '../netlify/functions/lib/_parent-development-history.js'

const field = { id: 'technical', label: 'Technical', type: 'score_1_10', parentVisible: true, includeInProgressChart: true }
const item = { fieldId: 'technical', label: 'Technical', type: 'score_1_10', numericScore: 5, maxScore: 10, includeInProgressChart: true }
function report(id, date, score, extra = {}) {
  return { id, recordDate: date, finalizedAt: `${date}T${id === 'first' ? '10' : '11'}:00:00Z`, club: { id: 'club' }, team: { id: 'team' }, player: { id: 'player' }, form: { id: 'form', name: 'Elite Attacking Review', version: 1 }, progressionAllowed: true, responseItems: [{ ...item, numericScore: score }], overallScore: score, overallMaxScore: 10, sections: [], ...extra }
}
const first = report('first', '2026-10-07', 5), second = report('second', '2026-10-07', 7.8)

test('both same-day Elite reports expose the two shared assessments in saved order', () => {
  for (const selected of [first, second]) {
    const chart = getParentDevelopmentProgression(selected, [second, first])
    assert.deepEqual(chart.points, [{ label: '07:10:2026 #1', value: 5 }, { label: '07:10:2026 #2', value: 7.8 }])
  }
})

test('stable form identity preserves renamed forms and excludes equal names, other players, clubs and teams', () => {
  const cases = [{ form: { ...second.form, id: 'other' } }, { club: { id: 'other' } }, { team: { id: 'other' } }, { player: { id: 'other' } }]
  for (const extra of cases) assert.equal(getParentDevelopmentProgression(first, [first, { ...second, ...extra }]), null)
  assert.equal(getParentDevelopmentProgression(first, [first, { ...second, form: { ...second.form, name: 'Renamed form' } }]).points.length, 2)
  const starter = { ...first, form: { id: '', progressionId: 'platform-starter:elite-attacking-review:1', name: first.form.name } }
  assert.equal(getParentDevelopmentProgression(starter, [starter, { ...second, form: starter.form }]).points.length, 2)
  assert.equal(getParentDevelopmentProgression(starter, [starter, second]), null)
})

test('Add to chart exclusions and unselected or private numeric fields cannot supply a chart score', () => {
  for (const extra of [{ progressionAllowed: false }, { responseItems: [{ ...item, includeInProgressChart: false }] }, { responseItems: [{ ...item, numericScore: null }] }, { responseItems: [{ ...item, numericScore: 11 }] }]) {
    assert.equal(getParentDevelopmentProgression(first, [first, { ...second, ...extra }]), null)
  }
  assert.equal(getParentDevelopmentProgression({ ...first, progressionAllowed: false }, [first, second]), null)
  const mixed = [first, second].map(row => ({ ...row, overallScore: 9, responseItems: [{ ...item, numericScore: 2 }, { ...item, fieldId: 'private', numericScore: 10, includeInProgressChart: false }] }))
  assert.deepEqual(getParentDevelopmentProgression(mixed[0], mixed).points.map(p => p.value), [2, 2])
})

test('single assessment, empty sections and invalid points never produce an orphan heading', () => {
  assert.equal(getParentDevelopmentProgression(first, [first]), null)
  assert.equal(getParentDevelopmentProgression(first, [first, first]), null)
  assert.deepEqual(normalizeParentProgressionPoints([{ label: 'Bad', value: null }, { label: 'Bad', value: 'NaN' }, { label: 'Bad', value: 11 }, { label: '', value: 5 }]), [])
  const legacy = { ...first, progressionAllowed: undefined, sections: [{ key: 'progressionChart', chartPoints: [{ label: '5 Oct 2026', value: 4.2 }, { label: '7 Oct 2026 #1', value: 5 }] }] }
  assert.deepEqual(getParentDevelopmentProgression(legacy, [legacy]).points.map(p => p.label), ['05:10:2026', '07:10:2026 #1'])
  assert.equal(getParentDevelopmentProgression({ ...legacy, sections: [{ key: 'progressionChart', body: 'Scores are charted oldest to newest out of 10.' }] }, [legacy]), null)
})

test('saved shared averages remain authoritative when all score fields are eligible, mixed scales use safe normalisation', () => {
  const saved = [first, second].map(row => ({ ...row, progressionCanUseOverall: true, overallScore: 2.7, responseItems: [{ ...item, numericScore: 3.2 }] }))
  assert.deepEqual(getParentDevelopmentProgression(saved[0], saved).points.map(p => p.value), [2.7, 2.7])
  const unproven = saved.map(row => ({ ...row, progressionCanUseOverall: undefined }))
  assert.deepEqual(getParentDevelopmentProgression(unproven[0], unproven).points.map(p => p.value), [3.2, 3.2])
  const mixed = [first, second].map(row => ({ ...row, overallScore: 5, overallMaxScore: 5, responseItems: [{ ...item, numericScore: 8 }, { ...item, fieldId: 'five', numericScore: 4, maxScore: 5 }] }))
  assert.deepEqual(getParentDevelopmentProgression(mixed[0], mixed).points.map(p => p.value), [8, 8])
})

test('server eligibility uses the authoritative form snapshot and excludes disabled/private chart fields', () => {
  const evaluation = { feedback_form_snapshot: { id: 'platform-starter:elite:1', fields: [field, { ...field, id: 'private', staffPrivate: true }, { ...field, id: 'disabled', enabled: false }, { ...field, id: 'off', includeInProgressChart: false }] } }
  assert.deepEqual(getDevelopmentParentProgressionPolicy(evaluation), { formId: 'platform-starter:elite:1', fieldIds: ['technical'], overallFieldIds: [] })
  for (const flag of [{ parentVisible: false }, { isDefault: true, parentVisible: false }, { parent_visible: false }, { isEnabled: false }, { is_enabled: false }, { staff_private: true }]) assert.deepEqual(getDevelopmentParentProgressionPolicy({ feedback_form_snapshot: { id: 'form', fields: [{ ...field, ...flag }] } }).fieldIds, [])
})

test('actual history never reuses an average containing omitted private, disabled, excluded or unselected scores', () => {
  const parentLink = { id: 'parent', club_id: 'club', team_id: 'team', player_id: 'player' }
  for (const hidden of [{ staffPrivate: true }, { enabled: false }, { includeInProgressChart: false }, {}]) {
    const progressionPolicy = getDevelopmentParentProgressionPolicy({ feedback_form_snapshot: { id: 'form', fields: [field, { ...field, id: 'omitted', ...hidden }] } })
    const rows = [first, second].map(row => ({ evaluation_id: row.id, finalized_at: row.finalizedAt, progressionPolicy,
      report_snapshot: { ...row, evaluationId: row.id, recipients: [{ linkId: 'parent' }], overallScore: 9,
        responseItems: [{ ...item, numericScore: 2, displayValue: '2 / 10', selected: true, parentVisible: true }], emailSections: [] } }))
    const history = buildParentDevelopmentHistory({ parentLink, reportRows: rows, communicationLogs: [], queues: [] })
    assert.equal(history.length, 2)
    assert.equal(history[0].progressionCanUseOverall, false)
    assert.deepEqual(getParentDevelopmentProgression(history[0], history).points.map(point => point.value), [2, 2])
    assert.equal(JSON.stringify(history).includes('overallFieldIds'), false, 'Authoritative field identifiers remain server-only')
  }
  const progressionPolicy = getDevelopmentParentProgressionPolicy({ feedback_form_snapshot: { id: 'form', fields: [field] } })
  const rows = [first, second].map(row => ({ evaluation_id: row.id, finalized_at: row.finalizedAt, progressionPolicy,
    report_snapshot: { ...row, evaluationId: row.id, recipients: [{ linkId: 'parent' }], overallScore: 2.7,
      responseItems: [{ ...item, numericScore: 3.2, displayValue: '3.2 / 10', selected: true, parentVisible: true }], emailSections: [] } }))
  const history = buildParentDevelopmentHistory({ parentLink, reportRows: rows, communicationLogs: [], queues: [] })
  assert.equal(history[0].progressionCanUseOverall, true)
  assert.deepEqual(getParentDevelopmentProgression(history[0], history).points.map(point => point.value), [2.7, 2.7])
})

test('actual Parent history only publishes chart eligibility on responses already shared to that relationship', () => {
  const snapshot = { evaluationId: 'first', version: 1, club: { id: 'club' }, team: { id: 'team' }, player: { id: 'player' }, form: { id: '', name: 'Elite Attacking Review' }, recipients: [{ linkId: 'parent' }], responseItems: [{ ...item, displayValue: '5 / 10', selected: true, parentVisible: true }, { ...item, fieldId: 'private', displayValue: 'Hidden', parentVisible: false }], recordDate: first.recordDate, emailSections: [], overallScore: 5 }
  const rows = [{ evaluation_id: 'first', report_snapshot: snapshot, finalized_at: first.finalizedAt, progressionPolicy: { formId: 'platform-starter:elite:1', fieldIds: ['technical'] } }, { evaluation_id: 'foreign', report_snapshot: { ...snapshot, evaluationId: 'foreign', recipients: [{ linkId: 'other-parent' }] } }]
  const history = buildParentDevelopmentHistory({ parentLink: { id: 'parent', club_id: 'club', team_id: 'team', player_id: 'player' }, reportRows: rows, communicationLogs: [], queues: [] })
  assert.equal(history.length, 1)
  assert.equal(history[0].progressionAllowed, true)
  assert.equal(history[0].form.progressionId, 'platform-starter:elite:1')
  assert.equal(history[0].responseItems.length, 1)
  assert.equal(history[0].responseItems[0].includeInProgressChart, true)
})

test('native chart coordinates remain bounded with 44px point targets at small widths and long histories', () => {
  for (const count of [2, 7, 100]) for (const width of [280, 340]) {
    const plot = getParentProgressionPlot(Array.from({ length: count }, (_, i) => ({ label: String(i), value: i % 11 })), width)
    assert.ok(plot.width >= width)
    for (const point of plot.positions) assert.ok(point.x >= 22 && point.x + 22 <= plot.width && point.y >= 28 && point.y <= 172)
    for (let i = 1; i < count; i++) assert.ok(plot.positions[i].x - plot.positions[i - 1].x >= 44)
    assert.ok(plot.segments.every(line => Number.isFinite(line.left) && Number.isFinite(line.top) && line.width > 0))
  }
})
