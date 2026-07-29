import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDevelopmentParentEmailHtml,
} from '../src/lib/email-builder.js'
import {
  buildDevelopmentParentReportContent,
  getDevelopmentParentReportSemanticContent,
} from '../src/lib/development-parent-report-content.js'
import {
  buildAssessmentPdfDocument,
  renderPdfDocumentHtml,
} from '../src/lib/pdf-document.js'

function buildReport({
  attendance = true,
  progression = true,
  responseItems = null,
} = {}) {
  const ratings = Array.from({ length: 9 }, (_, index) => ({
    fieldId: `rating-${index + 1}`,
    label: `Development rating ${index + 1}`,
    type: 'score_1_10',
    rawValue: index + 1,
    displayValue: `${index + 1} / 10 - ${[
      'Well Below Standard',
      'Below Standard',
      'Needs Improvement',
      'Developing',
      'Expected Level',
      'Slightly Above Expected',
      'Good',
      'Very Good',
      'Excellent',
    ][index]}`,
    numericScore: index + 1,
    ratingLabel: [
      'Well Below Standard',
      'Below Standard',
      'Needs Improvement',
      'Developing',
      'Expected Level',
      'Slightly Above Expected',
      'Good',
      'Very Good',
      'Excellent',
    ][index],
    order: index + 1,
    parentVisible: true,
    selected: true,
  }))
  const narratives = [
    ['Key strengths', 'Calm first touch and brave receiving under pressure.'],
    ['Main Development priority', 'Scan earlier before the ball arrives.'],
    ['Recommended training focus', 'Two-touch passing with a moving target.'],
    ['Parent-visible summary', 'A positive review with clear progress this month.'],
    ['Review date', '29 July 2026'],
    ['Next review date', '29 August 2026'],
  ].map(([label, displayValue], index) => ({
    fieldId: `narrative-${index + 1}`,
    label,
    type: 'text',
    rawValue: displayValue,
    displayValue,
    numericScore: null,
    ratingLabel: '',
    order: 20 + index,
    parentVisible: true,
    selected: true,
  }))
  const emailSections = [
    ...(attendance
      ? [{
          key: 'attendanceSummary',
          title: 'Attendance summary',
          body: '12 development records logged. Training involvement: 8. Match involvement: 4.',
        }]
      : []),
    ...(progression
      ? [{
          key: 'progressionChart',
          title: 'Development progression',
          body: 'The current overall score is 5.0 / 10.',
          chartPoints: [
            { label: '01 Jun 2026', value: 4 },
            { label: '29 Jul 2026', value: 5 },
          ],
        }]
      : []),
  ]

  return {
    version: 1,
    finalizedAt: '2026-07-29T20:00:00.000Z',
    historyCutoffAt: '2026-07-29T20:00:00.000Z',
    evaluationId: 'evaluation-private-id',
    club: { id: 'club-private-id', name: 'FP TEST & Academy' },
    team: { id: 'team-private-id', name: 'Under 14 Development' },
    player: { id: 'player-private-id', name: "Clyde O'Neil" },
    author: { id: 'author-private-id', name: 'Simon and Steve' },
    section: 'Quarterly Development',
    recordDate: '2026-07-29',
    form: {
      id: 'form-private-id',
      name: 'Elite Player Development',
      version: 3,
    },
    recipients: [{ linkId: 'link-private-id', name: 'Alex Parent' }],
    responseItems: responseItems || [
      ...ratings,
      ...narratives,
      {
        fieldId: 'private-note-id',
        label: 'Private staff notes',
        type: 'textarea',
        displayValue: 'Never expose this note.',
        parentVisible: false,
        selected: true,
        order: 99,
      },
    ],
    overallScore: 5,
    attendanceIncluded: attendance,
    progressionIncluded: progression,
    emailSections,
  }
}

function normalizePdfSemantic(document) {
  const attendance = document.emailSections.find((section) => section.title === 'Attendance summary') || null
  const progression = document.emailSections.find((section) => section.title === 'Development progression') || null

  return {
    context: {
      teamName: document.context.teamName,
      playerName: document.context.playerName,
      reportDate: document.context.reportDate,
    },
    overallAssessment: {
      value: document.context.overallAssessment,
    },
    responseItems: document.responseItems.map((item) => ({
      label: item.label,
      value: item.value,
    })),
    attendance: attendance
      ? { title: attendance.title, body: attendance.body }
      : null,
    progression: progression
      ? {
          title: progression.title,
          body: progression.body,
          chartPoints: progression.chartPoints,
        }
      : null,
  }
}

test('canonical Development content drives complete email and PDF semantics', () => {
  const content = buildDevelopmentParentReportContent(buildReport())
  const emailHtml = buildDevelopmentParentEmailHtml({
    content,
    parentName: 'Alex Parent',
    pdfAttached: false,
  })
  const pdfDocument = buildAssessmentPdfDocument({ content })
  const pdfHtml = renderPdfDocumentHtml(pdfDocument)

  assert.equal(content.responseItems.length, 15)
  assert.equal(pdfDocument.responseItems.length, 15)

  for (let score = 1; score <= 9; score += 1) {
    assert.match(emailHtml, new RegExp(`Development rating ${score}`))
    assert.match(emailHtml, new RegExp(`${score} / 10`))
    assert.match(pdfHtml, new RegExp(`Development rating ${score}`))
    assert.match(pdfHtml, new RegExp(`${score} / 10`))
  }

  for (const expected of [
    'Key strengths',
    'Main Development priority',
    'Recommended training focus',
    'Parent-visible summary',
    'Review date',
    'Next review date',
    'Simon and Steve',
    'Elite Player Development',
    'Expected Level',
  ]) {
    assert.match(emailHtml, new RegExp(expected))
    assert.match(pdfHtml, new RegExp(expected))
  }

  assert.doesNotMatch(emailHtml, /Private staff notes|Never expose this note|private-id/)
  assert.doesNotMatch(pdfHtml, /Private staff notes|Never expose this note|private-id/)
})

test('email with PDF remains useful and claims the attachment only when present', () => {
  const content = buildDevelopmentParentReportContent(buildReport())
  const withPdf = buildDevelopmentParentEmailHtml({
    content,
    parentName: 'Alex Parent',
    pdfAttached: true,
  })
  const withoutPdf = buildDevelopmentParentEmailHtml({
    content,
    parentName: 'Alex Parent',
    pdfAttached: false,
  })

  assert.match(withPdf, /Hi Alex Parent/)
  assert.match(withPdf, /latest Development review has been completed by Simon and Steve/)
  assert.match(withPdf, /Overall assessment/)
  assert.match(withPdf, /5 \/ 10 - Expected Level/)
  assert.match(withPdf, /Key strengths/)
  assert.match(withPdf, /Main Development priority/)
  assert.match(withPdf, /The full club-branded Development report is attached\./)
  assert.doesNotMatch(withoutPdf, /Development report is attached/)

  for (const item of content.responseItems) {
    assert.match(withoutPdf, new RegExp(item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.ok(withoutPdf.includes(item.value))
  }
})

test('email and PDF inputs have matching normalized semantic content', () => {
  const content = buildDevelopmentParentReportContent(buildReport())
  const emailSemantic = getDevelopmentParentReportSemanticContent(content)
  const pdfSemantic = normalizePdfSemantic(buildAssessmentPdfDocument({ content }))

  assert.deepEqual(
    {
      context: emailSemantic.context,
      overallAssessment: { value: emailSemantic.overallAssessment.value },
      responseItems: emailSemantic.responseItems.map(({ label, value }) => ({ label, value })),
      attendance: emailSemantic.attendance,
      progression: emailSemantic.progression,
    },
    pdfSemantic,
  )
})

test('attendance and progression appear only when selected and share their exact values', () => {
  const fullContent = buildDevelopmentParentReportContent(buildReport())
  const limitedContent = buildDevelopmentParentReportContent(buildReport({
    attendance: false,
    progression: false,
  }))
  const fullEmail = buildDevelopmentParentEmailHtml({ content: fullContent })
  const fullPdf = buildAssessmentPdfDocument({ content: fullContent })
  const limitedEmail = buildDevelopmentParentEmailHtml({ content: limitedContent })
  const limitedPdf = buildAssessmentPdfDocument({ content: limitedContent })

  assert.match(fullEmail, /12 development records logged/)
  assert.equal(fullPdf.emailSections[0].body, fullContent.attendance.body)
  assert.deepEqual(fullPdf.emailSections[1].chartPoints, fullContent.progression.chartPoints)
  assert.doesNotMatch(limitedEmail, /Attendance summary|Development progression/)
  assert.equal(limitedPdf.emailSections.length, 0)
})

test('empty selected fields produce truthful output without misleading headings', () => {
  const report = buildReport({ responseItems: [] })
  report.overallScore = null
  const content = buildDevelopmentParentReportContent(report)
  const emailHtml = buildDevelopmentParentEmailHtml({ content })
  const pdfHtml = renderPdfDocumentHtml(buildAssessmentPdfDocument({ content }))

  assert.equal(content.emptySelection, true)
  assert.equal(content.overallAssessment.score, null)
  assert.equal(content.overallAssessment.value, 'Not recorded')
  assert.doesNotMatch(emailHtml, /No selected development details were included/)
  assert.doesNotMatch(emailHtml, /Current Development summary/)
  assert.match(emailHtml, /only the summary information deliberately selected/)
  assert.match(pdfHtml, /only the summary information deliberately selected/)
})

test('long labels, long narratives, and special characters remain inert and bounded', () => {
  const longLabel = `Long Development label ${'segment '.repeat(10)}`.trim()
  const longNarrative = `Clyde's progress <remains> strong & focused. ${'Safe narrative text. '.repeat(120)}`.trim()
  const report = buildReport({
    responseItems: [{
      fieldId: 'long-field-id',
      label: longLabel,
      type: 'textarea',
      displayValue: longNarrative,
      order: 1,
      parentVisible: true,
      selected: true,
    }],
  })
  const content = buildDevelopmentParentReportContent(report)
  const document = buildAssessmentPdfDocument({ content })
  const html = renderPdfDocumentHtml(document)

  assert.equal(document.responseItems.length, 1)
  assert.match(html, /Long Development label/)
  assert.match(html, /&lt;remains&gt; strong &amp; focused/)
  assert.doesNotMatch(html, /<remains>/)
})

test('controlled PDF limit failure leaves the attachment-free email path functional', () => {
  const oversizedValue = 'A'.repeat(4_001)
  const content = buildDevelopmentParentReportContent(buildReport({
    responseItems: [{
      fieldId: 'oversized-field-id',
      label: 'Parent-visible summary',
      type: 'textarea',
      displayValue: oversizedValue,
      order: 1,
      parentVisible: true,
      selected: true,
    }],
  }))
  const emailHtml = buildDevelopmentParentEmailHtml({
    content,
    pdfAttached: false,
  })

  assert.match(emailHtml, /Parent-visible summary/)
  assert.doesNotMatch(emailHtml, /Development report is attached/)
  assert.throws(
    () => buildAssessmentPdfDocument({ content }),
    { code: 'PDF_LIMIT_EXCEEDED' },
  )
})
