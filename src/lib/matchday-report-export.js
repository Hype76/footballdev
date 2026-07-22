import {
  buildCompletedMatchEventPresentation,
  buildFinalMatchReportSummary,
  formatCompletedMatchEventMinute,
  resolveCompletedMatchEventTeam,
  resolveCompletedMatchPlayerName,
} from './matchday-final-report.js'

const CSV_HEADINGS = [
  'Fixture',
  'Match date',
  'Match phase',
  'Match minute',
  'Stoppage minute',
  'Team',
  'Event type',
  'Player',
  'Related player',
  'Penalty goal',
  'Shootout result',
  'Event detail',
  'Display order',
]

const PHASE_LABELS = {
  pre_match: 'Pre-match',
  first_half: 'Normal time, first half',
  half_time: 'Half time',
  second_half: 'Normal time, second half',
  normal_time_complete: 'Normal time complete',
  extra_time_first_half: 'Extra time, first period',
  extra_time_half_time: 'Extra-time interval',
  extra_time_second_half: 'Extra time, second period',
  extra_time_complete: 'Extra time complete',
  penalties: 'Penalty shootout',
  full_time: 'Full time',
}

const WIN_ANSI_SPECIAL_BYTES = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e],
  [0x0178, 0x9f],
])

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function firstText(...values) {
  for (const value of values) {
    const normalized = normalizeText(value)
    if (normalized) return normalized
  }
  return ''
}

function getFixtureName(match = {}) {
  const teamName = firstText(match.teamName, match.team_name, match.teams?.name) || 'Our team'
  const opponent = firstText(match.opponent, match.opponentName, match.opponent_name) || 'Opponent'
  return `${teamName} v ${opponent}`
}

function getMatchDate(match = {}) {
  return firstText(match.matchDate, match.match_date) || 'Date not recorded'
}

function getClubName(match = {}) {
  return firstText(match.clubName, match.club_name, match.clubs?.name, match.teamName, match.team_name) || 'Football club'
}

function getMatchPhase(event = {}) {
  const phase = firstText(event.matchPhase, event.match_phase, event.eventPhase, event.event_phase, event.phase).toLowerCase()
  return PHASE_LABELS[phase] || (phase ? phase.replaceAll('_', ' ') : 'Not recorded')
}

function getMinuteParts(event = {}) {
  const minuteLabel = formatCompletedMatchEventMinute(event)
  const match = minuteLabel.match(/^(\d+)(?:\+(\d+))?'/)
  return {
    minute: match?.[1] ?? '',
    stoppageMinute: match?.[2] ?? '',
  }
}

function getFinalReportNotes(match = {}) {
  return normalizeText(match.finalReport?.staffNotes ?? match.final_report?.staff_notes ?? match.staffNotes ?? match.staff_notes)
}

function getEventDetail(event, match, { audience }) {
  const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: audience === 'staff' })
  const detailParts = [presentation.detail]
  if (audience === 'staff' && presentation.notes) detailParts.push(presentation.notes)
  return detailParts.filter(Boolean).join('. ')
}

function makeEventCsvRow(event, match, displayOrder, options) {
  const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: options.audience === 'staff' })
  const team = resolveCompletedMatchEventTeam(event, match)
  const minute = getMinuteParts(event)
  const eventType = firstText(event.eventType, event.event_type)

  return {
    Fixture: getFixtureName(match),
    'Match date': getMatchDate(match),
    'Match phase': getMatchPhase(event),
    'Match minute': minute.minute,
    'Stoppage minute': minute.stoppageMinute,
    Team: team.name,
    'Event type': presentation.title,
    Player: ['goal', 'yellow_card', 'red_card', 'substitution', 'injury'].includes(eventType)
      ? resolveCompletedMatchPlayerName(event, 'primary')
      : '',
    'Related player': eventType === 'substitution' ? resolveCompletedMatchPlayerName(event, 'secondary') : '',
    'Penalty goal': eventType === 'goal' && (event.isPenaltyGoal === true || event.is_penalty_goal === true) ? 'Yes' : 'No',
    'Shootout result': '',
    'Event detail': getEventDetail(event, match, options),
    'Display order': String(displayOrder),
  }
}

function makeShootoutCsvRow(kick, match, displayOrder) {
  const teamSide = firstText(kick.teamSide, kick.team_side) === 'opponent' ? 'opponent' : 'club'
  const team = teamSide === 'opponent'
    ? firstText(match.opponent, match.opponentName, match.opponent_name) || 'Opponent'
    : firstText(match.teamName, match.team_name, match.teams?.name) || 'Our team'
  const outcome = firstText(kick.eventStatus, kick.event_status) === 'voided'
    ? 'Voided'
    : firstText(kick.outcome) === 'scored' ? 'Scored' : 'Missed or saved'

  return {
    Fixture: getFixtureName(match),
    'Match date': getMatchDate(match),
    'Match phase': 'Penalty shootout',
    'Match minute': '',
    'Stoppage minute': '',
    Team: team,
    'Event type': 'Shootout kick',
    Player: firstText(kick.playerName, kick.player_name),
    'Related player': '',
    'Penalty goal': 'No',
    'Shootout result': outcome,
    'Event detail': `Kick ${Number(kick.kickNumber ?? kick.kick_number ?? 0) || ''}: ${outcome}`,
    'Display order': String(displayOrder),
  }
}

export function buildCompletedReportCsvRows(match = {}, { audience = 'parent' } = {}) {
  const safeAudience = audience === 'staff' ? 'staff' : 'parent'
  const summary = buildFinalMatchReportSummary(match)
  const eventRows = summary.timelineEvents.map((event, index) => makeEventCsvRow(event, match, index + 1, { audience: safeAudience }))
  const shootoutRows = summary.result.shootoutEvents.map((kick, index) => makeShootoutCsvRow(kick, match, eventRows.length + index + 1))
  return [...eventRows, ...shootoutRows]
}

export function protectSpreadsheetFormulaValue(value) {
  const text = String(value ?? '')
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text
}

function escapeCsvValue(value) {
  const protectedValue = protectSpreadsheetFormulaValue(value)
  return `"${protectedValue.replaceAll('"', '""')}"`
}

export function buildCompletedReportCsv(match = {}, options = {}) {
  const rows = buildCompletedReportCsvRows(match, options)
  const lines = [
    CSV_HEADINGS.map(escapeCsvValue).join(','),
    ...rows.map((row) => CSV_HEADINGS.map((heading) => escapeCsvValue(row[heading])).join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

function formatEventLine(event, match, { audience }) {
  const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: audience === 'staff' })
  const detail = getEventDetail(event, match, { audience })
  return `${presentation.minuteLabel} | ${presentation.team.name} | ${presentation.title}${detail ? ` | ${detail}` : ''}`
}

function buildPdfLines(match = {}, { audience = 'parent' } = {}) {
  const safeAudience = audience === 'staff' ? 'staff' : 'parent'
  const summary = buildFinalMatchReportSummary(match)
  const result = summary.result
  const lines = [
    { text: 'Completed Match Report', bold: true, size: 18 },
    { text: getClubName(match), bold: true, size: 12 },
    { text: `Fixture: ${getFixtureName(match)}` },
    { text: `Match date: ${getMatchDate(match)}` },
    { text: `Final score: ${result.finalScore}` },
    { text: `Normal time: ${result.regulationScore}` },
  ]

  if (result.extraTimeScore) lines.push({ text: `After extra time: ${result.extraTimeScore}` })
  if (result.shootoutScore) lines.push({ text: `Penalty shootout: ${result.shootoutScore}` })
  if (result.shootoutWinner) lines.push({ text: `Shootout winner: ${result.shootoutWinner}` })

  lines.push({ text: '' }, { text: 'Goals summary', bold: true, size: 12 })
  if (summary.activeGoals.length === 0) lines.push({ text: 'No active goals were recorded.' })
  for (const event of summary.activeGoals) lines.push({ text: formatEventLine(event, match, { audience: safeAudience }) })

  lines.push({ text: '' }, { text: 'Cards and substitutions', bold: true, size: 12 })
  const cardAndSubstitutionEvents = [...summary.activeCards, ...summary.activeSubstitutions]
  if (cardAndSubstitutionEvents.length === 0) lines.push({ text: 'No cards or substitutions were recorded.' })
  for (const event of cardAndSubstitutionEvents) lines.push({ text: formatEventLine(event, match, { audience: safeAudience }) })

  if (result.shootoutEvents.length > 0) {
    lines.push({ text: '' }, { text: 'Penalty shootout kicks', bold: true, size: 12 })
    for (const kick of result.shootoutEvents) {
      const row = makeShootoutCsvRow(kick, match, 0)
      lines.push({ text: `${row.Team}${row.Player ? `, ${row.Player}` : ''} | ${row['Event detail']}` })
    }
  }

  lines.push({ text: '' }, { text: 'Full event timeline', bold: true, size: 12 })
  if (summary.timelineEvents.length === 0) lines.push({ text: 'No timeline events were recorded.' })
  for (const event of summary.timelineEvents) lines.push({ text: formatEventLine(event, match, { audience: safeAudience }) })

  if (safeAudience === 'staff') {
    const staffNotes = getFinalReportNotes(match)
    if (staffNotes) lines.push({ text: '' }, { text: 'Staff notes', bold: true, size: 12 }, { text: staffNotes })
  }

  return lines
}

function wrapText(text, maxCharacters = 92) {
  const normalized = normalizeText(text)
  if (!normalized) return ['']
  const words = normalized.split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxCharacters) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function escapePdfLiteral(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function encodeWinAnsi(value) {
  const bytes = []
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0)
    if (WIN_ANSI_SPECIAL_BYTES.has(codePoint)) {
      bytes.push(WIN_ANSI_SPECIAL_BYTES.get(codePoint))
      continue
    }
    bytes.push(codePoint <= 0xff ? codePoint : 0x3f)
  }
  return Uint8Array.from(bytes)
}

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function textBytes(value) {
  return encodeWinAnsi(value)
}

function buildPdfPageStream(lines) {
  const commands = ['BT', '44 798 Td']
  let currentSize = 10
  let currentBold = false
  commands.push('/F1 10 Tf')
  for (const line of lines) {
    const size = line.size || 10
    const bold = line.bold === true
    if (size !== currentSize || bold !== currentBold) {
      commands.push(`/${bold ? 'F2' : 'F1'} ${size} Tf`)
      currentSize = size
      currentBold = bold
    }
    commands.push(`(${escapePdfLiteral(line.text)}) Tj`)
    commands.push(`0 -${size >= 16 ? 24 : size >= 12 ? 18 : 14} Td`)
  }
  commands.push('ET')
  return textBytes(commands.join('\n'))
}

export function buildCompletedReportPdf(match = {}, options = {}) {
  const sourceLines = buildPdfLines(match, options)
  const visualLines = sourceLines.flatMap((line) => wrapText(line.text, line.size >= 16 ? 60 : line.size >= 12 ? 76 : 92).map((text) => ({ ...line, text })))
  const pages = []
  let page = []
  let usedHeight = 0
  for (const line of visualLines) {
    const lineHeight = line.size >= 16 ? 24 : line.size >= 12 ? 18 : 14
    if (page.length > 0 && usedHeight + lineHeight > 720) {
      pages.push(page)
      page = []
      usedHeight = 0
    }
    page.push(line)
    usedHeight += lineHeight
  }
  if (page.length > 0) pages.push(page)
  if (pages.length === 0) pages.push([{ text: 'Completed Match Report', bold: true, size: 18 }])

  const fontRegularId = 3 + pages.length * 2
  const fontBoldId = fontRegularId + 1
  const objectBodies = new Map()
  const pageIds = pages.map((_, index) => 3 + index * 2)
  objectBodies.set(1, textBytes('<< /Type /Catalog /Pages 2 0 R >>'))
  objectBodies.set(2, textBytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  pages.forEach((pageLines, index) => {
    const pageId = 3 + index * 2
    const contentId = pageId + 1
    const stream = buildPdfPageStream(pageLines)
    objectBodies.set(pageId, textBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`))
    objectBodies.set(contentId, concatBytes([textBytes(`<< /Length ${stream.length} >>\nstream\n`), stream, textBytes('\nendstream')]))
  })
  objectBodies.set(fontRegularId, textBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  objectBodies.set(fontBoldId, textBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'))

  const chunks = [textBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]
  const offsets = [0]
  let byteOffset = chunks[0].length
  const objectCount = fontBoldId
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = byteOffset
    const objectChunk = concatBytes([textBytes(`${id} 0 obj\n`), objectBodies.get(id), textBytes('\nendobj\n')])
    chunks.push(objectChunk)
    byteOffset += objectChunk.length
  }
  const xrefOffset = byteOffset
  const xrefLines = [`xref`, `0 ${objectCount + 1}`, '0000000000 65535 f ']
  for (let id = 1; id <= objectCount; id += 1) xrefLines.push(`${String(offsets[id]).padStart(10, '0')} 00000 n `)
  chunks.push(textBytes(`${xrefLines.join('\n')}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`))
  return concatBytes(chunks)
}

function slugify(value) {
  return normalizeText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90)
}

export function getCompletedReportFilename(match = {}, extension = 'pdf') {
  const date = getMatchDate(match).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || 'match'
  const fixture = slugify(getFixtureName(match)) || 'completed-report'
  return `${date}-${fixture}-completed-report.${extension}`
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
}

export function downloadCompletedReportPdf(match = {}, options = {}) {
  const bytes = buildCompletedReportPdf(match, options)
  const filename = getCompletedReportFilename(match, 'pdf')
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename)
  return filename
}

export function downloadCompletedReportCsv(match = {}, options = {}) {
  const csv = buildCompletedReportCsv(match, options)
  const filename = getCompletedReportFilename(match, 'csv')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename)
  return filename
}
