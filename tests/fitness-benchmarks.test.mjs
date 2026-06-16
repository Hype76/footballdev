import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FITNESS_BENCHMARK_FIELDS,
  getBestFitnessBenchmarkResult,
  getLatestFitnessBenchmarkResult,
  getWorstFitnessBenchmarkResult,
  parseFitnessBenchmarkValue,
} from '../src/lib/fitness-benchmarks.js'
import { getDefaultFormFields } from '../src/lib/domain/core-defaults.js'

test('fitness benchmark defaults are optional and disabled until staff enable them', () => {
  const labels = FITNESS_BENCHMARK_FIELDS.map((field) => field.label)
  const defaultFields = getDefaultFormFields().filter((field) => labels.includes(field.label))

  assert.deepEqual(labels, ['2k run', '5k run', '10k run', 'Bleep Test'])
  assert.equal(defaultFields.length, 4)

  for (const field of defaultFields) {
    assert.equal(field.required, false)
    assert.equal(field.isEnabled, false)
    assert.equal(field.includeInProgressChart, false)
  }
})

test('running benchmarks rank lower times as better and preserve latest helper', () => {
  const results = [
    { date: '2026-06-01', value: '08:20' },
    { date: '2026-06-10', value: '7m 55s' },
    { date: '2026-06-15', value: '08:05' },
  ]

  assert.equal(parseFitnessBenchmarkValue('run_2k', '7m 55s'), 475)
  assert.deepEqual(getBestFitnessBenchmarkResult('run_2k', results), results[1])
  assert.deepEqual(getWorstFitnessBenchmarkResult('run_2k', results), results[0])
  assert.deepEqual(getLatestFitnessBenchmarkResult(results), results[2])
})

test('bleep test ranks higher level and shuttle as better', () => {
  const results = [
    { date: '2026-06-01', value: '8.4' },
    { date: '2026-06-10', value: '9.1' },
    { date: '2026-06-15', value: '8.9' },
  ]

  assert.equal(parseFitnessBenchmarkValue('bleep_test', '8.4'), 804)
  assert.deepEqual(getBestFitnessBenchmarkResult('bleep_test', results), results[1])
  assert.deepEqual(getWorstFitnessBenchmarkResult('bleep_test', results), results[0])
})
