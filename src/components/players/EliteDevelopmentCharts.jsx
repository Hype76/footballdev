import { useMemo, useState } from 'react'

const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5'
const subPanelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'

function getLinePoints(points = []) {
  const width = 640
  const height = 250
  const left = 48
  const right = 24
  const top = 22
  const bottom = 52
  const innerWidth = width - left - right
  const innerHeight = height - top - bottom

  return points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? left + innerWidth / 2 : left + (index / (points.length - 1)) * innerWidth,
    y: top + innerHeight - (Number(point.value) / 10) * innerHeight,
  }))
}

function ScoreLineChart({ accessibleLabel, points = [], valueLabel = 'Score' }) {
  const plotted = getLinePoints(points)
  const path = plotted.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  if (points.length === 0) {
    return <p className={bodyClass}>No compatible submitted scores are available yet.</p>
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[#d7e5dc] bg-white p-2">
        <svg viewBox="0 0 640 250" role="img" aria-label={accessibleLabel} className="min-w-[34rem]">
          {[0, 2, 4, 6, 8, 10].map((tick) => {
            const y = 22 + (250 - 22 - 52) - (tick / 10) * (250 - 22 - 52)
            return (
              <g key={tick}>
                <line x1="48" y1={y} x2="616" y2={y} stroke="#e7efe9" />
                <text x="38" y={y + 4} textAnchor="end" fill="#4b5f55" fontSize="12" fontWeight="800">{tick}</text>
              </g>
            )
          })}
          {plotted.length > 1 ? (
            <path d={path} fill="none" stroke="#047857" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
          {plotted.map((point) => (
            <g key={point.id}>
              <circle cx={point.x} cy={point.y} r="5" fill="white" stroke="#047857" strokeWidth="3" />
              <title>{`${point.label}: ${Number(point.value).toFixed(1)}`}</title>
              <text x={point.x} y="224" textAnchor="middle" fill="#4b5f55" fontSize="11" fontWeight="800">
                {point.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      {points.length === 1 ? (
        <p className={`mt-2 ${bodyClass}`}>One submitted score is shown as a single point. No trend is inferred.</p>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[24rem] text-left text-sm">
          <caption className="sr-only">{accessibleLabel} values</caption>
          <thead>
            <tr className="border-b border-[#d7e5dc] text-[#101828]">
              <th scope="col" className="px-2 py-2 font-black">Assessment date</th>
              <th scope="col" className="px-2 py-2 font-black">{valueLabel}</th>
              {points.some((point) => point.answeredMetricCount) ? (
                <th scope="col" className="px-2 py-2 font-black">Answered metrics</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={`table-${point.id}`} className="border-b border-[#e7efe9] text-[#4b5f55]">
                <td className="px-2 py-2 font-semibold">{point.label}</td>
                <td className="px-2 py-2 font-black text-[#101828]">{Number(point.value).toFixed(1)}</td>
                {points.some((item) => item.answeredMetricCount) ? (
                  <td className="px-2 py-2 font-semibold">{point.answeredMetricCount ?? 'Not recorded'}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function buildRadarPoints(metrics = []) {
  const center = 160
  const radius = 108
  return metrics.map((metric, index) => {
    const angle = -Math.PI / 2 + (index / metrics.length) * Math.PI * 2
    const scoreRadius = (metric.score / 10) * radius
    return {
      ...metric,
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      x: center + Math.cos(angle) * scoreRadius,
      y: center + Math.sin(angle) * scoreRadius,
    }
  })
}

function LatestProfileRadar({ profile }) {
  if (!profile?.metrics?.length) {
    return <p className={bodyClass}>A radar profile appears after a specialist elite review is submitted.</p>
  }

  const points = buildRadarPoints(profile.metrics)
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-center">
      <svg viewBox="0 0 320 320" role="img" aria-label={`${profile.formName} latest metric profile`} className="mx-auto h-auto w-full max-w-[20rem]">
        {[2, 4, 6, 8, 10].map((level) => {
          const ring = buildRadarPoints(profile.metrics.map((metric) => ({ ...metric, score: level })))
          return <polygon key={level} points={ring.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#d7e5dc" />
        })}
        {points.map((point, index) => (
          <line key={point.metricKey} x1="160" y1="160" x2={point.axisX} y2={point.axisY} stroke="#d7e5dc">
            <title>{`${index + 1}. ${point.metricLabel}`}</title>
          </line>
        ))}
        <polygon points={polygon} fill="#10b981" fillOpacity="0.22" stroke="#047857" strokeWidth="3" />
        {points.map((point) => (
          <circle key={`score-${point.metricKey}`} cx={point.x} cy={point.y} r="4" fill="#047857">
            <title>{`${point.metricLabel}: ${point.score} out of 10`}</title>
          </circle>
        ))}
      </svg>
      <ol className="grid gap-2 sm:grid-cols-2">
        {profile.metrics.map((metric, index) => (
          <li key={metric.metricKey} className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm">
            <span className="font-black text-[#101828]">{index + 1}. {metric.metricLabel}</span>
            <span className="ml-2 font-black text-[#047857]">{metric.score} / 10</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function EliteDevelopmentCharts({ data }) {
  const metricSeries = useMemo(() => data?.metricSeries ?? [], [data])
  const categorySeries = useMemo(() => data?.categorySeries ?? [], [data])
  const [selectedMetricKey, setSelectedMetricKey] = useState('')
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('')

  const selectedMetric = metricSeries.find((series) => series.key === selectedMetricKey) ?? metricSeries[0] ?? null
  const selectedCategory = categorySeries.find((series) => series.key === selectedCategoryKey) ?? categorySeries[0] ?? null

  return (
    <section className={panelClass}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Elite development</p>
      <h2 className="mt-2 text-xl font-black tracking-tight text-[#101828]">Elite development trends</h2>
      <p className={`mt-2 ${bodyClass}`}>
        Scores use stable metric identities from submitted reviews. Category values are simple unweighted averages of answered metrics.
      </p>

      {!data?.hasData ? (
        <p className={`mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 ${bodyClass}`}>
          No submitted elite development scores are available for this player yet.
        </p>
      ) : (
        <div className="mt-5 grid gap-4">
          <div className={subPanelClass}>
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Metric progress</span>
              <select
                value={selectedMetric?.key ?? ''}
                onChange={(event) => setSelectedMetricKey(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-semibold text-[#101828] sm:max-w-xl"
              >
                {metricSeries.map((series) => (
                  <option key={series.key} value={series.key}>{series.label}</option>
                ))}
              </select>
            </label>
            <div className="mt-4">
              <ScoreLineChart
                accessibleLabel={`${selectedMetric?.label || 'Selected metric'} score over assessment date`}
                points={selectedMetric?.points}
              />
            </div>
          </div>

          <div className={subPanelClass}>
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Category average over time</span>
              <select
                value={selectedCategory?.key ?? ''}
                onChange={(event) => setSelectedCategoryKey(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-semibold text-[#101828] sm:max-w-xl"
              >
                {categorySeries.map((series) => (
                  <option key={series.key} value={series.key}>{series.label}</option>
                ))}
              </select>
            </label>
            <p className={`mt-2 ${bodyClass}`}>Unanswered metrics are excluded. Values are rounded only for display.</p>
            <div className="mt-4">
              <ScoreLineChart
                accessibleLabel={`${selectedCategory?.label || 'Selected category'} category average over assessment date`}
                points={selectedCategory?.points}
                valueLabel="Category average"
              />
            </div>
          </div>

          <div className={subPanelClass}>
            <p className="text-base font-black text-[#101828]">Latest specialist profile</p>
            {data.latestProfile ? (
              <p className={`mt-1 ${bodyClass}`}>
                {data.latestProfile.formName}, submitted {data.latestProfile.label}. The radar uses individual 1 to 10 metric scores.
              </p>
            ) : null}
            <div className="mt-4">
              <LatestProfileRadar profile={data.latestProfile} />
            </div>
          </div>

          <div className={subPanelClass}>
            <p className="text-base font-black text-[#101828]">Latest vs previous compatible review</p>
            {data.previousComparison ? (
              <>
                <p className={`mt-1 ${bodyClass}`}>
                  {data.previousComparison.previousLabel} to {data.previousComparison.latestLabel}. Only matching stable metrics are compared.
                </p>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.previousComparison.changes.map((item) => (
                    <li key={item.metricKey} className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-semibold text-[#4b5f55]">
                      <span className="font-black text-[#101828]">{item.label}:</span> {item.previous} to {item.latest}
                      <span className="ml-2 text-xs font-black text-[#047857]">
                        {item.change > 0 ? `+${item.change}` : item.change}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className={`mt-2 ${bodyClass}`}>A comparison appears after two specialist reviews share stable metric identities.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
