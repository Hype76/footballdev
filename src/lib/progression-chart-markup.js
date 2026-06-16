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

  const summary = getProgressionChartSummary(chartPoints)

  if (imageSrc) {
    return `
      <div style="margin: 10px 0 0; border: 1px solid #e7ece3; border-radius: 10px; background: #ffffff; padding: 10px;">
        <img src="${escapeHtml(imageSrc)}" alt="Progression score chart out of 10" width="360" style="display: block; width: 100%; max-width: 360px; height: auto;" />
        <p style="margin: 8px 0 0; color: #4f6552; font-size: 12px; line-height: 1.45;">${escapeHtml(summary)}</p>
      </div>
    `
  }

  const width = 360
  const height = 120
  const padding = 18
  const coordinates = getProgressionCoordinates(chartPoints, width, height, padding)
  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')

  return `
    <div style="margin: 10px 0 0; border: 1px solid #e7ece3; border-radius: 10px; background: #ffffff; padding: 10px;">
      <svg width="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="Progression score chart out of 10" style="display: block;">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#d7e5dc" stroke-width="2" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#d7e5dc" stroke-width="2" />
        <path d="${linePath}" fill="none" stroke="#047857" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        ${coordinates.map((point) => `
          <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" fill="#ccff00" stroke="#047857" stroke-width="2" />
        `).join('')}
      </svg>
      <p style="margin: 8px 0 0; color: #4f6552; font-size: 12px; line-height: 1.45;">${escapeHtml(summary)}</p>
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
