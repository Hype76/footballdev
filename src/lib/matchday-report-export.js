import {
  buildCompletedMatchEventPresentation,
  buildFinalMatchReportSummary,
  formatCompletedMatchEventMinute,
  resolveCompletedMatchEventTeam,
  resolveCompletedMatchPlayerName,
} from './matchday-final-report.js'
import {
  PDF_BRANDING_SOURCES,
  createPdfBrandingFallback,
  validatePdfBranding,
} from './pdf-branding.js'
import { createThemeColorTokens } from './theme.js'

const CSV_HEADINGS = [
  'Club',
  'Fixture',
  'Match date',
  'Half-time score',
  'Full-time score',
  'Match phase',
  'Match minute',
  'Stoppage minute',
  'Team',
  'Event type',
  'Player',
  'Related player',
  'Penalty',
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
    Club: getClubName(match),
    Fixture: getFixtureName(match),
    'Match date': getMatchDate(match),
    'Half-time score': options.result.halfTimeScore,
    'Full-time score': options.result.fullTimeScore,
    'Match phase': getMatchPhase(event),
    'Match minute': minute.minute,
    'Stoppage minute': minute.stoppageMinute,
    Team: team.name,
    'Event type': presentation.title,
    Player: ['goal', 'yellow_card', 'red_card', 'substitution', 'injury'].includes(eventType)
      ? resolveCompletedMatchPlayerName(event, 'primary')
      : '',
    'Related player': eventType === 'substitution' ? resolveCompletedMatchPlayerName(event, 'secondary') : '',
    Penalty: eventType === 'goal' && (event.isPenaltyGoal === true || event.is_penalty_goal === true) ? 'Yes' : 'No',
    'Shootout result': '',
    'Event detail': getEventDetail(event, match, options),
    'Display order': String(displayOrder),
  }
}

function makeShootoutCsvRow(kick, match, displayOrder, result = buildFinalMatchReportSummary(match).result) {
  const teamSide = firstText(kick.teamSide, kick.team_side) === 'opponent' ? 'opponent' : 'club'
  const team = teamSide === 'opponent'
    ? firstText(match.opponent, match.opponentName, match.opponent_name) || 'Opponent'
    : firstText(match.teamName, match.team_name, match.teams?.name) || 'Our team'
  const outcome = firstText(kick.eventStatus, kick.event_status) === 'voided'
    ? 'Voided'
    : firstText(kick.outcome) === 'scored' ? 'Scored' : 'Missed or saved'

  return {
    Club: getClubName(match),
    Fixture: getFixtureName(match),
    'Match date': getMatchDate(match),
    'Half-time score': result.halfTimeScore,
    'Full-time score': result.fullTimeScore,
    'Match phase': 'Penalty shootout',
    'Match minute': '',
    'Stoppage minute': '',
    Team: team,
    'Event type': 'Shootout kick',
    Player: firstText(kick.playerName, kick.player_name),
    'Related player': '',
    Penalty: 'No',
    'Shootout result': outcome,
    'Event detail': `Kick ${Number(kick.kickNumber ?? kick.kick_number ?? 0) || ''}: ${outcome}`,
    'Display order': String(displayOrder),
  }
}

export function buildCompletedReportCsvRows(match = {}, { audience = 'parent' } = {}) {
  const safeAudience = audience === 'staff' ? 'staff' : 'parent'
  const summary = buildFinalMatchReportSummary(match)
  const result = summary.result
  const summaryRow = {
    Club: getClubName(match),
    Fixture: getFixtureName(match),
    'Match date': getMatchDate(match),
    'Half-time score': result.halfTimeScore,
    'Full-time score': result.fullTimeScore,
    'Match phase': 'Full time',
    'Match minute': '',
    'Stoppage minute': '',
    Team: firstText(match.teamName, match.team_name, match.teams?.name) || 'Our team',
    'Event type': 'Match summary',
    Player: '',
    'Related player': '',
    Penalty: 'No',
    'Shootout result': '',
    'Event detail': `Half time ${result.halfTimeScore}. Full time ${result.fullTimeScore}.`,
    'Display order': '0',
  }
  const eventRows = summary.timelineEvents.map((event, index) => makeEventCsvRow(event, match, index + 1, { audience: safeAudience, result }))
  const shootoutRows = result.shootoutEvents.map((kick, index) => makeShootoutCsvRow(kick, match, eventRows.length + index + 1, result))
  return [summaryRow, ...eventRows, ...shootoutRows]
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

const PDF_PAGE_WIDTH = 595
const PDF_PAGE_HEIGHT = 842
const PDF_MARGIN = 42
const PDF_CONTENT_BOTTOM = 68

function wrapText(text, maxCharacters = 92) {
  const normalized = normalizeText(text)
  if (!normalized) return ['']
  const words = normalized.split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (current) {
        lines.push(current)
        current = ''
      }
      for (let index = 0; index < word.length; index += maxCharacters) {
        lines.push(word.slice(index, index + maxCharacters))
      }
      continue
    }
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

function normalizePdfHexColour(value, fallback = '#047857') {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback
}

function pdfColour(value, fallback = '#047857') {
  const normalized = normalizePdfHexColour(value, fallback).slice(1)
  return [0, 2, 4]
    .map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255)
    .map((channel) => channel.toFixed(3))
    .join(' ')
}

function getPdfContrastText(background) {
  const normalized = normalizePdfHexColour(background).slice(1)
  const channels = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255)
  const luminance = (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
  return luminance > 0.58 ? '#06110a' : '#ffffff'
}

function formatReportDate(value) {
  const normalized = normalizeText(value)
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return normalized || 'Date not recorded'
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`
}

function getReportVenue(match = {}) {
  return firstText(match.venueName, match.venue_name, match.venue, match.locationName, match.location_name)
}

function getReportTeamNames(match = {}) {
  const clubTeam = firstText(match.teamName, match.team_name, match.teams?.name) || 'Our team'
  const opponent = firstText(match.opponent, match.opponentName, match.opponent_name) || 'Opponent'
  const isAway = firstText(match.homeAway, match.home_away).toLowerCase() === 'away'
  return {
    clubTeam,
    opponent,
    home: isAway ? opponent : clubTeam,
    away: isAway ? clubTeam : opponent,
  }
}

function splitScore(score) {
  const parts = String(score ?? '').split('-').map((part) => part.trim())
  return parts.length === 2 ? parts : ['0', '0']
}

function getEventTone(event = {}, branding = {}) {
  const eventType = firstText(event.eventType, event.event_type)
  if (eventType === 'red_card') return '#b42318'
  if (eventType === 'yellow_card') return '#b7791f'
  if (eventType === 'substitution') return '#6941c6'
  if (eventType === 'injury') return '#b54708'
  return branding.primaryColour
}

function buildPdfEvent(event, match, { audience, branding, includeScore = false }) {
  const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: audience === 'staff' })
  const detail = getEventDetail(event, match, { audience })
  return {
    detail,
    minute: presentation.status === 'voided' ? `Voided ${presentation.minuteLabel}` : presentation.minuteLabel,
    notes: presentation.notes || '',
    score: includeScore ? presentation.scoreLabel : '',
    team: presentation.team.name,
    title: presentation.title,
    tone: getEventTone(event, branding),
  }
}

function buildPdfShootoutEvent(kick, match, result, branding) {
  const row = makeShootoutCsvRow(kick, match, 0, result)
  return {
    detail: row['Event detail'],
    minute: `Kick ${kick.kickNumber ?? kick.kick_number ?? ''}`,
    notes: '',
    score: '',
    team: row.Team,
    title: row.Player || 'Penalty taker not recorded',
    tone: branding.primaryColour,
  }
}

function buildPdfReportModel(match = {}, { audience = 'parent', branding } = {}) {
  const safeAudience = audience === 'staff' ? 'staff' : 'parent'
  const summary = buildFinalMatchReportSummary(match)
  const result = summary.result
  const teamNames = getReportTeamNames(match)
  const [homeScore, awayScore] = splitScore(result.fullTimeScore)
  const cardAndSubstitutionEvents = summary.timelineEvents.filter((event) => (
    ['yellow_card', 'red_card', 'substitution'].includes(firstText(event.eventType, event.event_type))
  ))
  const yellowCards = summary.activeCards.filter((event) => firstText(event.eventType, event.event_type) === 'yellow_card').length
  const redCards = summary.activeCards.filter((event) => firstText(event.eventType, event.event_type) === 'red_card').length

  const sections = [
    {
      title: 'Goals summary',
      emptyLabel: 'No active goals were recorded.',
      items: summary.activeGoals.map((event) => buildPdfEvent(event, match, { audience: safeAudience, branding })),
    },
    {
      title: 'Cards and substitutions',
      emptyLabel: 'No cards or substitutions were recorded.',
      items: cardAndSubstitutionEvents.map((event) => buildPdfEvent(event, match, { audience: safeAudience, branding })),
    },
  ]

  if (result.shootoutEvents.length > 0) {
    sections.push({
      title: 'Penalty shootout kicks',
      emptyLabel: 'No penalty shootout kicks were recorded.',
      items: result.shootoutEvents.map((kick) => buildPdfShootoutEvent(kick, match, result, branding)),
    })
  }

  sections.push({
    title: 'Full event timeline',
    emptyLabel: 'No timeline events were recorded.',
    items: summary.timelineEvents.map((event) => buildPdfEvent(event, match, { audience: safeAudience, branding, includeScore: true })),
  })

  return {
    audience: safeAudience,
    branding,
    fixture: getFixtureName(match),
    matchDate: formatReportDate(getMatchDate(match)),
    venue: getReportVenue(match),
    teamNames,
    score: { home: homeScore, away: awayScore },
    result,
    metrics: [
      { label: 'Goals', value: String(summary.activeGoals.length) },
      { label: 'Yellow cards', value: String(yellowCards) },
      { label: 'Red cards', value: String(redCards) },
      { label: 'Substitutions', value: String(summary.activeSubstitutions.length) },
    ],
    sections,
    staffNotes: safeAudience === 'staff' ? getFinalReportNotes(match) : '',
  }
}

function roundedRectPath(x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
  const c = safeRadius * 0.55228475
  return [
    `${(x + safeRadius).toFixed(2)} ${y.toFixed(2)} m`,
    `${(x + width - safeRadius).toFixed(2)} ${y.toFixed(2)} l`,
    `${(x + width - safeRadius + c).toFixed(2)} ${y.toFixed(2)} ${(x + width).toFixed(2)} ${(y + safeRadius - c).toFixed(2)} ${(x + width).toFixed(2)} ${(y + safeRadius).toFixed(2)} c`,
    `${(x + width).toFixed(2)} ${(y + height - safeRadius).toFixed(2)} l`,
    `${(x + width).toFixed(2)} ${(y + height - safeRadius + c).toFixed(2)} ${(x + width - safeRadius + c).toFixed(2)} ${(y + height).toFixed(2)} ${(x + width - safeRadius).toFixed(2)} ${(y + height).toFixed(2)} c`,
    `${(x + safeRadius).toFixed(2)} ${(y + height).toFixed(2)} l`,
    `${(x + safeRadius - c).toFixed(2)} ${(y + height).toFixed(2)} ${x.toFixed(2)} ${(y + height - safeRadius + c).toFixed(2)} ${x.toFixed(2)} ${(y + height - safeRadius).toFixed(2)} c`,
    `${x.toFixed(2)} ${(y + safeRadius).toFixed(2)} l`,
    `${x.toFixed(2)} ${(y + safeRadius - c).toFixed(2)} ${(x + safeRadius - c).toFixed(2)} ${y.toFixed(2)} ${(x + safeRadius).toFixed(2)} ${y.toFixed(2)} c`,
    'h',
  ].join('\n')
}

function addPdfRect(page, { x, top, width, height, fill = '', stroke = '', lineWidth = 1, radius = 0 }) {
  const y = PDF_PAGE_HEIGHT - top - height
  const paint = fill && stroke ? 'B' : fill ? 'f' : 'S'
  page.commands.push('q')
  if (fill) page.commands.push(`${pdfColour(fill)} rg`)
  if (stroke) page.commands.push(`${pdfColour(stroke)} RG`, `${lineWidth} w`)
  page.commands.push(radius > 0 ? roundedRectPath(x, y, width, height, radius) : `${x} ${y} ${width} ${height} re`)
  page.commands.push(paint, 'Q')
}

function estimatePdfTextWidth(text, size, bold = false) {
  return normalizeText(text).length * size * (bold ? 0.57 : 0.52)
}

function addPdfText(page, text, {
  x,
  top,
  size = 10,
  colour = '#101828',
  bold = false,
  align = 'left',
  width = 0,
} = {}) {
  const normalized = normalizeText(text)
  if (!normalized) return
  let textX = x
  if (align === 'center' && width > 0) textX = x + Math.max(0, (width - estimatePdfTextWidth(normalized, size, bold)) / 2)
  if (align === 'right' && width > 0) textX = x + Math.max(0, width - estimatePdfTextWidth(normalized, size, bold))
  const y = PDF_PAGE_HEIGHT - top - size
  page.commands.push(
    'BT',
    `/${bold ? 'F2' : 'F1'} ${size} Tf`,
    `${pdfColour(colour, '#101828')} rg`,
    `1 0 0 1 ${textX.toFixed(2)} ${y.toFixed(2)} Tm`,
    `(${escapePdfLiteral(normalized)}) Tj`,
    'ET',
  )
}

function addWrappedPdfText(page, text, {
  x,
  top,
  width,
  size = 10,
  lineHeight = size + 3,
  colour = '#4b5f55',
  bold = false,
  maxLines = 0,
} = {}) {
  const maxCharacters = Math.max(12, Math.floor(width / Math.max(4, size * 0.53)))
  const wrapped = wrapText(text, maxCharacters)
  const lines = maxLines > 0 ? wrapped.slice(0, maxLines) : wrapped
  lines.forEach((line, index) => addPdfText(page, line, { x, top: top + (index * lineHeight), size, colour, bold }))
  return lines.length * lineHeight
}

function hasEmbeddedPdfLogo(branding = {}) {
  return /^data:image\/jpe?g;base64,/.test(String(branding.clubLogoData ?? ''))
    && Number(branding.logoWidth) > 0
    && Number(branding.logoHeight) > 0
}

function addPdfHeader(page, branding, continuation = false) {
  const primary = branding.primaryColour
  const primaryText = getPdfContrastText(primary)
  addPdfRect(page, { x: 0, top: 0, width: PDF_PAGE_WIDTH, height: 98, fill: primary })
  addPdfRect(page, { x: PDF_MARGIN, top: 19, width: 60, height: 60, fill: '#ffffff', radius: 8 })
  if (hasEmbeddedPdfLogo(branding)) {
    const imageY = PDF_PAGE_HEIGHT - 73
    page.commands.push('q', `50 0 0 50 ${PDF_MARGIN + 5} ${imageY} cm`, '/Im1 Do', 'Q')
  } else {
    addPdfText(page, branding.clubInitials, {
      x: PDF_MARGIN,
      top: 37,
      width: 60,
      align: 'center',
      bold: true,
      colour: primary,
      size: 15,
    })
  }
  addWrappedPdfText(page, branding.clubName, {
    x: 118,
    top: 23,
    width: 340,
    size: 16,
    lineHeight: 18,
    bold: true,
    colour: primaryText,
    maxLines: 2,
  })
  addPdfText(page, continuation ? 'Completed Match Report | Continued' : 'Completed Match Report', {
    x: 118,
    top: 64,
    size: 10,
    colour: primaryText,
    bold: true,
  })
  if (branding.teamName) {
    addPdfText(page, branding.teamName, {
      x: 460,
      top: 39,
      width: 92,
      align: 'right',
      size: 9,
      colour: primaryText,
      bold: true,
    })
  }
}

function createPdfPage(branding, continuation = false) {
  const page = { commands: [] }
  addPdfHeader(page, branding, continuation)
  return page
}

function createPdfLayout(branding) {
  const pages = [createPdfPage(branding, false)]
  return {
    branding,
    pages,
    page: pages[0],
    cursor: 116,
  }
}

function startNextPdfPage(layout) {
  const page = createPdfPage(layout.branding, true)
  layout.pages.push(page)
  layout.page = page
  layout.cursor = 116
}

function ensurePdfSpace(layout, requiredHeight) {
  if (layout.cursor + requiredHeight <= PDF_PAGE_HEIGHT - PDF_CONTENT_BOTTOM) return false
  startNextPdfPage(layout)
  return true
}

function addPdfScoreboard(layout, model) {
  const { page, branding } = layout
  const extras = [
    model.result.hasExtraTime ? `Normal time score: ${model.result.regulationScore}` : '',
    model.result.extraTimeScore ? `After extra time: ${model.result.extraTimeScore}` : '',
    model.result.shootoutScore ? `Penalty shootout: ${model.result.shootoutScore}` : '',
    model.result.shootoutWinner ? `Shootout winner: ${model.result.shootoutWinner}` : '',
  ].filter(Boolean)
  const cardHeight = extras.length > 0 ? 218 : 190
  addPdfRect(page, {
    x: PDF_MARGIN,
    top: layout.cursor,
    width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2),
    height: cardHeight,
    fill: branding.secondaryColour,
    stroke: branding.primaryColour,
    lineWidth: 1.2,
    radius: 12,
  })
  addPdfText(page, 'FULL TIME', {
    x: PDF_MARGIN + 18,
    top: layout.cursor + 17,
    size: 9,
    colour: branding.accentTextColour,
    bold: true,
  })
  addPdfText(page, `Fixture: ${model.fixture}`, {
    x: PDF_MARGIN + 104,
    top: layout.cursor + 17,
    width: 388,
    align: 'right',
    size: 9,
    colour: '#4b5f55',
    bold: true,
  })
  addWrappedPdfText(page, model.teamNames.home, {
    x: PDF_MARGIN + 18,
    top: layout.cursor + 49,
    width: 150,
    size: 16,
    lineHeight: 18,
    bold: true,
    colour: '#101828',
    maxLines: 2,
  })
  addWrappedPdfText(page, model.teamNames.away, {
    x: PDF_PAGE_WIDTH - PDF_MARGIN - 168,
    top: layout.cursor + 49,
    width: 150,
    size: 16,
    lineHeight: 18,
    bold: true,
    colour: '#101828',
    maxLines: 2,
  })
  addPdfText(page, `${model.score.home} - ${model.score.away}`, {
    x: (PDF_PAGE_WIDTH / 2) - 82,
    top: layout.cursor + 47,
    width: 164,
    align: 'center',
    size: 34,
    colour: branding.primaryColour,
    bold: true,
  })
  addPdfText(page, model.matchDate, {
    x: PDF_MARGIN + 18,
    top: layout.cursor + 96,
    width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2) - 36,
    align: 'center',
    size: 10,
    colour: '#4b5f55',
    bold: true,
  })
  if (model.venue) {
    addWrappedPdfText(page, model.venue, {
      x: PDF_MARGIN + 36,
      top: layout.cursor + 113,
      width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2) - 72,
      size: 9,
      lineHeight: 11,
      colour: '#4b5f55',
      maxLines: 2,
    })
  }
  const scoreTop = layout.cursor + 140
  const scoreCardWidth = 222
  addPdfRect(page, { x: PDF_MARGIN + 18, top: scoreTop, width: scoreCardWidth, height: 34, fill: '#ffffff', radius: 7 })
  addPdfRect(page, { x: PDF_MARGIN + 253, top: scoreTop, width: scoreCardWidth, height: 34, fill: '#ffffff', radius: 7 })
  addPdfText(page, `Half time score: ${model.result.halfTimeScore}`, {
    x: PDF_MARGIN + 18,
    top: scoreTop + 11,
    width: scoreCardWidth,
    align: 'center',
    size: 9,
    colour: '#101828',
    bold: true,
  })
  addPdfText(page, `Full time score: ${model.result.fullTimeScore}`, {
    x: PDF_MARGIN + 253,
    top: scoreTop + 11,
    width: scoreCardWidth,
    align: 'center',
    size: 9,
    colour: '#101828',
    bold: true,
  })
  extras.forEach((text, index) => addPdfText(page, text, {
    x: PDF_MARGIN + 18,
    top: layout.cursor + 184 + (index * 12),
    width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2) - 36,
    align: index % 2 === 0 ? 'left' : 'right',
    size: 8,
    colour: '#4b5f55',
    bold: true,
  }))
  layout.cursor += cardHeight + 14
}

function addPdfMetrics(layout, metrics) {
  ensurePdfSpace(layout, 68)
  const gap = 8
  const totalWidth = PDF_PAGE_WIDTH - (PDF_MARGIN * 2)
  const cardWidth = (totalWidth - (gap * 3)) / 4
  metrics.forEach((metric, index) => {
    const x = PDF_MARGIN + (index * (cardWidth + gap))
    addPdfRect(layout.page, { x, top: layout.cursor, width: cardWidth, height: 58, fill: '#ffffff', stroke: '#d7e5dc', radius: 8 })
    addPdfText(layout.page, metric.value, { x, top: layout.cursor + 10, width: cardWidth, align: 'center', size: 19, bold: true, colour: layout.branding.primaryColour })
    addPdfText(layout.page, metric.label, { x, top: layout.cursor + 36, width: cardWidth, align: 'center', size: 8, bold: true, colour: '#4b5f55' })
  })
  layout.cursor += 72
}

function addPdfSectionTitle(layout, title, count, continued = false) {
  ensurePdfSpace(layout, 42)
  addPdfRect(layout.page, {
    x: PDF_MARGIN,
    top: layout.cursor,
    width: 5,
    height: 27,
    fill: layout.branding.primaryColour,
    radius: 2,
  })
  addPdfText(layout.page, continued ? `${title} | Continued` : title, {
    x: PDF_MARGIN + 15,
    top: layout.cursor + 4,
    size: 14,
    bold: true,
    colour: '#101828',
  })
  addPdfText(layout.page, `${count} ${count === 1 ? 'item' : 'items'}`, {
    x: PDF_PAGE_WIDTH - PDF_MARGIN - 100,
    top: layout.cursor + 6,
    width: 100,
    align: 'right',
    size: 8,
    bold: true,
    colour: layout.branding.primaryColour,
  })
  layout.cursor += 36
}

function getPdfEventRowHeight(item) {
  const detailLines = wrapText(item.detail, 68).filter(Boolean).length
  const notesLines = wrapText(item.notes, 68).filter(Boolean).length
  return 48 + (detailLines * 12) + (notesLines * 12)
}

function addPdfEventRow(layout, item, sectionTitle, sectionCount) {
  const height = getPdfEventRowHeight(item)
  if (ensurePdfSpace(layout, height + 8)) addPdfSectionTitle(layout, sectionTitle, sectionCount, true)
  addPdfRect(layout.page, {
    x: PDF_MARGIN,
    top: layout.cursor,
    width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2),
    height,
    fill: '#ffffff',
    stroke: '#d7e5dc',
    radius: 8,
  })
  addPdfRect(layout.page, { x: PDF_MARGIN, top: layout.cursor, width: 5, height, fill: item.tone, radius: 2 })
  addPdfRect(layout.page, { x: PDF_MARGIN + 15, top: layout.cursor + 13, width: 58, height: 24, fill: layout.branding.secondaryColour, radius: 6 })
  addPdfText(layout.page, item.minute, {
    x: PDF_MARGIN + 15,
    top: layout.cursor + 21,
    width: 58,
    align: 'center',
    size: 8,
    bold: true,
    colour: layout.branding.accentTextColour,
  })
  addPdfText(layout.page, item.title, { x: PDF_MARGIN + 88, top: layout.cursor + 11, size: 11, bold: true, colour: '#101828' })
  addPdfText(layout.page, item.team, { x: PDF_MARGIN + 88, top: layout.cursor + 28, size: 8, bold: true, colour: item.tone })
  if (item.score) {
    addPdfText(layout.page, `Score ${item.score}`, {
      x: PDF_PAGE_WIDTH - PDF_MARGIN - 92,
      top: layout.cursor + 13,
      width: 78,
      align: 'right',
      size: 8,
      bold: true,
      colour: '#4b5f55',
    })
  }
  let detailTop = layout.cursor + 47
  if (item.detail) {
    detailTop += addWrappedPdfText(layout.page, item.detail, {
      x: PDF_MARGIN + 88,
      top: detailTop,
      width: PDF_PAGE_WIDTH - PDF_MARGIN - (PDF_MARGIN + 102),
      size: 9,
      lineHeight: 12,
      colour: '#4b5f55',
    })
  }
  if (item.notes) {
    addWrappedPdfText(layout.page, `Coach note: ${item.notes}`, {
      x: PDF_MARGIN + 88,
      top: detailTop,
      width: PDF_PAGE_WIDTH - PDF_MARGIN - (PDF_MARGIN + 102),
      size: 9,
      lineHeight: 12,
      colour: '#4b5f55',
      bold: true,
    })
  }
  layout.cursor += height + 8
}

function addPdfReportSection(layout, section) {
  addPdfSectionTitle(layout, section.title, section.items.length)
  if (section.items.length === 0) {
    ensurePdfSpace(layout, 44)
    addPdfRect(layout.page, {
      x: PDF_MARGIN,
      top: layout.cursor,
      width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2),
      height: 38,
      fill: '#f7faf8',
      stroke: '#d7e5dc',
      radius: 8,
    })
    addPdfText(layout.page, section.emptyLabel, { x: PDF_MARGIN + 15, top: layout.cursor + 13, size: 9, colour: '#4b5f55', bold: true })
    layout.cursor += 50
    return
  }
  section.items.forEach((item) => addPdfEventRow(layout, item, section.title, section.items.length))
  layout.cursor += 8
}

function addPdfCoachNotes(layout, notes) {
  if (!notes) return
  const noteLines = wrapText(notes, 78)
  const height = 48 + (noteLines.length * 13)
  ensurePdfSpace(layout, height + 40)
  addPdfSectionTitle(layout, 'Coach notes', 1)
  addPdfRect(layout.page, {
    x: PDF_MARGIN,
    top: layout.cursor,
    width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2),
    height,
    fill: layout.branding.secondaryColour,
    stroke: layout.branding.primaryColour,
    radius: 8,
  })
  addWrappedPdfText(layout.page, notes, {
    x: PDF_MARGIN + 16,
    top: layout.cursor + 16,
    width: PDF_PAGE_WIDTH - (PDF_MARGIN * 2) - 32,
    size: 10,
    lineHeight: 13,
    colour: '#101828',
  })
  layout.cursor += height + 10
}

function buildPdfPages(model) {
  const layout = createPdfLayout(model.branding)
  addPdfScoreboard(layout, model)
  addPdfMetrics(layout, model.metrics)
  model.sections.forEach((section) => addPdfReportSection(layout, section))
  addPdfCoachNotes(layout, model.staffNotes)
  return layout.pages
}

function getLogoBytes(branding = {}) {
  if (!hasEmbeddedPdfLogo(branding)) return null
  const encoded = String(branding.clubLogoData).split(',')[1] || ''
  if (!encoded || typeof globalThis.atob !== 'function') return null
  const decoded = globalThis.atob(encoded)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

export function buildCompletedReportBranding(match = {}, override = {}) {
  const fallback = createPdfBrandingFallback({
    clubName: getClubName(match),
    teamName: firstText(match.teamName, match.team_name, match.teams?.name),
  }, getMatchDate(match))
  const themeAccent = firstText(match.themeAccent, match.theme_accent, match.clubAccent, match.club_accent) || 'green'
  const tokens = createThemeColorTokens(themeAccent, 'light')
  const clubLogoData = firstText(override.clubLogoData, match.clubLogoData, match.club_logo_data)

  return validatePdfBranding({
    ...fallback,
    clubLogoData,
    logoWidth: Number(override.logoWidth ?? match.logoWidth ?? match.logo_width ?? 0),
    logoHeight: Number(override.logoHeight ?? match.logoHeight ?? match.logo_height ?? 0),
    brandingSource: clubLogoData ? PDF_BRANDING_SOURCES.clubLogo : fallback.brandingSource,
    fallbackReason: clubLogoData ? '' : fallback.fallbackReason,
    primaryColour: tokens.buttonPrimary,
    secondaryColour: tokens.accentSoft,
    accentTextColour: tokens.textSecondary,
  }, {
    context: {
      clubName: getClubName(match),
      teamName: firstText(match.teamName, match.team_name, match.teams?.name),
    },
    generatedDate: getMatchDate(match),
  })
}

function buildPdfPageStream(page, { branding, pageCount, pageNumber }) {
  const commands = [...page.commands]
  commands.push(
    'q',
    `${pdfColour(branding.primaryColour)} RG`,
    '0.8 w',
    `${PDF_MARGIN} 42 m ${PDF_PAGE_WIDTH - PDF_MARGIN} 42 l S`,
    'Q',
    'BT',
    '/F1 8 Tf',
    '0.294 0.373 0.333 rg',
    `1 0 0 1 ${PDF_MARGIN} 25 Tm`,
    `(${escapePdfLiteral(branding.platformAttribution)}) Tj`,
    `1 0 0 1 ${PDF_PAGE_WIDTH - 160} 25 Tm`,
    `(${escapePdfLiteral(`${branding.confidentialityLabel} | Page ${pageNumber} of ${pageCount}`)}) Tj`,
    'ET',
  )
  return textBytes(commands.join('\n'))
}

export function buildCompletedReportPdf(match = {}, options = {}) {
  const branding = buildCompletedReportBranding(match, options.branding)
  const model = buildPdfReportModel(match, { ...options, branding })
  const pages = buildPdfPages(model)
  const logoBytes = getLogoBytes(branding)

  const fontRegularId = 3 + pages.length * 2
  const fontBoldId = fontRegularId + 1
  const imageId = logoBytes ? fontBoldId + 1 : 0
  const objectBodies = new Map()
  const pageIds = pages.map((_, index) => 3 + index * 2)
  objectBodies.set(1, textBytes('<< /Type /Catalog /Pages 2 0 R >>'))
  objectBodies.set(2, textBytes(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  pages.forEach((page, index) => {
    const pageId = 3 + index * 2
    const contentId = pageId + 1
    const stream = buildPdfPageStream(page, { branding, pageCount: pages.length, pageNumber: index + 1 })
    const imageResource = imageId ? ` /XObject << /Im1 ${imageId} 0 R >>` : ''
    objectBodies.set(pageId, textBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >>${imageResource} >> /Contents ${contentId} 0 R >>`))
    objectBodies.set(contentId, concatBytes([textBytes(`<< /Length ${stream.length} >>\nstream\n`), stream, textBytes('\nendstream')]))
  })
  objectBodies.set(fontRegularId, textBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  objectBodies.set(fontBoldId, textBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'))
  if (imageId) {
    objectBodies.set(imageId, concatBytes([
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${branding.logoWidth} /Height ${branding.logoHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>\nstream\n`),
      logoBytes,
      textBytes('\nendstream'),
    ]))
  }

  const chunks = [textBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]
  const offsets = [0]
  let byteOffset = chunks[0].length
  const objectCount = imageId || fontBoldId
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

function loadPdfLogoImage(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The club badge could not be prepared for the PDF.'))
    image.src = objectUrl
  })
}

async function resolveBrowserPdfBranding(match = {}) {
  const logoUrl = firstText(match.clubLogoUrl, match.club_logo_url)
  if (!logoUrl || typeof document === 'undefined' || typeof fetch !== 'function' || typeof Image === 'undefined') {
    return {}
  }

  let objectUrl = ''
  try {
    const response = await fetch(logoUrl, { credentials: 'omit' })
    if (!response.ok) return {}
    const blob = await response.blob()
    objectUrl = window.URL.createObjectURL(blob)
    const image = await loadPdfLogoImage(objectUrl)
    const canvas = document.createElement('canvas')
    const outputSize = 256
    canvas.width = outputSize
    canvas.height = outputSize
    const context = canvas.getContext('2d')
    if (!context) return {}
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, outputSize, outputSize)
    const scale = Math.min(outputSize / image.naturalWidth, outputSize / image.naturalHeight)
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    context.drawImage(image, Math.round((outputSize - width) / 2), Math.round((outputSize - height) / 2), width, height)
    return {
      clubLogoData: canvas.toDataURL('image/jpeg', 0.92),
      logoWidth: outputSize,
      logoHeight: outputSize,
    }
  } catch {
    return {}
  } finally {
    if (objectUrl) window.URL.revokeObjectURL(objectUrl)
  }
}

export async function downloadCompletedReportPdf(match = {}, options = {}) {
  const branding = await resolveBrowserPdfBranding(match)
  const bytes = buildCompletedReportPdf(match, { ...options, branding })
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
