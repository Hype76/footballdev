import { FITNESS_BENCHMARK_FIELDS } from '../fitness-benchmarks.js'
import { DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE } from '../assessment-scoring.js'

export const SYSTEM_ROLE_OPTIONS = [
  { key: 'admin', label: 'Club Admin', rank: 90, isSystem: true },
  { key: 'head_manager', label: 'Team Admin', rank: 70, isSystem: true },
  { key: 'manager', label: 'Manager', rank: 50, isSystem: true },
  { key: 'coach', label: 'Coach', rank: 30, isSystem: true },
  { key: 'assistant_coach', label: 'Assistant Coach', rank: 20, isSystem: true },
]

const DEFAULT_FORM_FIELDS = [
  {
    id: 'default-technical',
    label: 'Technical',
    type: DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE,
    options: [],
    required: true,
    orderIndex: 1,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: true,
  },
  {
    id: 'default-tactical',
    label: 'Tactical',
    type: DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE,
    options: [],
    required: true,
    orderIndex: 2,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: true,
  },
  {
    id: 'default-physical',
    label: 'Physical',
    type: DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE,
    options: [],
    required: true,
    orderIndex: 3,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: true,
  },
  {
    id: 'default-mentality',
    label: 'Mentality',
    type: DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE,
    options: [],
    required: true,
    orderIndex: 4,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: true,
  },
  {
    id: 'default-coachability',
    label: 'Coachability',
    type: DEFAULT_ASSESSMENT_SCORE_FIELD_TYPE,
    options: [],
    required: true,
    orderIndex: 5,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: true,
  },
  {
    id: 'default-strengths',
    label: 'Strengths',
    type: 'textarea',
    options: [],
    required: false,
    orderIndex: 6,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: false,
  },
  {
    id: 'default-improvements',
    label: 'Improvements',
    type: 'textarea',
    options: [],
    required: false,
    orderIndex: 7,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: false,
  },
  {
    id: 'default-overall',
    label: 'Overall Comments',
    type: 'textarea',
    options: [],
    required: true,
    orderIndex: 8,
    isDefault: true,
    isEnabled: true,
    includeInProgressChart: false,
  },
  ...FITNESS_BENCHMARK_FIELDS.map((field, index) => ({
    id: `default-${field.benchmarkKey.replace(/_/g, '-')}`,
    label: field.label,
    type: 'text',
    options: [],
    required: false,
    orderIndex: 9 + index,
    isDefault: true,
    isEnabled: false,
    includeInProgressChart: false,
    benchmarkKey: field.benchmarkKey,
    benchmarkDirection: field.direction,
    benchmarkUnit: field.unit,
  })),
]

export function getDefaultFormFields() {
  return DEFAULT_FORM_FIELDS.map((field) => ({ ...field }))
}

export function getDefaultClubRoles() {
  return SYSTEM_ROLE_OPTIONS.map((role) => ({ ...role }))
}
