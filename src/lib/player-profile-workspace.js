export const playerProfileSections = [
  { key: 'overview', label: 'Overview', description: 'Scores and recent movement' },
  { key: 'development', label: 'Development', description: 'Progression and specialist trends' },
  { key: 'details', label: 'Details', description: 'Player data and profile actions' },
  { key: 'communication', label: 'Communication', description: 'Resources and linked chat' },
  { key: 'records', label: 'Records', description: 'Merge, Coach activity, and history' },
]

export const playerProfilePanels = {
  development: [
    { key: 'progression', label: 'Progression' },
    { key: 'elite', label: 'Elite development' },
  ],
  communication: [
    { key: 'resources', label: 'Assigned resources' },
    { key: 'chat', label: 'Linked chat' },
  ],
  records: [
    { key: 'history', label: 'Development history' },
    { key: 'activity', label: 'Coach notes and activity' },
    { key: 'merge', label: 'Merge records' },
  ],
}

export function normalizePlayerProfileSection(value) {
  return playerProfileSections.some((section) => section.key === value) ? value : 'overview'
}

export function normalizePlayerProfilePanel(section, value) {
  const panels = playerProfilePanels[section] || []
  return panels.some((panel) => panel.key === value) ? value : panels[0]?.key || ''
}
