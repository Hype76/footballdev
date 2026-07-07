function normalizeText(value) {
  return String(value ?? '').trim()
}

export function getMatchVenueDisplay(match = {}) {
  return normalizeText(match.venueName)
}

export function getMatchMapLocation(match = {}) {
  return normalizeText(match.venueAddress) || normalizeText(match.venueName)
}

export function getMatchCalendarLocation(match = {}) {
  return normalizeText(match.venueAddress) || normalizeText(match.venueName)
}

export function getMatchLocationSummary(match = {}) {
  const venueName = getMatchVenueDisplay(match)
  const mapLocation = getMatchMapLocation(match)

  return {
    venueName,
    mapLocation,
    calendarLocation: getMatchCalendarLocation(match),
    displayLabel: venueName || mapLocation,
  }
}
