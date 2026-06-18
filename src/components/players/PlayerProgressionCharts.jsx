import { useMemo, useState } from 'react'
import { formatUkDateWords } from '../../lib/date-format.js'

const panelClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'

const lineColours = ['#047857', '#2563eb', '#f97316', '#7c3aed', '#dc2626', '#0891b2', '#65a30d']

function getPointCoordinates(points, maxValue, xKeys = []) {
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
    const pointIndex = xKeys.length > 0 ? Math.max(0, xKeys.indexOf(point.dateKey)) : index
    const pointCount = xKeys.length > 0 ? xKeys.length : points.length
    const x = pointCount === 1 ? padding.left + innerWidth / 2 : padding.left + (pointIndex / (pointCount - 1)) * innerWidth
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawLabel) || /^\d{2}\/\d{2}\/\d{4}$/.test(rawLabel)) {
    return formatUkDateWords(rawLabel, rawLabel)
  }

  return rawLabel
}

export function PlayerProgressionCharts({
  progressionData,
  playerName,
}) {
  const availableTrendLines = useMemo(() => progressionData?.trendLines ?? [], [progressionData])
  const [selectedTrendKeys, setSelectedTrendKeys] = useState(['overall'])

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

  const selectedTrendLines = availableTrendLines.filter((line) => selectedTrendKeys.includes(line.key))
  const visibleTrendLines = selectedTrendLines.length > 0
    ? selectedTrendLines
    : availableTrendLines.filter((line) => line.key === 'overall')
  const chartSourcePoints = visibleTrendLines.flatMap((line) => line.points)
  const xKeyLabels = new Map()

  chartSourcePoints.forEach((point) => {
    if (point.dateKey && !xKeyLabels.has(point.dateKey)) {
      xKeyLabels.set(point.dateKey, point.label)
    }
  })

  const xKeys = Array.from(xKeyLabels.keys()).sort()
  const hasVisibleTrend = visibleTrendLines.some((line) => line.points.length >= 2)
  const scoreMax = chartSourcePoints.some((point) => Number(point.value) > 5) ? 10 : 5
  const chartLines = hasVisibleTrend
    ? visibleTrendLines.map((line, index) => ({
        ...line,
        colour: lineColours[index % lineColours.length],
        points: getPointCoordinates(line.points, scoreMax, xKeys),
      }))
    : []
  const maxInvolvement = Math.max(1, ...progressionData.involvementByMonth.map((item) => item.assessments))
  const historicalEvaluationCount = Number(progressionData.historicalEvaluationCount ?? progressionData.evaluationCount ?? 0)
  const yTicks = scoreMax === 10 ? [0, 2, 4, 6, 8, 10] : [0, 1, 2, 3, 4, 5]
  const xLabels = xKeys
    .map((key) => ({
      key,
      label: xKeyLabels.get(key),
      x: getPointCoordinates([{ dateKey: key, value: 0 }], scoreMax, xKeys)[0]?.x ?? 56,
    }))
    .filter((_, index) => (
      xKeys.length <= 4 ||
      index === 0 ||
      index === xKeys.length - 1 ||
      index === Math.floor((xKeys.length - 1) / 2)
    ))
  const toggleTrendLine = (key) => {
    setSelectedTrendKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key])
  }

  return (
    <section className={panelClass}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className={eyebrowClass}>Progression</p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-[#101828]">Player progression</h2>
          <p className={`mt-2 ${bodyClass}`}>
            Real trend data for {playerName}, built from saved development records and staff notes.
          </p>
          {historicalEvaluationCount !== progressionData.evaluationCount ? (
            <p className={`mt-2 ${bodyClass}`}>
              {progressionData.evaluationCount} scored records from {historicalEvaluationCount} saved development records are eligible for the coach rating trend.
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[22rem]">
          <Metric label="Scored records" value={progressionData.evaluationCount} />
          <Metric label="Training" value={progressionData.trainingCount} />
          <Metric label="Matches" value={progressionData.matchCount} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-base font-black text-[#101828]">Selectable score trends</p>
              <p className={`mt-1 ${bodyClass}`}>
                {hasVisibleTrend ? 'Oldest records are on the left and newest records are on the right.' : 'Two scored records are needed for the selected trend line.'}
              </p>
            </div>
            <span className="inline-flex min-h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-xs font-black text-[#047857]">
              Range 0 to {scoreMax}
            </span>
          </div>

          {availableTrendLines.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {availableTrendLines.map((line) => (
                <label
                  key={line.key}
                  className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] focus-within:ring-2 focus-within:ring-[#93c5fd]"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[#b6d8c5] text-[#047857] focus:ring-[#047857]"
                    checked={selectedTrendKeys.includes(line.key)}
                    onChange={() => toggleTrendLine(line.key)}
                  />
                  {line.label}
                </label>
              ))}
              <button
                type="button"
                onClick={() => setSelectedTrendKeys(availableTrendLines.map((line) => line.key))}
                className="inline-flex min-h-10 items-center rounded-lg border border-[#047857] bg-[#ecfdf5] px-3 py-2 text-xs font-black text-[#065f46] transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#93c5fd]"
              >
                Show all
              </button>
              <button
                type="button"
                onClick={() => setSelectedTrendKeys(['overall'])}
                className="inline-flex min-h-10 items-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#93c5fd]"
              >
                Overall only
              </button>
            </div>
          ) : null}

          {hasVisibleTrend ? (
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
                {chartLines.map((line) => (
                  <g key={line.key}>
                    <path d={buildLinePath(line.points)} fill="none" stroke={line.colour} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    {line.points.map((point) => (
                      <g key={`${line.key}-${point.id || `${point.label}-${point.value}`}`}>
                        <circle cx={point.x} cy={point.y} r="5" fill="#fff" stroke={line.colour} strokeWidth="2" />
                        <title>{`${line.label} | ${formatCompactLabel(point.label)}: ${Number(point.value).toFixed(1)}`}</title>
                      </g>
                    ))}
                  </g>
                ))}
                {xLabels.map((point) => (
                  <text key={`label-${point.key}`} x={point.x} y="274" textAnchor="middle" fill="#4b5f55" fontSize="13" fontWeight="800">
                    {formatCompactLabel(point.label)}
                  </text>
                ))}
              </svg>
              <div className="mt-3 flex flex-wrap gap-3">
                {chartLines.map((line) => (
                  <span key={`legend-${line.key}`} className="inline-flex items-center gap-2 text-xs font-black text-[#4b5f55]">
                    <span className="h-2.5 w-6 rounded-full" style={{ backgroundColor: line.colour }} />
                    {line.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-bold text-[#4b5f55]">
              {progressionData.evaluationCount > 1
                ? 'The selected trend needs at least two scored records before a line can be drawn.'
                : 'Progression appears after this player has multiple scored records.'}
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
