import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { clubTvStorageKey, hasLocalTvPreferences, normalizeTvPreferences, readTvPreferences } from '../lib/club-matchday-tv.js'
import { getClubMatchdayTv } from '../lib/domain/club-matchday-tv.js'
import { ClubMatchdayTvDisplay } from './ClubMatchdayTvDisplay.jsx'

export function ClubMatchdayTvPage() {
  const { user } = useAuth()
  const [search] = useSearchParams()
  const preview = search.get('preview') === '1'
  return <LegacyClubDisplay key={JSON.stringify([user.id, user.clubId, preview])} user={user} preview={preview} />
}

function LegacyClubDisplay({ user, preview }) {
  const storageKey = clubTvStorageKey(user)
  const [hasLegacySettings] = useState(() => hasLocalTvPreferences(storageKey))
  const [preferences, setPreferences] = useState(() => readTvPreferences(storageKey))

  useEffect(() => {
    if (hasLegacySettings && !preview) return undefined
    const controller = new AbortController()
    getClubMatchdayTv({ clubId: user.clubId, action: 'settings', signal: controller.signal })
      .then(({ settings }) => {
        if (!controller.signal.aborted && settings?.preferences) setPreferences(normalizeTvPreferences(settings.preferences))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [hasLegacySettings, preview, user.clubId])

  return <ClubMatchdayTvDisplay user={user} preferences={preferences} preview={preview} />
}
