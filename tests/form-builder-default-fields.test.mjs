import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  buildReorderedFormFields,
  FIELD_TYPE_OPTIONS,
  getFieldTypeLabel,
  getOptionsForType,
  isScoreType,
} from '../src/hooks/form-builder/formBuilderUtils.js'
import { isAssessmentScoreFieldType } from '../src/lib/assessment-scoring.js'
import { getDefaultFormFields } from '../src/lib/domain/core-defaults.js'
import { normalizeFieldType } from '../src/lib/domain/core-normalizers.js'
import {
  buildFormResponses,
  buildScores,
  getAverageScore,
  normalizeResponseValue,
} from '../src/hooks/evaluations/evaluationFormUtils.js'

const fitnessLabels = ['2k run', '5k run', '10k run', 'Bleep Test']

function getFitnessDefault(label) {
  return getDefaultFormFields().find((field) => field.label === label)
}

test('fitness default fields are NUMBER definitions', () => {
  for (const label of fitnessLabels) {
    const field = getFitnessDefault(label)

    assert.ok(field, `${label} default field should exist`)
    assert.equal(field.type, 'number')
    assert.equal(getFieldTypeLabel(field.type), 'Number')
    assert.deepEqual(field.options, [])
  }
})

test('number fields stay numeric without becoming assessment score fields', () => {
  assert.equal(normalizeFieldType('number'), 'number')
  assert.equal(isScoreType('number'), false)
  assert.equal(isAssessmentScoreFieldType('number'), false)
  assert.deepEqual(getOptionsForType('number', '1, 2, 3'), [])
  assert.ok(FIELD_TYPE_OPTIONS.some((option) => option.value === 'number' && option.label === 'Number'))
})

test('fitness number responses are saved as numeric values but excluded from scores', () => {
  const fields = [
    { id: 'technical', label: 'Technical', type: 'score_1_10', isEnabled: true },
    { id: 'run-2k', label: '2k run', type: 'number', isEnabled: true },
    { id: 'bleep', label: 'Bleep Test', type: 'number', isEnabled: true },
    { id: 'note', label: 'Coach note', type: 'text', isEnabled: true },
  ]
  const responseValues = {
    technical: '8',
    'run-2k': '475.5',
    bleep: '9.2',
    note: 'Sharp session',
  }
  const formResponses = buildFormResponses(fields, responseValues)

  assert.equal(normalizeResponseValue(fields[1], '475.5'), 475.5)
  assert.deepEqual(formResponses, {
    Technical: 8,
    '2k run': 475.5,
    'Bleep Test': 9.2,
    'Coach note': 'Sharp session',
  })
  assert.deepEqual(buildScores(formResponses, fields), { Technical: 8 })
  assert.equal(getAverageScore(formResponses, fields), 8)
})

test('enabled default fields appear for coach entry and disabled defaults do not', () => {
  const fields = [
    { id: 'technical', label: 'Technical', type: 'score_1_10', isDefault: true, isEnabled: true },
    { id: 'run-2k', label: '2k run', type: 'number', isDefault: true, isEnabled: false },
    { id: 'bleep', label: 'Bleep Test', type: 'number', isDefault: true, isEnabled: true },
  ]
  const enabledFields = fields.filter((field) => field.isEnabled)

  assert.deepEqual(enabledFields.map((field) => field.label), ['Technical', 'Bleep Test'])
  assert.equal(enabledFields.some((field) => field.label === '2k run'), false)
})

test('loading defaults has stable IDs and labels without duplicates', () => {
  const defaultFields = getDefaultFormFields()
  const ids = defaultFields.map((field) => field.id)
  const labels = defaultFields.map((field) => field.label.toLowerCase())

  assert.equal(new Set(ids).size, ids.length)
  assert.equal(new Set(labels).size, labels.length)
  assert.deepEqual(
    defaultFields.filter((field) => fitnessLabels.includes(field.label)).map((field) => field.label),
    fitnessLabels,
  )
})

test('reordering default fields preserves custom field relative order', () => {
  const defaultFields = [
    { id: 'default-technical', label: 'Technical', isDefault: true, orderIndex: 1 },
    { id: 'default-physical', label: 'Physical', isDefault: true, orderIndex: 2 },
  ]
  const customFields = [
    { id: 'custom-effort', label: 'Effort', isDefault: false, orderIndex: 3 },
    { id: 'custom-attendance', label: 'Attendance', isDefault: false, orderIndex: 4 },
  ]
  const nextFields = buildReorderedFormFields({
    customFields,
    defaultFields,
    fieldGroup: 'default',
    nextGroupFields: [defaultFields[1], defaultFields[0]],
  })

  assert.deepEqual(nextFields.map((field) => field.id), [
    'default-physical',
    'default-technical',
    'custom-effort',
    'custom-attendance',
  ])
  assert.deepEqual(nextFields.map((field) => field.orderIndex), [1, 2, 3, 4])
})

test('migration repairs default fitness fields without rewriting evaluations', async () => {
  const migration = await readFile(
    new URL('../supabase/archived-migrations/not-applied-production/20260618103000_player_form_defaults_fitness_numeric.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /update public\.form_fields[\s\S]*type = 'number'[\s\S]*'bleep test'/i)
  assert.match(migration, /create or replace function public\.seed_default_form_fields\(\)/)
  assert.match(migration, /where not exists/i)
  assert.doesNotMatch(migration, /update public\.evaluations|delete from public\.evaluations/i)
})
