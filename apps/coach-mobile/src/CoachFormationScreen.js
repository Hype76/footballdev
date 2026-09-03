import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { getCoachMatchDayList, normalizeCoachMatchDay } from '../../mobile-core/src/coachMatchDayData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { CoachFormationBoard } from './CoachFormationBoard'
import { getLinkableCoachFormationMatches } from './coachFormationEntryCore'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

function createStyles(palette) {
  return StyleSheet.create({
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 21 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, gap: 8, padding: 14 },
    error: { color: palette.danger, fontSize: 14, fontWeight: '800', lineHeight: 21 },
    heading: { color: palette.textPrimary, fontSize: 29, fontWeight: '900', letterSpacing: -0.5 },
    kicker: { color: palette.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 13, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14, paddingVertical: 10 },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    stack: { gap: 12 },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 15, borderWidth: 1, gap: 8, padding: 13 },
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

  const load = useCallback(async () => {
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
      const [nextMatches, nextPlayers] = await Promise.all([getCoachMatchDayList(user), getCoachPlayerList(user)])
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
      <View style={styles.stack}>
        <Text style={styles.kicker}>Quick action</Text>
        <Text accessibilityRole="header" style={styles.heading}>Formation Board</Text>
        <Text style={styles.body}>Create a standalone Team plan now. Link it to a match or publish it to Team Resources only when you are ready.</Text>
      </View>

      {error ? <View style={styles.warning}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}><Text style={styles.secondaryText}>Try again</Text></Pressable></View> : null}
      {stale ? <View style={styles.warning}><Text style={styles.body}>The last encrypted Team data is available to view. Saving, linking and publishing stay blocked until the connection refreshes.</Text></View> : null}
      {loading ? <View style={styles.card}><BrandLoader /><Text style={styles.body}>Loading Formation Board...</Text></View> : null}
      {!loading && !error ? <CoachFormationBoard context={context} matches={matches} palette={palette} players={players} stale={stale} user={user} /> : null}
    </View>
  )
}
