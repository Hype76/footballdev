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
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 1,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-tactical',
    label: 'Tactical',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 2,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-physical',
    label: 'Physical',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 3,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-mentality',
    label: 'Mentality',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 4,
    isDefault: true,
    isEnabled: true,
  },
  {
    id: 'default-coachability',
    label: 'Coachability',
    type: 'score_1_5',
    options: [],
    required: true,
    orderIndex: 5,
    isDefault: true,
    isEnabled: true,
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
  },
]

export function getDefaultFormFields() {
  return DEFAULT_FORM_FIELDS.map((field) => ({ ...field }))
}

export function getDefaultClubRoles() {
  return SYSTEM_ROLE_OPTIONS.map((role) => ({ ...role }))
}
