export const FITNESS_BENCHMARK_FIELDS = [
  {
    benchmarkKey: 'run_2k',
    direction: 'lower',
    label: '2k run',
    unit: 'time',
  },
  {
    benchmarkKey: 'run_5k',
    direction: 'lower',
    label: '5k run',
    unit: 'time',
  },
  {
    benchmarkKey: 'run_10k',
    direction: 'lower',
    label: '10k run',
    unit: 'time',
  },
  {
    benchmarkKey: 'bleep_test',
    direction: 'higher',
    label: 'Bleep Test',
    unit: 'level_shuttle',
  },
]

function normalizeText(value) {
  return String(value ?? '').trim()
}

function parseTimeToSeconds(value) {
  const normalizedValue = normalizeText(value).toLowerCase()
  const timeParts = normalizedValue.match(/^(\d{1,2})(?::(\d{1,2}))(?::(\d{1,2}))?$/)

  if (timeParts) {
    const [, first, second, third] = timeParts
    return third === undefined
      ? Number(first) * 60 + Number(second)
      : Number(first) * 3600 + Number(second) * 60 + Number(third)
  }

  const minuteMatch = normalizedValue.match(/(\d+(?:\.\d+)?)\s*m/)
  const secondMatch = normalizedValue.match(/(\d+(?:\.\d+)?)\s*s/)

  if (minuteMatch || secondMatch) {
    return Math.round((Number(minuteMatch?.[1] || 0) * 60) + Number(secondMatch?.[1] || 0))
  }

  const numericValue = Number(normalizedValue)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null
}

function parseBleepLevel(value) {
  const normalizedValue = normalizeText(value).toLowerCase()
  const match = normalizedValue.match(/^(\d{1,2})(?:[.\-:\s]+(\d{1,2}))?/)

  if (!match) {
    return null
  }

  const level = Number(match[1])
  const shuttle = Number(match[2] || 0)

  return Number.isFinite(level) ? (level * 100) + shuttle : null
}

export function parseFitnessBenchmarkValue(benchmarkKey, value) {
  const normalizedKey = normalizeText(benchmarkKey)

  if (normalizedKey === 'bleep_test') {
    return parseBleepLevel(value)
  }

  if (normalizedKey === 'run_2k' || normalizedKey === 'run_5k' || normalizedKey === 'run_10k') {
    return parseTimeToSeconds(value)
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

export function compareFitnessBenchmarkResults(benchmarkKey, left, right) {
  const benchmark = FITNESS_BENCHMARK_FIELDS.find((item) => item.benchmarkKey === benchmarkKey)
  const leftValue = parseFitnessBenchmarkValue(benchmarkKey, left)
  const rightValue = parseFitnessBenchmarkValue(benchmarkKey, right)

  if (leftValue === null && rightValue === null) {
    return 0
  }

  if (leftValue === null) {
    return 1
  }

  if (rightValue === null) {
    return -1
  }

  return benchmark?.direction === 'higher'
    ? rightValue - leftValue
    : leftValue - rightValue
}

export function sortFitnessBenchmarkResults(benchmarkKey, results = []) {
  return [...results].sort((left, right) =>
    compareFitnessBenchmarkResults(benchmarkKey, left.value, right.value) ||
    String(right.date || '').localeCompare(String(left.date || '')),
  )
}

export function getBestFitnessBenchmarkResult(benchmarkKey, results = []) {
  return sortFitnessBenchmarkResults(benchmarkKey, results)[0] || null
}

export function getWorstFitnessBenchmarkResult(benchmarkKey, results = []) {
  const sortedResults = sortFitnessBenchmarkResults(benchmarkKey, results)
  return sortedResults[sortedResults.length - 1] || null
}

export function getLatestFitnessBenchmarkResult(results = []) {
  return [...results].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))[0] || null
}
