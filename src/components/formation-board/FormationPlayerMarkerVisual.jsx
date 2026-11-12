import { KIT_SHIRT_PATH, kitImageUrl } from '../../lib/club-kits.js'
import { supabase } from '../../lib/supabase-client.js'
import { formationBoardShirtNumberColour } from '../../lib/formation-board-shirt.js'
import { useState } from 'react'

export function FormationPlayerMarkerVisual({ className = '', isGoalkeeper = false, shirtNumber = '', size = 'md', shirtKit = null }) {
  const [failedUrl, setFailedUrl] = useState('')
  const kitUrl = !isGoalkeeper && shirtKit ? kitImageUrl(supabase, shirtKit) : ''
  const showImage = kitUrl && failedUrl !== kitUrl
  const normalizedNumber = String(shirtNumber ?? '').trim()
  const sizeClass = size === 'sm' ? 'h-11 w-11 sm:h-12 sm:w-12' : size === 'xs' ? 'h-8 w-8' : 'h-14 w-14 sm:h-16 sm:w-16'
  const numberClass = size === 'xs'
    ? 'text-[0.48rem]'
    : size === 'sm'
      ? 'text-[0.7rem]'
      : 'text-sm'

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${sizeClass} ${className}`} aria-hidden="true">
      {shirtKit && !isGoalkeeper && !showImage ? <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-md"><path d={KIT_SHIRT_PATH} fill={shirtKit.colour} stroke="#1f2937" strokeWidth="1.5" /></svg> : <img
        alt=""
        draggable="false"
        src={showImage ? kitUrl : isGoalkeeper ? '/marketing-v70/assets/formation-shirt-gold.webp' : '/marketing-v70/assets/formation-shirt-white.webp'}
        onError={() => setFailedUrl(kitUrl)}
        className="pointer-events-none h-full w-full select-none object-contain drop-shadow-[0_3px_3px_rgba(0,0,0,0.35)]"
      />}
      {normalizedNumber ? (
        <span style={shirtKit && !isGoalkeeper ? { color: formationBoardShirtNumberColour(shirtKit), textShadow: showImage ? '0 0 3px white, 0 0 3px white' : undefined } : undefined} className={`pointer-events-none absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2 font-black leading-none ${isGoalkeeper ? 'text-[#101828]' : 'text-[#0b442b]'} ${numberClass}`}>
          {normalizedNumber}
        </span>
      ) : null}
    </span>
  )
}
