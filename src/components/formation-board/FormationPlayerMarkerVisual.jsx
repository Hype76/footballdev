export function FormationPlayerMarkerVisual({ className = '', isGoalkeeper = false, shirtNumber = '', size = 'md' }) {
  const normalizedNumber = String(shirtNumber ?? '').trim()
  const sizeClass = size === 'sm' ? 'h-11 w-11 sm:h-12 sm:w-12' : size === 'xs' ? 'h-8 w-8' : 'h-14 w-14 sm:h-16 sm:w-16'
  const numberClass = size === 'xs'
    ? 'text-[0.48rem]'
    : size === 'sm'
      ? 'text-[0.7rem]'
      : 'text-sm'

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${sizeClass} ${className}`} aria-hidden="true">
      <img
        alt=""
        draggable="false"
        src={isGoalkeeper ? '/formation-shirt-gold.png' : '/formation-shirt-white.png'}
        className="pointer-events-none h-full w-full select-none object-contain drop-shadow-[0_3px_3px_rgba(0,0,0,0.35)]"
      />
      {normalizedNumber ? (
        <span className={`pointer-events-none absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 font-black leading-none ${isGoalkeeper ? 'text-[#101828]' : 'text-[#0b442b]'} ${numberClass}`}>
          {normalizedNumber}
        </span>
      ) : null}
    </span>
  )
}
