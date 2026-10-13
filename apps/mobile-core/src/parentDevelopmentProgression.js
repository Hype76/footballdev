import { getParentProductDateTimeParts } from './parentDateTimeCore.js'

const text = value => String(value ?? '').trim()
const scopeKey = report => JSON.stringify([report.club?.id || '', report.team?.id || '', report.player?.id || ''])
const formKey = report => {
  const form = report.form || {}
  const id = text(form.progressionId || form.id)
  if (id) return `id:${id}`
  if (form.templateKey) return `template:${form.templateKey}:${form.version || ''}`
  return form.name ? `legacy:${form.name}:${form.version || ''}` : ''
}

export function formatParentProgressionLabel(value) {
  const label = text(value)
  const match = label.match(/^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})( #\d+)?$/)
  if (!match) return label
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[2]) + 1
  return `${match[1].padStart(2, '0')}:${String(month).padStart(2, '0')}:${match[3]}${match[4] || ''}`
}

export function normalizeParentProgressionPoints(points) {
  return (Array.isArray(points) ? points : []).flatMap(point => {
    if (!text(point?.label) || point.value === null || point.value === undefined || point.value === '') return []
    const value = Number(point.value)
    return Number.isFinite(value) && value >= 0 && value <= 10 ? [{ label: formatParentProgressionLabel(point.label), value }] : []
  })
}

function sharedScore(report) {
  const scores = (report.responseItems || []).filter(item => item.numericScore !== null && item.numericScore !== undefined && item.numericScore !== '' && Number.isFinite(Number(item.numericScore)))
  const eligible = scores.filter(item => item.includeInProgressChart === true && Number(item.maxScore || 10) > 0 && Number(item.numericScore) > 0 && Number(item.numericScore) <= Number(item.maxScore || 10))
  if (!eligible.length) return null
  const overall = Number(report.overallScore), maximum = Number(report.overallMaxScore || 10)
  if (eligible.length === scores.length && new Set(scores.map(item => Number(item.maxScore || 10))).size === 1 && report.overallScore !== null && report.overallScore !== undefined && report.overallScore !== '' && overall > 0 && maximum > 0 && overall <= maximum) return overall * 10 / maximum
  return eligible.reduce((sum, item) => sum + Number(item.numericScore) * 10 / Number(item.maxScore || 10), 0) / eligible.length
}

export function getParentDevelopmentProgression(report, reports = []) {
  if (!report || report.progressionAllowed === false) return null
  const own = normalizeParentProgressionPoints(report.sections?.find(section => section.key === 'progressionChart')?.chartPoints)
  if (report.progressionAllowed !== true) return own.length >= 2 ? { points: own, source: 'report' } : null
  const key = formKey(report)
  if (!key) return null
  const matching = [...new Map(reports.filter(candidate => text(candidate.id) && candidate.progressionAllowed === true && formKey(candidate) === key && scopeKey(candidate) === scopeKey(report)).map(candidate => [candidate.id, candidate])).values()]
  const scored = matching.flatMap(candidate => {
    const value = sharedScore(candidate)
    const date = getParentProductDateTimeParts(candidate.recordDate || candidate.finalizedAt).date
    return value === null || !date ? [] : [{ id: candidate.id, date, savedAt: Date.parse(candidate.finalizedAt) || 0, value }]
  }).sort((a, b) => a.date.localeCompare(b.date) || a.savedAt - b.savedAt || text(a.id).localeCompare(text(b.id)))
  if (scored.length >= 2) {
    const counts = new Map(), positions = new Map()
    for (const point of scored) counts.set(point.date, (counts.get(point.date) || 0) + 1)
    return { source: 'shared_history', points: scored.map(point => {
      const position = (positions.get(point.date) || 0) + 1
      positions.set(point.date, position)
      const [year, month, day] = point.date.split('-')
      return { label: `${day}:${month}:${year}${counts.get(point.date) > 1 ? ` #${position}` : ''}`, value: Math.round(point.value * 10) / 10 }
    }) }
  }
  return own.length >= 2 ? { points: own, source: 'report' } : null
}

export function getParentProgressionPlot(points, availableWidth) {
  const width = Math.max(Number(availableWidth) || 280, 44 * points.length + 36)
  const height = 144, left = 24, top = 28, padding = 22
  const positions = points.map((point, index) => ({ ...point, x: left + padding + index * (width - left - 2 * padding) / Math.max(1, points.length - 1), y: top + height * (1 - point.value / 10) }))
  const segments = positions.slice(1).map((point, index) => {
    const start = positions[index], dx = point.x - start.x, dy = point.y - start.y, length = Math.hypot(dx, dy)
    return { left: (start.x + point.x) / 2 - length / 2, top: (start.y + point.y) / 2 - 1, width: length, rotation: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }
  })
  return { width, height, top, positions, segments }
}
