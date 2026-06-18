function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeChartPoints(points = []) {
  return Array.isArray(points)
    ? points
        .map((point) => ({
          label: String(point?.label ?? '').trim() || 'Record',
          value: Number(point?.value ?? 0),
        }))
        .filter((point) => Number.isFinite(point.value))
    : []
}

function formatAxisLabel(label) {
  const normalizedLabel = String(label ?? '').trim()
  const dateLabel = normalizedLabel.match(/^(\d{1,2} [A-Z][a-z]{2}) \d{4}( #\d+)?$/)

  if (dateLabel) {
    return `${dateLabel[1]}${dateLabel[2] || ''}`
  }

  return normalizedLabel
}

export function getProgressionChartSummary(points = []) {
  return normalizeChartPoints(points)
    .map((point) => `${point.label}: ${point.value.toFixed(1)} / 10`)
    .join(' | ')
}

function getProgressionCoordinates(points, width, height, padding) {
  const maxValue = 10
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2

  return points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : padding + (index / (points.length - 1)) * innerWidth
    const value = Math.min(maxValue, Math.max(0, point.value))
    const y = padding + innerHeight - (value / maxValue) * innerHeight
    return { ...point, x, y }
  })
}

export function buildProgressionChartMarkup(points = [], { imageSrc = '' } = {}) {
  const chartPoints = normalizeChartPoints(points)

  if (chartPoints.length < 2) {
    return ''
  }

  if (imageSrc) {
    return `
      <div style="margin: 10px 0 0; border: 1px solid #d7e5dc; border-radius: 12px; background: #ffffff; padding: 12px;">
        <img src="${escapeHtml(imageSrc)}" alt="Progression score chart out of 10" width="640" style="display: block; width: 100%; max-width: 640px; height: auto;" />
      </div>
    `
  }

  const width = 640
  const height = 220
  const padding = 42
  const coordinates = getProgressionCoordinates(chartPoints, width, height, padding)
  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const gridValues = [0, 5, 10]

  return `
    <div style="margin: 10px 0 0; border: 1px solid #d7e5dc; border-radius: 12px; background: #ffffff; padding: 12px;">
      <svg width="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="Progression score chart out of 10" style="display: block;">
        <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#fbfcf9" />
        ${gridValues.map((value) => {
          const y = padding + (height - padding * 2) - (value / 10) * (height - padding * 2)
          return `
            <line x1="${padding}" y1="${y.toFixed(1)}" x2="${width - padding}" y2="${y.toFixed(1)}" stroke="#d7e5dc" stroke-width="1" />
            <text x="${padding - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#4f6552">${value}</text>
          `
        }).join('')}
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#9fc5ad" stroke-width="2" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#9fc5ad" stroke-width="2" />
        <path d="${linePath}" fill="none" stroke="#047857" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        ${coordinates.map((point) => `
          <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6" fill="#ccff00" stroke="#047857" stroke-width="2" />
          <text x="${point.x.toFixed(1)}" y="${Math.max(padding - 8, point.y - 12).toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="800" fill="#101828">${escapeHtml(point.value.toFixed(1))}</text>
          <text x="${point.x.toFixed(1)}" y="${height - 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#4f6552">${escapeHtml(formatAxisLabel(point.label))}</text>
        `).join('')}
      </svg>
    </div>
  `
}

export function buildProgressionChartImageHtml(points = []) {
  const chartPoints = normalizeChartPoints(points)

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html,
          body {
            margin: 0;
            background: #ffffff;
          }
          body {
            width: 760px;
            min-height: 240px;
            font-family: Arial, sans-serif;
          }
          .chart {
            box-sizing: border-box;
            width: 760px;
            min-height: 240px;
            padding: 20px;
            background: #ffffff;
          }
        </style>
      </head>
      <body>
        <div class="chart">
          ${buildProgressionChartMarkup(chartPoints)}
        </div>
      </body>
    </html>
  `
}
