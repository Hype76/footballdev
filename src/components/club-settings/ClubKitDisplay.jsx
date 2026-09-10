import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase-client.js'
import { KIT_SHIRT_PATH, kitImageUrl, kitLabel, readClubKits } from '../../lib/club-kits.js'

export function KitArtwork({ kit, label, size = 64 }) {
  const url = kitImageUrl(supabase, kit)
  return url ? <img src={url} alt={label} width={size} height={size} style={{ objectFit: 'contain', width: size, height: size }} />
    : <svg role="img" aria-label={label} width={size} height={size} viewBox="0 0 64 64"><path d={KIT_SHIRT_PATH} fill={kit?.colour || '#1d4ed8'} stroke="currentColor" strokeWidth="1.5" /></svg>
}
export function ClubKitDisplay({ clubId, shirtChoice }) {
  const [value, setValue] = useState({ clubId: '', kits: {} })
  useEffect(() => { let active = true; readClubKits(supabase, clubId).then(kits => { if (active) setValue({ clubId, kits }) }).catch(() => {}); return () => { active = false } }, [clubId])
  const label = kitLabel(shirtChoice)
  return <span className="inline-flex items-center gap-3">{['home', 'away'].includes(shirtChoice) ? <KitArtwork kit={value.clubId === clubId ? value.kits[shirtChoice] : null} label={label} size={48} /> : null}<span>{label}</span></span>
}
