import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { getCoachMatchDayDetail, getCoachMatchDayList, normalizeCoachMatchDay } from '../../mobile-core/src/coachMatchDayData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { CoachFormationBoard } from './CoachFormationBoard'
import { selectPreferredCoachFormationMatch, sortCoachFormationMatches } from './coachFormationEntryCore'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

function createStyles(palette) {
  return StyleSheet.create({
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 21 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, gap: 6, padding: 14 },
    cardSelected: { backgroundColor: palette.selected, borderColor: palette.accent, borderWidth: 2 },
    error: { color: palette.danger, fontSize: 14, fontWeight: '800', lineHeight: 21 },
    heading: { color: palette.textPrimary, fontSize: 29, fontWeight: '900', letterSpacing: -0.5 },
    kicker: { color: palette.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
    matchDate: { color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    matchTitle: { color: palette.textPrimary, fontSize: 16, fontWeight: '900' },
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
  const [match, setMatch] = useState(null)
  const [matches, setMatches] = useState([])
  const [players, setPlayers] = useState([])
  const [showMatches, setShowMatches] = useState(true)
  const [stale, setStale] = useState(false)

  const open = useCallback(async (summary, availableMatches = [], availablePlayers = []) => {
    if (!summary?.id) return
    setLoading(true)
    setError('')
    try {
      const detail = await getCoachMatchDayDetail(user, summary.id)
      setMatch(detail)
      setShowMatches(false)
      setStale(false)
      await saveCoachOfflineResources(user.id, context, { matchDayDetail: detail, matchDayList: availableMatches, matchDayPlayers: availablePlayers })
    } catch (openError) {
      const saved = await readCoachOfflineResources(user.id, context).catch(() => null)
      if (saved?.resources?.matchDayDetail?.id === summary.id) {
        setMatch(normalizeCoachMatchDay(saved.resources.matchDayDetail))
        setShowMatches(false)
        setStale(true)
      } else setError(String(openError?.message || 'That fixture could not be opened for formation planning.'))
    } finally { setLoading(false) }
  }, [context, user])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextMatches, nextPlayers] = await Promise.all([getCoachMatchDayList(user), getCoachPlayerList(user)])
      const ordered = sortCoachFormationMatches(nextMatches)
      setMatches(ordered)
      setPlayers(nextPlayers)
      setStale(false)
      const preferred = selectPreferredCoachFormationMatch(ordered)
      if (preferred) await open(preferred, ordered, nextPlayers)
      else setShowMatches(true)
    } catch (loadError) {
      const saved = await readCoachOfflineResources(user.id, context).catch(() => null)
      const cachedMatches = normalizeCachedMatches(saved?.resources?.matchDayList)
      const cachedPlayers = Array.isArray(saved?.resources?.matchDayPlayers) ? saved.resources.matchDayPlayers : []
      if (cachedMatches.length) {
        setMatches(sortCoachFormationMatches(cachedMatches))
        setPlayers(cachedPlayers)
        setMatch(saved?.resources?.matchDayDetail ? normalizeCoachMatchDay(saved.resources.matchDayDetail) : null)
        setShowMatches(!saved?.resources?.matchDayDetail)
        setStale(true)
      } else setError(String(loadError?.message || 'Formation fixtures could not be loaded.'))
    } finally { setLoading(false) }
  }, [context, open, user])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (quickAction?.route === 'formation') onQuickActionHandled?.()
  }, [onQuickActionHandled, quickAction])

  return (
    <View style={styles.stack}>
      <View style={styles.stack}>
        <Text style={styles.kicker}>Quick action</Text>
        <Text accessibilityRole="header" style={styles.heading}>Formation Board</Text>
        <Text style={styles.body}>Build the next lineup without opening the full Match Day workspace.</Text>
      </View>

      {error ? <View style={styles.warning}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}><Text style={styles.secondaryText}>Try again</Text></Pressable></View> : null}
      {stale ? <View style={styles.warning}><Text style={styles.matchTitle}>Offline read</Text><Text style={styles.body}>The last encrypted formation is available to view. Saving and sharing stay blocked until the connection refreshes.</Text></View> : null}

      {match && !showMatches ? (
        <Pressable accessibilityRole="button" onPress={() => setShowMatches(true)} style={[styles.card, styles.cardSelected]}>
          <Text style={styles.matchDate}>Planning for</Text>
          <Text style={styles.matchTitle}>{match.teamName} v {match.opponent}</Text>
          <Text style={styles.body}>{match.matchDate} | {match.kickoffTimeTbc ? 'Kick-off TBC' : match.kickoffTime || 'Time TBC'} | Tap to change fixture</Text>
        </Pressable>
      ) : null}

      {showMatches ? (
        <View style={styles.stack}>
          <Text style={styles.matchTitle}>Choose fixture</Text>
          {matches.map((item) => (
            <Pressable accessibilityRole="button" key={item.id} onPress={() => void open(item, matches, players)} style={[styles.card, match?.id === item.id && styles.cardSelected]}>
              <Text style={styles.matchDate}>{item.matchDate || 'Date TBC'} | {item.status}</Text>
              <Text style={styles.matchTitle}>{item.teamName} v {item.opponent}</Text>
            </Pressable>
          ))}
          {!loading && matches.length === 0 ? <Text style={styles.body}>No Match Day fixture is available for this Team.</Text> : null}
        </View>
      ) : null}

      {loading ? <View style={styles.card}><ActivityIndicator color={palette.accent} /><Text style={styles.body}>Loading formation workspace...</Text></View> : null}
      {match && !showMatches && !loading ? <CoachFormationBoard context={context} match={match} palette={palette} players={players} stale={stale} user={user} /> : null}
    </View>
  )
}
