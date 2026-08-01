export const MATCH_DAY_WORKSPACE_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'squad', label: 'Squad and availability' },
  { id: 'roles', label: 'Roles and transport' },
  { id: 'timeline', label: 'Timeline and notes' },
]

export function normalizeMatchDayWorkspaceSection(value) {
  return MATCH_DAY_WORKSPACE_SECTIONS.some((section) => section.id === value) ? value : 'overview'
}
