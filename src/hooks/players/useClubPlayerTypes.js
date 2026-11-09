import { useEffect, useMemo, useState } from 'react'
import { getClubPlayerTypes } from '../../lib/domain/club-player-types.js'
import { PLAYER_SECTIONS } from '../../lib/player-participation.js'

export function useClubPlayerTypes(clubId) {
  const [state, setState] = useState({ clubId: '', types: [] })
  useEffect(() => {
    let active = true
    if (clubId) {
      getClubPlayerTypes(clubId)
        .then((rows) => { if (active) setState({ clubId, types: rows }) })
        .catch((error) => { if (active) console.error('Player types could not be loaded.', error) })
    }
    return () => { active = false }
  }, [clubId])
  return useMemo(() => state.clubId === clubId && state.types.length
    ? state.types.map((type) => type.name) : PLAYER_SECTIONS, [clubId, state])
}
