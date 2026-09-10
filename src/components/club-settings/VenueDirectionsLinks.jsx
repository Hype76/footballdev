import { getVenueDirectionsOptions } from '../../lib/venue-directions.js'

export function VenueDirectionsLinks({ match }) {
  const location = [match?.venueName, match?.venueAddress].filter(Boolean).join(', ')
  const options = getVenueDirectionsOptions(location)
  if (!options.length) return null
  return <div className="flex flex-wrap gap-3 py-2" aria-label="Directions">{options.map(option => <a className="inline-flex min-h-11 items-center underline" key={option.label} href={option.url} target="_blank" rel="noopener noreferrer">{option.label}</a>)}</div>
}
