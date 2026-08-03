import { FORMATION_PLAYER_SILHOUETTE } from '../../lib/formation-player-marker.js'

export function FormationPlayerMarkerVisual({ className = '', shirtNumber = '', size = 'md' }) {
  const normalizedNumber = String(shirtNumber ?? '').trim()
  const sizeClass = size === 'sm' ? 'h-9 w-9' : size === 'xs' ? 'h-6 w-6' : 'h-11 w-11'
  const badgeClass = size === 'xs'
    ? '-right-1 -top-1 min-h-3.5 min-w-3.5 px-0.5 text-[0.42rem]'
    : size === 'sm'
      ? '-right-1.5 -top-1 min-h-4 min-w-4 px-1 text-[0.55rem]'
      : '-right-2 -top-1 min-h-5 min-w-5 px-1 text-[0.62rem]'

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full border-2 border-current bg-white text-[#344054] ${sizeClass} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[72%] w-[72%] fill-current" focusable="false">
        <circle {...FORMATION_PLAYER_SILHOUETTE.head} />
        <path d={FORMATION_PLAYER_SILHOUETTE.shouldersPath} />
      </svg>
      {normalizedNumber ? (
        <span className={`absolute inline-flex items-center justify-center rounded-full border border-white bg-[#101828] font-black leading-none text-white shadow-sm ${badgeClass}`}>
          {normalizedNumber}
        </span>
      ) : null}
    </span>
  )
}
