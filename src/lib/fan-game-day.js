export const FAN_GAME_DAY_STATUSES = Object.freeze(['live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time'])
const GAME_DAY_STATUSES = new Set(FAN_GAME_DAY_STATUSES)

// A date alone never grants Game Day access to an unstarted fixture.
export function isFanGameDayMatch(match) {
  return GAME_DAY_STATUSES.has(match?.status)
}
