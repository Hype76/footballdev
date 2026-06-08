const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'

function getPointCoordinates(points, maxValue) {
  const width = 760
  const height = 300
  const padding = {
    bottom: 56,
    left: 56,
    right: 28,
    top: 28,
  }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  return points.map((point, index) => {
    const x = points.length === 1 ? padding.left + innerWidth / 2 : padding.left + (index / (points.length - 1)) * innerWidth
    const normalizedValue = Math.min(maxValue, Math.max(0, Number(point.value ?? 0)))
    const y = padding.top + innerHeight - (normalizedValue / maxValue) * innerHeight

    return {
      ...point,
      x,
      y,
    }
  })
}

function buildLinePath(points) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function formatCompactLabel(label) {
  const rawLabel = String(label ?? '').trim()
  const parsedDate = new Date(rawLabel)

  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return rawLabel.length > 10 ? rawLabel.slice(0, 10) : rawLabel
}

export function PlayerProgressionCharts({
  progressionData,
  playerName,
}) {
  if (!progressionData?.hasAnyData) {
    return (
      <section className={panelClass}>
        <p className={eyebrowClass}>Progression</p>
        <h2 className="mt-2 text-xl font-black tracking-tight text-[#101828]">Player progression</h2>
        <p className={`mt-3 ${bodyClass}`}>
          Progression appears after this player has multiple saved records.
        </p>
      </section>
    )
  }

  const scoreMax = progressionData.scoreTrend.some((point) => Number(point.value) > 5) ? 10 : 5
  const chartPoints = progressionData.hasScoreTrend ? getPointCoordinates(progressionData.scoreTrend, scoreMax) : []
  const linePath = buildLinePath(chartPoints)
  const maxInvolvement = Math.max(1, ...progressionData.involvementByMonth.map((item) => item.assessments))
  const yTicks = scoreMax === 10 ? [0, 2, 4, 6, 8, 10] : [0, 1, 2, 3, 4, 5]
  const xLabels = chartPoints.filter((_, index) => (
    chartPoints.length <= 4 ||
    index === 0 ||
    index === chartPoints.length - 1 ||
    index === Math.floor((chartPoints.length - 1) / 2)
  ))

  return (
    <section className={panelClass}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className={eyebrowClass}>Progression</p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-[#101828]">Player progression</h2>
          <p className={`mt-2 ${bodyClass}`}>
            Real trend data for {playerName}, built from saved development records and staff notes.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[22rem]">
          <Metric label="Records" value={progressionData.evaluationCount} />
          <Metric label="Training" value={progressionData.trainingCount} />
          <Metric label="Matches" value={progressionData.matchCount} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-black text-[#101828]">Coach rating over time</p>
              <p className={`mt-1 ${bodyClass}`}>
                {progressionData.hasScoreTrend ? 'Saved scores shown in date order.' : 'Two scored records are needed for a trend line.'}
              </p>
            </div>
            <span className="inline-flex min-h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-xs font-black text-[#047857]">
              Range 0 to {scoreMax}
            </span>
          </div>

          {progressionData.hasScoreTrend ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-[#d7e5dc] bg-white px-2 py-3 sm:px-4 sm:py-4">
              <svg viewBox="0 0 760 300" role="img" aria-label="Player score progression chart" className="h-auto w-full overflow-visible">
                {yTicks.map((tick) => {
                  const y = 28 + (300 - 28 - 56) - (tick / scoreMax) * (300 - 28 - 56)
                  return (
                    <g key={tick}>
                      <line x1="56" y1={y} x2="732" y2={y} stroke="#e7efe9" strokeWidth="1" />
                      <text x="42" y={y + 5} textAnchor="end" fill="#4b5f55" fontSize="13" fontWeight="800">{tick}</text>
                    </g>
                  )
                })}
                <line x1="56" y1="244" x2="732" y2="244" stroke="#d7e5dc" strokeWidth="2" />
                <line x1="56" y1="28" x2="56" y2="244" stroke="#d7e5dc" strokeWidth="2" />
                <path d={linePath} fill="none" stroke="#047857" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {chartPoints.map((point) => (
                  <g key={point.id || `${point.label}-${point.value}`}>
                    <circle cx={point.x} cy={point.y} r="5" fill="#ccff00" stroke="#047857" strokeWidth="2" />
                    <title>{`${formatCompactLabel(point.label)}: ${Number(point.value).toFixed(1)}`}</title>
                  </g>
                ))}
                {xLabels.map((point) => (
                  <text key={`label-${point.id || point.label}`} x={point.x} y="274" textAnchor="middle" fill="#4b5f55" fontSize="13" fontWeight="800">
                    {formatCompactLabel(point.label)}
                  </text>
                ))}
              </svg>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-bold text-[#4b5f55]">
              Progression appears after this player has multiple saved records.
            </p>
          )}
        </div>

        <div className="grid gap-4">
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
            <p className="text-base font-black text-[#101828]">Training and match involvement</p>
            <div className="mt-4 grid gap-3">
              {progressionData.involvementByMonth.length > 0 ? progressionData.involvementByMonth.map((item) => (
                <div key={item.key} className="rounded-lg border border-[#d7e5dc] bg-white p-3">
                  <div className="flex items-center justify-between gap-3 text-xs font-black text-[#101828]">
                    <span>{item.label}</span>
                    <span>{item.assessments} records</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e7efe9]">
                    <div
                      className="h-full rounded-full bg-[#047857]"
                      style={{ width: `${Math.max(8, (item.assessments / maxInvolvement) * 100)}%` }}
                    />
                  </div>
                </div>
              )) : (
                <p className={bodyClass}>No dated development records yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
            <p className="text-base font-black text-[#101828]">Next focus areas</p>
            {progressionData.focusAreas.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {progressionData.focusAreas.map((item) => (
                  <div key={item.label} className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2">
                    <p className="text-sm font-black text-[#101828]">{item.label}</p>
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                      Latest: {item.latest}, First: {item.first}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`mt-3 ${bodyClass}`}>Focus areas will appear once scored development fields are saved.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
      <p className="text-lg font-black text-[#101828]">{value}</p>
      <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-[#047857]">{label}</p>
    </div>
  )
}
