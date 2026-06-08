const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'

function getPointCoordinates(points, maxValue) {
  const width = 420
  const height = 160
  const padding = 24
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2

  if (points.length === 0) {
    return []
  }

  return points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : padding + (index / (points.length - 1)) * innerWidth
    const normalizedValue = Math.min(maxValue, Math.max(0, Number(point.value ?? 0)))
    const y = padding + innerHeight - (normalizedValue / maxValue) * innerHeight

    return {
      ...point,
      x,
      y,
    }
  })
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
          Progression charts will appear after this player has session notes, attendance, or development records.
        </p>
      </section>
    )
  }

  const scoreMax = progressionData.scoreTrend.some((point) => Number(point.value) > 5) ? 10 : 5
  const points = getPointCoordinates(progressionData.scoreTrend, scoreMax)
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const maxInvolvement = Math.max(1, ...progressionData.involvementByMonth.map((item) => item.assessments))

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

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-[#101828]">Coach rating over time</p>
              <p className={`mt-1 ${bodyClass}`}>
                {progressionData.hasScoreTrend ? 'Scored records shown in date order.' : 'Two scored records are needed for a line chart.'}
              </p>
            </div>
            <span className="inline-flex min-h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-xs font-black text-[#047857]">
              Max {scoreMax}
            </span>
          </div>

          {progressionData.hasScoreTrend ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-[#d7e5dc] bg-white p-3">
              <svg viewBox="0 0 420 160" role="img" aria-label="Player score progression chart" className="h-auto w-full">
                <line x1="24" y1="136" x2="396" y2="136" stroke="#d7e5dc" strokeWidth="2" />
                <line x1="24" y1="24" x2="24" y2="136" stroke="#d7e5dc" strokeWidth="2" />
                <path d={linePath} fill="none" stroke="#047857" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point) => (
                  <g key={point.id || `${point.label}-${point.value}`}>
                    <circle cx={point.x} cy={point.y} r="7" fill="#ccff00" stroke="#047857" strokeWidth="3" />
                    <text x={point.x} y={Math.max(16, point.y - 12)} textAnchor="middle" fill="#101828" fontSize="12" fontWeight="800">
                      {point.value.toFixed(1)}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {progressionData.scoreTrend.slice(-6).map((point) => (
                  <div key={point.id || point.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
                    <p className="text-xs font-black text-[#101828]">{point.label}</p>
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">{point.session || point.team || 'Development record'}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-bold text-[#4b5f55]">
              Progression charts will appear after this player has session notes, attendance, or development records.
            </p>
          )}
        </div>

        <div className="grid gap-4">
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
            <p className="text-sm font-black text-[#101828]">Training and match involvement</p>
            <div className="mt-4 grid gap-3">
              {progressionData.involvementByMonth.length > 0 ? progressionData.involvementByMonth.map((item) => (
                <div key={item.key}>
                  <div className="flex items-center justify-between gap-3 text-xs font-black text-[#101828]">
                    <span>{item.label}</span>
                    <span>{item.assessments}</span>
                  </div>
                  <div className="mt-1 h-3 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-[#047857]"
                      style={{ width: `${Math.max(12, (item.assessments / maxInvolvement) * 100)}%` }}
                    />
                  </div>
                </div>
              )) : (
                <p className={bodyClass}>No dated development records yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
            <p className="text-sm font-black text-[#101828]">Next focus areas</p>
            {progressionData.focusAreas.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {progressionData.focusAreas.map((item) => (
                  <div key={item.label} className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2">
                    <p className="text-sm font-black text-[#101828]">{item.label}</p>
                    <p className="mt-1 text-xs font-semibold text-[#4b5f55]">
                      Latest score {item.latest}. First score {item.first}.
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
