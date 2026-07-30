export const DEVELOPMENT_PDF_FILENAME_MAX_LENGTH = 180

const PDF_EXTENSION = '.pdf'
const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*]+/g

function normalizeFilenamePart(value, fallback) {
  const withoutControlCharacters = Array.from(String(value ?? ''))
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
  const normalized = withoutControlCharacters
    .normalize('NFC')
    .replace(INVALID_FILENAME_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/g, '')

  return normalized || fallback
}

function getUtf8Length(value) {
  return new TextEncoder().encode(value).length
}

function shorten(value, maxBytes) {
  const characters = Array.from(value)

  if (getUtf8Length(value) <= maxBytes) {
    return value
  }

  let shortened = ''

  for (const character of characters) {
    if (getUtf8Length(shortened + character) > maxBytes) {
      break
    }

    shortened += character
  }

  return shortened.trim().replace(/[.\s]+$/g, '')
}

function formatSnapshotDate(value) {
  const normalizedValue = String(value ?? '').trim()
  const dateOnlyMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (dateOnlyMatch) {
    return `${dateOnlyMatch[3]}-${dateOnlyMatch[2]}-${dateOnlyMatch[1].slice(-2)}`
  }

  const parsedDate = new Date(normalizedValue)

  if (normalizedValue && !Number.isNaN(parsedDate.getTime())) {
    return [
      String(parsedDate.getUTCDate()).padStart(2, '0'),
      String(parsedDate.getUTCMonth() + 1).padStart(2, '0'),
      String(parsedDate.getUTCFullYear()).slice(-2),
    ].join('-')
  }

  return 'Date not recorded'
}

export function buildDevelopmentPdfFilename(reportSnapshot = {}) {
  const playerName = normalizeFilenamePart(
    reportSnapshot.player?.name ?? reportSnapshot.playerName,
    'Player',
  )
  const teamName = normalizeFilenamePart(
    reportSnapshot.team?.name ?? reportSnapshot.teamName,
    'Team',
  )
  const reportDate = formatSnapshotDate(
    reportSnapshot.recordDate
      ?? reportSnapshot.reportDate
      ?? reportSnapshot.finalizedAt,
  )
  const separatorsLength = ' -  - '.length
  const fixedLength = separatorsLength + getUtf8Length(reportDate) + PDF_EXTENSION.length
  const availableNameLength = DEVELOPMENT_PDF_FILENAME_MAX_LENGTH - fixedLength
  const teamLimit = Math.min(72, Math.max(8, Math.floor(availableNameLength * 0.44)))
  const safeTeamName = shorten(teamName, teamLimit)
  const playerLimit = Math.max(8, availableNameLength - getUtf8Length(safeTeamName))
  const safePlayerName = shorten(playerName, playerLimit)

  return `${safePlayerName} - ${reportDate} - ${safeTeamName}${PDF_EXTENSION}`
}

export function buildDevelopmentPdfContentDisposition(filename) {
  const requestedFilename = normalizeFilenamePart(filename, 'Development report.pdf')
  const withoutExtension = requestedFilename.replace(/\.pdf$/i, '')
  const canonicalFilename = `${shorten(
    withoutExtension,
    DEVELOPMENT_PDF_FILENAME_MAX_LENGTH - PDF_EXTENSION.length,
  )}${PDF_EXTENSION}`
  const asciiFallback = canonicalFilename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Development report.pdf'
  const encodedFilename = encodeURIComponent(canonicalFilename)
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`
}
