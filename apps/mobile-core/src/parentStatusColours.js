// Semantic status colours shared by compact Home badges and event screens.
// These preserve the existing status palette independently of the Club accent.
const dark = {
  statusDanger: '#fca5a5', statusDangerSurface: '#7f1d1d',
  statusMuted: '#d1d5db', statusMutedSurface: '#374151',
  statusSelected: '#bfdbfe', statusSelectedSurface: '#1e3a8a',
  statusSuccess: '#86efac', statusSuccessSurface: '#14532d',
  statusWarning: '#fcd34d', statusWarningSurface: '#713f12',
}
const light = {
  statusDanger: '#b91c1c', statusDangerSurface: '#fee2e2',
  statusMuted: '#4b5563', statusMutedSurface: '#e5e7eb',
  statusSelected: '#1d4ed8', statusSelectedSurface: '#dbeafe',
  statusSuccess: '#167000', statusSuccessSurface: '#e1f3e1',
  statusWarning: '#995900', statusWarningSurface: '#fff0d0',
}
export function getParentStatusColours(tokens = {}) {
  return Number.parseInt(String(tokens.background || '#ffffff').slice(1, 3), 16) < 128 ? dark : light
}
export function getParentBadgeColours(tokens, tone) {
  const colours = getParentStatusColours(tokens)
  const suffix = ({ success: 'Success', danger: 'Danger', warning: 'Warning', accent: 'Selected' })[tone] || 'Muted'
  return [colours[`status${suffix}`], colours[`status${suffix}Surface`]]
}
export const PARENT_SCORER_ICON_COLOURS = Object.freeze({ yellow: '#d79b00', red: '#e92736', substitution: '#24ad60' })
export const PARENT_FAN_SIGN_IN_COLOURS = Object.freeze({ background: '#f3f7f5', text: '#173f35' })
export const PARENT_POLL_SEPARATOR_COLOUR = '#94a3a0'
