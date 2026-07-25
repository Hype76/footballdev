import { Buffer } from 'node:buffer'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { DATA_TRANSFER_FORMATS } from '../../../src/lib/data-transfer-formats.js'

export const ORDINARY_EXPORT_VERSION = 'FP-V1-READABLE-EXPORT-1'

export const ORDINARY_EXPORT_FORMATS = Object.freeze({
  csv: Object.freeze({ ...DATA_TRANSFER_FORMATS.csv, label: 'CSV' }),
  xlsx: Object.freeze({ ...DATA_TRANSFER_FORMATS.xlsx, label: 'Excel' }),
  ods: Object.freeze({ ...DATA_TRANSFER_FORMATS.ods, label: 'OpenDocument' }),
})

const PLAYER_COLUMNS = [
  { key: 'player_first_name', heading: 'Player First Name', width: 20 },
  { key: 'player_last_name', heading: 'Player Last Name', width: 20 },
  { key: 'preferred_name', heading: 'Preferred Name', width: 18 },
  { key: 'date_of_birth', heading: 'Date of Birth', type: 'date', width: 16 },
  { key: 'team_name', heading: 'Team', width: 24 },
  { key: 'season', heading: 'Season', width: 14 },
  { key: 'gender', heading: 'Gender', width: 16 },
  { key: 'section', heading: 'Section', width: 14 },
  { key: 'shirt_number', heading: 'Shirt Number', width: 14 },
  { key: 'positions', heading: 'Positions', width: 24 },
  { key: 'status', heading: 'Status', width: 14 },
]

const GUARDIAN_COLUMNS = [1, 2].flatMap((number) => [
  { key: `guardian${number}_first_name`, heading: `Parent or Guardian ${number} First Name`, width: 22 },
  { key: `guardian${number}_last_name`, heading: `Parent or Guardian ${number} Last Name`, width: 22 },
  { key: `guardian${number}_email`, heading: `Parent or Guardian ${number} Email`, width: 32 },
  { key: `guardian${number}_phone`, heading: `Parent or Guardian ${number} Phone`, width: 22 },
  { key: `guardian${number}_relationship`, heading: `Parent or Guardian ${number} Relationship`, width: 22 },
  { key: `guardian${number}_primary_contact`, heading: `Parent or Guardian ${number} Primary Contact`, width: 20 },
  { key: `guardian${number}_receives_communications`, heading: `Parent or Guardian ${number} Receives Communications`, width: 24 },
  { key: `guardian${number}_emergency_contact`, heading: `Parent or Guardian ${number} Emergency Contact`, width: 22 },
])

export const ORDINARY_EXPORT_DATASETS = Object.freeze({
  players: {
    filename: 'footballplayer-online-players',
    label: 'Players',
    sheetName: 'Players',
    columns: PLAYER_COLUMNS,
  },
  players_and_guardians: {
    filename: 'footballplayer-online-players-and-parents',
    label: 'Players and parent contacts',
    sheetName: 'Players and Parents',
    columns: [
      ...PLAYER_COLUMNS,
      ...GUARDIAN_COLUMNS,
      { key: 'additional_guardian_contacts', heading: 'Additional Parent or Guardian Contacts', width: 54 },
    ],
  },
  teams: {
    filename: 'footballplayer-online-teams',
    label: 'Teams',
    sheetName: 'Teams',
    columns: [
      { key: 'team_name', heading: 'Team Name', width: 24 },
      { key: 'age_group', heading: 'Age Group', width: 14 },
      { key: 'category', heading: 'Category', width: 16 },
      { key: 'season', heading: 'Season', width: 14 },
      { key: 'league', heading: 'League', width: 22 },
      { key: 'division', heading: 'Division', width: 18 },
      { key: 'home_ground', heading: 'Home Ground', width: 28 },
      { key: 'training_day', heading: 'Training Day', width: 16 },
      { key: 'training_time', heading: 'Training Time', width: 16 },
      { key: 'status', heading: 'Status', width: 14 },
    ],
  },
})

function exportError(message, code) {
  return Object.assign(new Error(message), { code })
}

function normalizeText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (Array.isArray(value)) return value.map((entry) => normalizeText(entry)).filter(Boolean).join(', ')
  return String(value ?? '').trim()
}

export function safeOrdinaryExportText(value) {
  const normalized = normalizeText(value)
  return /^(?:[\t\r]|\s*[=+\-@])/.test(normalized) ? `'${normalized}` : normalized
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function normalizeStatus(value) {
  const normalized = normalizeText(value).toLowerCase()
  return normalized || 'active'
}

function normalizeBoolean(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  const normalized = normalizeText(value).toLowerCase()
  if (['true', 'yes', '1'].includes(normalized)) return 'Yes'
  if (['false', 'no', '0'].includes(normalized)) return 'No'
  return ''
}

function normalizeDate(value) {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString().slice(0, 10)
}

function compareText(left, right) {
  return normalizeText(left).localeCompare(normalizeText(right), 'en-GB', { sensitivity: 'base', numeric: true })
}

function selectScopedEntities(existing, scope) {
  const authorizedTeamIds = new Set((scope.authorizedTeamIds || []).map(normalizeText).filter(Boolean))
  const clubWide = scope.isClubWideScope === true
  const requestedClubId = normalizeText(scope.clubId)
  const teams = (existing.teams || []).filter((team) => {
    if (requestedClubId && normalizeText(team.club_id) && normalizeText(team.club_id) !== requestedClubId) return false
    return clubWide || authorizedTeamIds.has(normalizeText(team.id))
  })
  const teamIds = new Set(teams.map((team) => normalizeText(team.id)))
  const players = (existing.players || []).filter((player) => {
    if (requestedClubId && normalizeText(player.club_id) && normalizeText(player.club_id) !== requestedClubId) return false
    return teamIds.has(normalizeText(player.team_id))
  })
  const playerIds = new Set(players.map((player) => normalizeText(player.id)))
  const links = (existing.links || []).filter((link) => {
    if (requestedClubId && normalizeText(link.club_id) && normalizeText(link.club_id) !== requestedClubId) return false
    return playerIds.has(normalizeText(link.player_id)) && (!normalizeText(link.team_id) || teamIds.has(normalizeText(link.team_id)))
  })
  const guardianIds = new Set(links.map((link) => normalizeText(link.guardian_id)).filter(Boolean))
  const guardians = (existing.guardians || []).filter((guardian) => {
    if (requestedClubId && normalizeText(guardian.club_id) && normalizeText(guardian.club_id) !== requestedClubId) return false
    return guardianIds.has(normalizeText(guardian.id))
  })
  return { guardians, links, players, teams }
}

function filterTeamsBySeason(teams, season, clubSeason) {
  if (season === 'all') return teams
  return teams.filter((team) => normalizeText(team.season || clubSeason) === season)
}

function filterByStatus(rows, status) {
  if (status === 'all') return rows
  return rows.filter((row) => normalizeStatus(row.status) === status)
}

function playerRow(player, team, clubSeason = '') {
  return {
    player_first_name: normalizeText(player.first_name),
    player_last_name: normalizeText(player.last_name),
    preferred_name: normalizeText(player.preferred_name),
    date_of_birth: normalizeDate(player.date_of_birth),
    team_name: normalizeText(team?.name || player.team),
    season: normalizeText(team?.season || clubSeason),
    gender: normalizeText(player.gender),
    section: normalizeText(player.section),
    shirt_number: normalizeText(player.shirt_number),
    positions: normalizeText(player.positions),
    status: normalizeStatus(player.status),
  }
}

function guardianFields(guardian, link, number) {
  return {
    [`guardian${number}_first_name`]: normalizeText(guardian?.first_name),
    [`guardian${number}_last_name`]: normalizeText(guardian?.last_name),
    [`guardian${number}_email`]: normalizeText(guardian?.email || link?.email).toLowerCase(),
    [`guardian${number}_phone`]: normalizeText(guardian?.phone),
    [`guardian${number}_relationship`]: normalizeText(link?.relationship),
    [`guardian${number}_primary_contact`]: normalizeBoolean(link?.primary_contact),
    [`guardian${number}_receives_communications`]: normalizeBoolean(link?.receives_communications),
    [`guardian${number}_emergency_contact`]: normalizeBoolean(link?.emergency_contact),
  }
}

export function buildOrdinaryExportRows(existing, {
  dataset,
  includeGuardianContacts = false,
  recordStatus = 'active',
  scope = {},
  season = 'all',
} = {}) {
  const definition = ORDINARY_EXPORT_DATASETS[dataset]
  if (!definition) throw exportError('Choose Players, Players and parent contacts, or Teams.', 'EXPORT_DATASET_UNSUPPORTED')
  if (!['active', 'inactive', 'all'].includes(recordStatus)) throw exportError('Choose active, inactive, or all records.', 'EXPORT_STATUS_UNSUPPORTED')
  const normalizedSeason = normalizeText(season) || 'all'
  if (dataset === 'players_and_guardians' && !includeGuardianContacts) {
    throw exportError('Your role cannot export parent or guardian contact fields.', 'GUARDIAN_EXPORT_DENIED')
  }

  const scoped = selectScopedEntities(existing, scope)
  const clubSeason = normalizeText(existing.club?.season)
  const teams = filterTeamsBySeason(scoped.teams, normalizedSeason, clubSeason)
  const filteredTeams = dataset === 'teams' ? filterByStatus(teams, recordStatus) : teams
  const teamById = new Map(teams.map((team) => [normalizeText(team.id), team]))
  const teamIds = new Set(teams.map((team) => normalizeText(team.id)))
  const players = filterByStatus(scoped.players.filter((player) => teamIds.has(normalizeText(player.team_id))), recordStatus)
    .sort((left, right) => compareText(teamById.get(left.team_id)?.name, teamById.get(right.team_id)?.name)
      || compareText(left.last_name || left.player_name, right.last_name || right.player_name)
      || compareText(left.first_name, right.first_name))

  if (dataset === 'teams') {
    return filteredTeams
      .sort((left, right) => compareText(left.name, right.name))
      .map((team) => ({
        team_name: normalizeText(team.name),
        age_group: normalizeText(team.age_group),
        category: normalizeText(team.category),
        season: normalizeText(team.season || clubSeason),
        league: normalizeText(team.league),
        division: normalizeText(team.division),
        home_ground: normalizeText(team.home_ground),
        training_day: normalizeText(team.training_day),
        training_time: normalizeText(team.training_time),
        status: normalizeStatus(team.status),
      }))
  }

  if (dataset === 'players') return players.map((player) => playerRow(player, teamById.get(normalizeText(player.team_id)), clubSeason))

  const guardianById = new Map(scoped.guardians.map((guardian) => [normalizeText(guardian.id), guardian]))
  const linksByPlayer = new Map()
  for (const link of scoped.links) {
    const playerId = normalizeText(link.player_id)
    const current = linksByPlayer.get(playerId) || []
    current.push(link)
    linksByPlayer.set(playerId, current)
  }
  return players.map((player) => {
    const links = (linksByPlayer.get(normalizeText(player.id)) || [])
      .sort((left, right) => Number(Boolean(right.primary_contact)) - Number(Boolean(left.primary_contact))
        || compareText(guardianById.get(left.guardian_id)?.last_name, guardianById.get(right.guardian_id)?.last_name))
    const additionalGuardianContacts = links.slice(2).map((link) => {
      const guardian = guardianById.get(normalizeText(link.guardian_id))
      return [
        [normalizeText(guardian?.first_name), normalizeText(guardian?.last_name)].filter(Boolean).join(' '),
        normalizeText(link.relationship),
        normalizeText(guardian?.email || link.email).toLowerCase(),
        normalizeText(guardian?.phone),
        normalizeBoolean(link.primary_contact) === 'Yes' ? 'Primary contact' : '',
        normalizeBoolean(link.emergency_contact) === 'Yes' ? 'Emergency contact' : '',
      ].filter(Boolean).join(' | ')
    }).filter(Boolean).join('\n')
    return {
      ...playerRow(player, teamById.get(normalizeText(player.team_id)), clubSeason),
      ...guardianFields(guardianById.get(normalizeText(links[0]?.guardian_id)), links[0], 1),
      ...guardianFields(guardianById.get(normalizeText(links[1]?.guardian_id)), links[1], 2),
      additional_guardian_contacts: additionalGuardianContacts,
    }
  })
}

function quoteCsv(value) {
  const safe = safeOrdinaryExportText(value)
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function buildCsv(definition, rows) {
  const lines = [
    definition.columns.map((column) => quoteCsv(column.heading)).join(','),
    ...rows.map((row) => definition.columns.map((column) => quoteCsv(row[column.key])).join(',')),
  ]
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8')
}

function styleXlsxHeader(row) {
  row.height = 32
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
}

async function buildXlsx(definition, rows) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Football Player'
  workbook.company = 'Jeluma Labs'
  workbook.subject = `Human-readable ${definition.label.toLowerCase()} export`
  workbook.calcProperties.fullCalcOnLoad = false
  const sheet = workbook.addWorksheet(definition.sheetName)
  sheet.addRow(definition.columns.map((column) => column.heading))
  styleXlsxHeader(sheet.getRow(1))
  definition.columns.forEach((column, index) => {
    const target = sheet.getColumn(index + 1)
    target.width = column.width
    target.alignment = { vertical: 'top', wrapText: true }
    if (column.type !== 'date') target.numFmt = '@'
  })
  for (const row of rows) {
    const outputRow = sheet.addRow(definition.columns.map((column) => {
      const value = row[column.key]
      if (column.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value))) {
        return new Date(`${normalizeText(value)}T00:00:00.000Z`)
      }
      return safeOrdinaryExportText(value)
    }))
    definition.columns.forEach((column, index) => {
      const cell = outputRow.getCell(index + 1)
      cell.alignment = { vertical: 'top', wrapText: true }
      if (column.type === 'date' && cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy'
      else cell.numFmt = '@'
    })
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: definition.columns.length } }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function odsCell(column, value, header = false) {
  const normalized = normalizeText(value)
  if (!header && column?.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-')
    return `<table:table-cell table:style-name="DateCell" office:value-type="date" office:date-value="${escapeXml(normalized)}"><text:p>${escapeXml(`${day}/${month}/${year}`)}</text:p></table:table-cell>`
  }
  const style = header ? 'HeaderCell' : 'TextCell'
  return `<table:table-cell table:style-name="${style}" office:value-type="string"><text:p>${escapeXml(header ? normalized : safeOrdinaryExportText(normalized))}</text:p></table:table-cell>`
}

function odsRow(definition, row, header = false) {
  const cells = definition.columns.map((column) => odsCell(column, header ? column.heading : row[column.key], header)).join('')
  return `<table:table-row>${cells}</table:table-row>`
}

async function buildOds(definition, rows) {
  const zip = new JSZip()
  zip.file('mimetype', ORDINARY_EXPORT_FORMATS.ods.storageMimeType, { compression: 'STORE' })
  const columnStyles = definition.columns.map((column, index) => `<style:style style:name="Column${index + 1}" style:family="table-column"><style:table-column-properties style:column-width="${Math.max(1.2, Math.min(3.5, column.width / 12)).toFixed(2)}in"/></style:style>`).join('')
  const columns = definition.columns.map((column, index) => `<table:table-column table:style-name="Column${index + 1}"/>`).join('')
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">
<office:automatic-styles>
${columnStyles}
<style:style style:name="HeaderCell" style:family="table-cell"><style:text-properties fo:font-weight="bold" fo:color="#ffffff"/><style:table-cell-properties fo:background-color="#047857" fo:padding="0.08in"/></style:style>
<style:style style:name="TextCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.06in" fo:wrap-option="wrap"/></style:style>
<style:style style:name="DateCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.06in"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet>
<table:table table:name="${escapeXml(definition.sheetName)}">${columns}${odsRow(definition, {}, true)}${rows.map((row) => odsRow(definition, row)).join('')}</table:table>
</office:spreadsheet></office:body></office:document-content>`
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:styles/></office:document-styles>`
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="${ORDINARY_EXPORT_FORMATS.ods.storageMimeType}"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
  zip.file('content.xml', contentXml)
  zip.file('styles.xml', stylesXml)
  zip.file('META-INF/manifest.xml', manifestXml)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }))
}

export async function buildOrdinaryDataExport({
  dataset,
  existing,
  format,
  includeGuardianContacts = false,
  recordStatus = 'active',
  scope = {},
  season = 'all',
} = {}) {
  const definition = ORDINARY_EXPORT_DATASETS[dataset]
  const formatDefinition = ORDINARY_EXPORT_FORMATS[format]
  if (!definition) throw exportError('Choose Players, Players and parent contacts, or Teams.', 'EXPORT_DATASET_UNSUPPORTED')
  if (!formatDefinition) throw exportError('Choose CSV, Excel, or OpenDocument.', 'EXPORT_FORMAT_UNSUPPORTED')
  const rows = buildOrdinaryExportRows(existing, { dataset, includeGuardianContacts, recordStatus, scope, season })
  const buffer = format === 'csv'
    ? buildCsv(definition, rows)
    : format === 'xlsx'
      ? await buildXlsx(definition, rows)
      : await buildOds(definition, rows)
  return {
    buffer,
    dataset,
    filename: `${definition.filename}${formatDefinition.extension}`,
    format,
    headings: definition.columns.map((column) => column.heading),
    mimeType: formatDefinition.responseMimeType,
    rowCount: rows.length,
    rows,
    sheetName: definition.sheetName,
  }
}
