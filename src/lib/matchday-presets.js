import { MATCHDAY_DEFAULT_FLAGS, validateMatchdayFlags } from './matchday-policy.js'

const FIXTURES_ONLY_FLAGS = Object.freeze({
  ...Object.fromEntries(Object.keys(MATCHDAY_DEFAULT_FLAGS).map((key) => [key, false])),
  players: true,
  teamCalendar: true,
  fixtures: true,
  parentPortal: true,
  parentInvitations: true,
  parentEmails: true,
  nativeAppEntitlement: true,
})

export const MATCHDAY_PRESETS = Object.freeze({
  standard: Object.freeze({
    key: 'standard',
    label: 'Standard Matchday',
    description: 'The original Matchday defaults, including match tools and PDF reports.',
    flags: MATCHDAY_DEFAULT_FLAGS,
  }),
  fixturesOnly: Object.freeze({
    key: 'fixturesOnly',
    label: 'Fixtures only',
    description: 'Players, calendar, fixtures, and parent invitations. Match tools and PDF reports stay off.',
    flags: FIXTURES_ONLY_FLAGS,
  }),
})

export const MATCHDAY_PRESET_OPTIONS = Object.freeze(Object.values(MATCHDAY_PRESETS))

export function getMatchdayPreset(key) {
  return MATCHDAY_PRESETS[key] || null
}

export function getMatchdayPresetFlags(key) {
  const preset = getMatchdayPreset(key)
  return preset ? validateMatchdayFlags({ ...preset.flags }) : null
}

export function getMatchdayPresetKey(flags) {
  if (!flags || typeof flags !== 'object') return null
  return MATCHDAY_PRESET_OPTIONS.find((preset) => Object.keys(MATCHDAY_DEFAULT_FLAGS).every((key) => flags[key] === preset.flags[key]))?.key || null
}
