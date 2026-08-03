export const MATCH_DAY_WORKSPACE_SECTIONS = [
  { id: 'roles', label: 'Scorer and roles' },
  { id: 'squad', label: 'Players and availability' },
  { id: 'overview', label: 'Match details' },
  { id: 'timeline', label: 'Timeline and notes' },
  { id: 'transport', label: 'Transport' },
]

export function normalizeMatchDayWorkspaceSection(value) {
  return MATCH_DAY_WORKSPACE_SECTIONS.some((section) => section.id === value) ? value : 'roles'
}
