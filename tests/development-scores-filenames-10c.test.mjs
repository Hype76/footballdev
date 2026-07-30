import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  resolveDevelopmentParentReport,
  createDevelopmentOutputKey,
} from '../netlify/functions/lib/_development-parent-email-output.js'
import {
  buildParentDevelopmentHistory,
} from '../netlify/functions/lib/_parent-development-history.js'
import {
  buildDevelopmentParentEmailHtml,
} from '../src/lib/email-builder.js'
import {
  buildDevelopmentParentReportContent,
  getDevelopmentParentReportSemanticContent,
} from '../src/lib/development-parent-report-content.js'
import {
  buildDevelopmentPdfContentDisposition,
  buildDevelopmentPdfFilename,
  DEVELOPMENT_PDF_FILENAME_MAX_LENGTH,
} from '../src/lib/development-pdf-filename.js'
import { normalizeDevelopmentScorePresentation } from '../src/lib/development-score-contract.js'
import {
  buildAssessmentPdfDocument,
  renderPdfDocumentHtml,
} from '../src/lib/pdf-document.js'

const clubId = '11111111-1111-4111-8111-111111111111'
const teamId = '22222222-2222-4222-8222-222222222222'
const playerId = '33333333-3333-4333-8333-333333333333'
const evaluationId = '44444444-4444-4444-8444-444444444444'
const parentLinkId = '55555555-5555-4555-8555-555555555555'

function buildEvaluation(overrides = {}) {
  return {
    id: evaluationId,
    club_id: clubId,
    team_id: teamId,
    player_id: playerId,
    coach_id: '66666666-6666-4666-8666-666666666666',
    player_name: "Ava O'Neil-Smith",
    coach: 'Coach Test',
    team: 'U17 Green',
    section: 'Development',
    date: '2026-07-30',
    created_at: '2026-07-30T12:00:00.000Z',
    average_score: 5,
    form_responses: {
      'First touch': 1,
      'Decision making': 5,
      'Game impact': 10,
      'Legacy positioning': 4,
      'Unselected score': 7,
      'Missing score': '',
      'Coach narrative': 'Strong scanning and calm receiving.',
      'Private staff note': 'Never expose this note.',
    },
    feedback_form_snapshot: {
      formId: '77777777-7777-4777-8777-777777777777',
      formName: 'Named Development Review',
      formVersion: 4,
      fields: [
        { id: 'first-touch', label: 'First touch', type: 'score_1_10', parentVisible: false, orderIndex: 1 },
        { id: 'decision-making', label: 'Decision making', type: 'score_1_10', parentVisible: false, orderIndex: 2 },
        { id: 'game-impact', label: 'Game impact', type: 'score_1_10', parentVisible: false, orderIndex: 3 },
        { id: 'legacy-positioning', label: 'Legacy positioning', type: 'score_1_5', parentVisible: false, orderIndex: 4 },
        { id: 'unselected-score', label: 'Unselected score', type: 'score_1_10', parentVisible: false, orderIndex: 5 },
        { id: 'missing-score', label: 'Missing score', type: 'score_1_10', parentVisible: false, orderIndex: 6 },
        { id: 'coach-narrative', label: 'Coach narrative', type: 'textarea', parentVisible: true, orderIndex: 7 },
        { id: 'private-note', label: 'Private staff note', type: 'textarea', parentVisible: false, orderIndex: 8 },
      ],
    },
    ...overrides,
  }
}

function buildResolvedReport() {
  return resolveDevelopmentParentReport({
    club: { id: clubId, name: 'FP TEST' },
    evaluation: buildEvaluation(),
    player: { id: playerId, player_name: "Ava O'Neil-Smith" },
    recipients: [{ linkId: parentLinkId, name: 'FP TEST Parent' }],
    requestedResponses: [
      { fieldId: 'first-touch', label: 'First touch' },
      { fieldId: 'decision-making', label: 'Decision making' },
      { fieldId: 'game-impact', label: 'Game impact' },
      { fieldId: 'legacy-positioning', label: 'Legacy positioning' },
      { fieldId: 'missing-score', label: 'Missing score' },
      { fieldId: 'coach-narrative', label: 'Coach narrative' },
      { fieldId: 'private-note', label: 'Private staff note' },
    ],
    requestedSections: [],
    team: { id: teamId, name: 'U17 Green' },
  })
}

test('explicitly selected saved scores use their authoritative scales while private and unselected fields remain excluded', () => {
  const report = buildResolvedReport()

  assert.deepEqual(
    report.responseItems.map(({ label, displayValue }) => ({ label, displayValue })),
    [
      { label: 'First touch', displayValue: '1 / 10 - Well Below Standard' },
      { label: 'Decision making', displayValue: '5 / 10 - Expected Level' },
      { label: 'Game impact', displayValue: '10 / 10 - Exceptional' },
      { label: 'Legacy positioning', displayValue: '4 / 5 - Developing' },
      { label: 'Coach narrative', displayValue: 'Strong scanning and calm receiving.' },
    ],
  )
  assert.equal(report.responseItems.some((item) => item.label === 'Unselected score'), false)
  assert.equal(report.responseItems.some((item) => item.label === 'Missing score'), false)
  assert.equal(report.responseItems.some((item) => item.label === 'Private staff note'), false)
  assert.equal(JSON.stringify(report).includes('Never expose this note.'), false)
  assert.equal(report.responseItems[0].maxScore, 10)
  assert.equal(report.responseItems[3].maxScore, 5)
  assert.deepEqual(report.responseItems.map((item) => item.order), [1, 2, 3, 4, 7])
})

test('snapshot, email, PDF, and Parent Portal history share exact score semantics', () => {
  const report = buildResolvedReport()
  const content = buildDevelopmentParentReportContent(report)
  const semantic = getDevelopmentParentReportSemanticContent(content)
  const emailHtml = buildDevelopmentParentEmailHtml({ content, parentName: 'FP TEST Parent', pdfAttached: true })
  const emailWithoutPdfHtml = buildDevelopmentParentEmailHtml({
    content,
    parentName: 'FP TEST Parent',
    pdfAttached: false,
  })
  const pdfDocument = buildAssessmentPdfDocument({ content })
  const pdfHtml = renderPdfDocumentHtml(pdfDocument)
  const history = buildParentDevelopmentHistory({
    parentLink: {
      id: parentLinkId,
      club_id: clubId,
      team_id: teamId,
      player_id: playerId,
    },
    reportRows: [{
      evaluation_id: evaluationId,
      club_id: clubId,
      finalized_at: report.finalizedAt,
      report_snapshot: report,
    }],
    communicationLogs: [{
      evaluation_id: evaluationId,
      action: 'parent_email_sent',
      channel: 'email',
      created_at: report.finalizedAt,
      metadata: {
        developmentOutputKey: createDevelopmentOutputKey(evaluationId, parentLinkId),
        recipientLinkId: parentLinkId,
        hasAttachment: true,
      },
    }],
    queues: [],
  })

  const expectedScores = [
    ['First touch', '1 / 10 - Well Below Standard'],
    ['Decision making', '5 / 10 - Expected Level'],
    ['Game impact', '10 / 10 - Exceptional'],
    ['Legacy positioning', '4 / 5 - Developing'],
  ]

  for (const [label, value] of expectedScores) {
    assert.equal(semantic.responseItems.find((item) => item.label === label)?.value, value)
    assert.equal(pdfDocument.responseItems.find((item) => item.label === label)?.value, value)
    assert.equal(history[0].responseItems.find((item) => item.label === label)?.displayValue, value)
    assert.ok(emailHtml.includes(label))
    assert.ok(emailWithoutPdfHtml.includes(label))
    assert.ok(emailWithoutPdfHtml.includes(value))
    assert.ok(emailHtml.includes(value))
    assert.ok(pdfHtml.includes(label))
    assert.ok(pdfHtml.includes(value))
  }

  for (const output of [JSON.stringify(semantic), emailHtml, pdfHtml, JSON.stringify(history)]) {
    assert.doesNotMatch(output, /Private staff note|Never expose this note|Unselected score|Missing score/)
  }
  assert.match(emailHtml, /full club-branded Development report is attached/)
  assert.doesNotMatch(emailWithoutPdfHtml, /Development report is attached/)
})

test('historical score displays retain their saved maximum and optional rating', () => {
  const content = buildDevelopmentParentReportContent({
    ...buildResolvedReport(),
    responseItems: [
      {
        fieldId: 'historic-score',
        label: 'Historic score',
        type: 'score_1_5',
        displayValue: '0 / 5 - Invalid legacy zero',
        order: 1,
        parentVisible: true,
        selected: true,
      },
      {
        fieldId: 'historic-score-valid',
        label: 'Historic valid score',
        type: 'score_1_5',
        displayValue: '5 / 5 - Expected Level',
        order: 2,
        parentVisible: true,
        selected: true,
      },
    ],
  })

  assert.equal(content.responseItems[0].value, '0 / 5 - Invalid legacy zero')
  assert.equal(content.responseItems[0].numericScore, null)
  assert.equal(content.responseItems[1].value, '5 / 5 - Expected Level')
  assert.equal(content.responseItems[1].numericScore, 5)
  assert.equal(content.responseItems[1].maxScore, 5)

  assert.deepEqual(
    normalizeDevelopmentScorePresentation({
      type: 'number',
      numericScore: 0,
      maxScore: 10,
      ratingLabel: 'Baseline',
    }),
    {
      type: 'number',
      displayValue: '0 / 10 - Baseline',
      numericScore: 0,
      maxScore: 10,
      ratingLabel: 'Baseline',
      isScored: true,
    },
  )
})

test('canonical PDF filenames use immutable snapshot identity, preserve safe names, and stay bounded', () => {
  const cases = [
    [{
      player: { name: "Ava O'Neil-Smith" },
      recordDate: '30/07/2026',
      team: { name: 'U17 Green' },
    }, "Ava O'Neil-Smith - 30-07-26 - U17 Green.pdf"],
    [{
      player: { name: 'Zoë Núñez' },
      recordDate: '2026-01-09T12:00:00.000Z',
      team: { name: 'Élite Académie' },
    }, 'Zoë Núñez - 09-01-26 - Élite Académie.pdf'],
    [{
      player: { name: 'Ava <Test>: Player?' },
      recordDate: '2026-07-30',
      team: { name: 'U17 / Green*' },
    }, 'Ava Test Player - 30-07-26 - U17 Green.pdf'],
    [{
      player: {},
      recordDate: '',
      team: {},
    }, 'Player - Date not recorded - Team.pdf'],
    [{
      player: { name: 'Historical Player' },
      recordDate: '9-1-26',
      team: { name: 'Historical Team' },
    }, 'Historical Player - 09-01-26 - Historical Team.pdf'],
  ]

  for (const [snapshot, expected] of cases) {
    assert.equal(buildDevelopmentPdfFilename(snapshot), expected)
  }

  const longFilename = buildDevelopmentPdfFilename({
    player: { name: `Player ${'Long '.repeat(80)}` },
    recordDate: '2026-07-30',
    team: { name: `Team ${'Wide '.repeat(80)}` },
  })
  assert.ok(Array.from(longFilename).length <= DEVELOPMENT_PDF_FILENAME_MAX_LENGTH)
  assert.ok(new TextEncoder().encode(longFilename).length <= DEVELOPMENT_PDF_FILENAME_MAX_LENGTH)
  assert.match(longFilename, / - 30-07-26 - .+\.pdf$/)
  assert.doesNotMatch(longFilename, /[<>:"/\\|?*\u0000-\u001f\u007f]/)

  const disposition = buildDevelopmentPdfContentDisposition(cases[1][1])
  assert.match(disposition, /^attachment; filename="[^"]+\.pdf"; filename\*=UTF-8''/)
  assert.ok(disposition.includes('%C3%AB'))
  assert.doesNotMatch(disposition, /filename\*=UTF-8''[^;]*'/)
  assert.match(
    buildDevelopmentPdfContentDisposition(cases[0][1]),
    /filename\*=UTF-8''Ava%20O%27Neil-Smith/,
  )
})

test('email attachment and historical download share only the server-built canonical filename', () => {
  const emailSource = readFileSync(
    new URL('../netlify/functions/send-parent-email.js', import.meta.url),
    'utf8',
  )
  const historySource = readFileSync(
    new URL('../netlify/functions/parent-development-history.js', import.meta.url),
    'utf8',
  )
  const panelSource = readFileSync(
    new URL('../src/components/parent-portal/ParentDevelopmentPanel.jsx', import.meta.url),
    'utf8',
  )

  assert.match(emailSource, /buildDevelopmentPdfFilename\(developmentReport\)/)
  assert.match(emailSource, /filename: developmentPdfFilename/)
  assert.doesNotMatch(emailSource, /filename:\s*body\./)
  assert.match(historySource, /buildDevelopmentPdfFilename\(reportSnapshot\)/)
  assert.match(historySource, /buildDevelopmentPdfContentDisposition\(filename\)/)
  assert.doesNotMatch(historySource, /development-report-\$\{date\}/)
  assert.doesNotMatch(panelSource, /numericScore\}\s*\/\s*10/)
})
