import { useEffect, useState } from 'react'
import { getClubMatchdayTv } from '../lib/domain/club-matchday-tv.js'

export function ClubTvSponsorImage({ ad, clubId, slug, alt, hidden = false }) {
  const [artwork, setArtwork] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const path = ad.imagePath

  useEffect(() => {
    if (hidden || !path || ad.image || artwork?.path === path || attempt >= 3) return undefined
    const controller = new AbortController()
    let retry
    getClubMatchdayTv({ clubId, slug, action: 'sponsorArtwork', imagePath: path, signal: controller.signal })
      .then(({ imageUrl }) => { if (!controller.signal.aborted) setArtwork({ path, imageUrl }) })
      .catch(() => { if (!controller.signal.aborted) retry = setTimeout(() => setAttempt(value => value + 1), 3000) })
    return () => { controller.abort(); clearTimeout(retry) }
  }, [ad.image, artwork?.path, attempt, clubId, hidden, path, slug])

  const source = ad.image || (artwork?.path === path ? artwork?.imageUrl : '')
  const retryImage = path && !ad.image ? () => { setArtwork(null); setAttempt(value => value + 1) } : undefined
  return source ? <img src={source} alt={hidden ? '' : alt} hidden={hidden} onError={retryImage} /> : null
}
