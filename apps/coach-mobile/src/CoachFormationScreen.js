import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { getCoachMatchDayList, normalizeCoachMatchDay } from '../../mobile-core/src/coachMatchDayData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { CoachFormationBoard } from './CoachFormationBoard'
import { getLinkableCoachFormationMatches } from './coachFormationEntryCore'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'
import { readMobileResource } from '../../mobile-core/src/mobileResourceCache'

function createStyles(palette) {
  return StyleSheet.create({
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 21 },
    error: { color: palette.danger, fontSize: 14, fontWeight: '800', lineHeight: 21 },
    loading: { alignItems: 'center', gap: 8, paddingVertical: 20 },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderRadius: 13, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    stack: { gap: 12 },
    warning: { borderLeftColor: palette.warning, borderLeftWidth: 2, gap: 8, paddingLeft: 12, paddingVertical: 8 },
  })
}

function normalizeCachedMatches(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === 'object')
    .map(normalizeCoachMatchDay)
}

export function CoachFormationScreen({ context, onQuickActionHandled, palette, quickAction, user }) {
  const styles = useMemo(() => createStyles(palette), [palette])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState([])
  const [players, setPlayers] = useState([])
  const [stale, setStale] = useState(false)

  const load = useCallback(async ({ refresh = false } = {}) => {
    setLoading(true)
    setError('')
    const saved = await readCoachOfflineResources(user.id, context).catch(() => null)
    const cachedMatches = normalizeCachedMatches(saved?.resources?.matchDayList)
    const cachedPlayers = Array.isArray(saved?.resources?.matchDayPlayers) ? saved.resources.matchDayPlayers : []
    const hasCachedData = Array.isArray(saved?.resources?.matchDayList) || Array.isArray(saved?.resources?.matchDayPlayers)
    if (hasCachedData) {
      setMatches(getLinkableCoachFormationMatches(cachedMatches, { teamId: user.activeTeamId }))
      setPlayers(cachedPlayers)
      setStale(true)
      setLoading(false)
    }
    try {
      const [nextMatches, nextPlayers] = await Promise.all([
        readMobileResource(user, 'coach:match-list', () => getCoachMatchDayList(user), { force: refresh }),
        readMobileResource(user, 'coach:players', () => getCoachPlayerList(user), { force: refresh }),
      ])
      const ordered = getLinkableCoachFormationMatches(nextMatches, { teamId: user.activeTeamId })
      setMatches(ordered)
      setPlayers(nextPlayers)
      setStale(false)
      await saveCoachOfflineResources(user.id, context, { matchDayList: ordered, matchDayPlayers: nextPlayers })
    } catch (loadError) {
      if (!hasCachedData) setError(getCoachFriendlyError(loadError, 'The Formation Board workspace could not be loaded.'))
    } finally { setLoading(false) }
  }, [context, user])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (quickAction?.route === 'formation') onQuickActionHandled?.()
  }, [onQuickActionHandled, quickAction])

  return (
    <View style={styles.stack}>
      {error ? <View style={styles.warning}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}><Text style={styles.secondaryText}>Try again</Text></Pressable></View> : null}
      {stale ? <View style={styles.warning}><Text style={styles.body}>The last encrypted Team data is available to view. Saving, linking and publishing stay blocked until the connection refreshes.</Text></View> : null}
      {loading ? <View style={styles.loading}><BrandLoader /><Text style={styles.body}>Loading Formation Board...</Text></View> : null}
      {!loading && !error ? <CoachFormationBoard context={context} matches={matches} palette={palette} players={players} stale={stale} user={user} /> : null}
    </View>
  )
}
