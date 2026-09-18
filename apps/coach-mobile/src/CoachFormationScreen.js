import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { getCoachMatchDayList, normalizeCoachMatchDay } from '../../mobile-core/src/coachMatchDayData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { CoachFormationBoard } from './CoachFormationBoard'
import { getCoachFormationAuthorityScope, getLinkableCoachFormationMatches } from './coachFormationEntryCore'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'
import { readMobileResource } from '../../mobile-core/src/mobileResourceCache'

import { CoachFormationWorkspaceContext } from './coachFormationWorkspaceContext'

function createStyles(palette) {
  return StyleSheet.create({
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 21 },
    back: { alignItems: 'center', alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, paddingHorizontal: 4 },
    backText: { color: palette.textPrimary, fontSize: 14, fontWeight: '700' },
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

export function CoachFormationScreen({ context, onBack, onMarkerGestureEnd, onMarkerGestureStart, onQuickActionHandled, palette, quickAction, registerBackHandler, user }) {
  const inWorkspace = useContext(CoachFormationWorkspaceContext)
  const styles = useMemo(() => createStyles(palette), [palette])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState([])
  const [players, setPlayers] = useState([])
  const [readyScope, setReadyScope] = useState('')
  const [stale, setStale] = useState(false)
  const authorityScope = getCoachFormationAuthorityScope(user, context)
  const loadSequence = useRef(0)
  const propsRef = useRef({ context, user })
  useEffect(() => {
    propsRef.current = { context, user }
  }, [context, user])

  const load = useCallback(async ({ refresh = false } = {}) => {
    const request = ++loadSequence.current
    const isCurrent = () => request === loadSequence.current
    const { context: currentContext, user: currentUser } = propsRef.current
    await Promise.resolve()
    if (!isCurrent()) return
    setLoading(true)
    setError('')
    setReadyScope('')
    setStale(false)
    const remoteResult = Promise.all([
      readMobileResource(currentUser, 'coach:match-list', () => getCoachMatchDayList(currentUser), { force: refresh }),
      readMobileResource(currentUser, 'coach:players', () => getCoachPlayerList(currentUser), { force: refresh }),
    ]).then(value => ({ value }), error => ({ error }))
    const saved = await readCoachOfflineResources(currentUser.id, currentContext).catch(() => null)
    if (!isCurrent()) return
    const cachedMatches = normalizeCachedMatches(saved?.resources?.matchDayList)
    const cachedPlayers = Array.isArray(saved?.resources?.matchDayPlayers) ? saved.resources.matchDayPlayers : []
    const hasCachedData = Array.isArray(saved?.resources?.matchDayList) || Array.isArray(saved?.resources?.matchDayPlayers)
    if (hasCachedData) {
      setMatches(getLinkableCoachFormationMatches(cachedMatches, { teamId: currentUser.activeTeamId }))
      setPlayers(cachedPlayers)
      setReadyScope(authorityScope)
      setStale(true)
      setLoading(false)
    }
    const result = await remoteResult
    if (!isCurrent()) return
    if (result.value) {
      const [nextMatches, nextPlayers] = result.value
      const ordered = getLinkableCoachFormationMatches(nextMatches, { teamId: currentUser.activeTeamId })
      setMatches(ordered)
      setPlayers(nextPlayers)
      setReadyScope(authorityScope)
      setStale(false)
      setLoading(false)
      await saveCoachOfflineResources(currentUser.id, currentContext, { matchDayList: ordered, matchDayPlayers: nextPlayers }).catch(() => {})
    } else {
      if (!hasCachedData) {
        setReadyScope(authorityScope)
        setError(getCoachFriendlyError(result.error, 'The Formation Board workspace could not be loaded.'))
      }
      setLoading(false)
    }
  }, [authorityScope])

  useEffect(() => {
    const requests = loadSequence
    const timer = setTimeout(() => void load(), 0)
    return () => {
      clearTimeout(timer)
      ++requests.current
    }
  }, [load])
  useEffect(() => {
    if (quickAction?.route === 'formation') onQuickActionHandled?.()
  }, [onQuickActionHandled, quickAction])

  const boardRendered = readyScope === authorityScope && !error

  return (
    <View style={[styles.stack, inWorkspace && { flex: 1 }]}>
      {!boardRendered && onBack && !inWorkspace ? <Pressable accessibilityLabel="Back from Formation Board" accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>Back</Text></Pressable> : null}
      {readyScope === authorityScope && error ? <View style={styles.warning}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}><Text style={styles.secondaryText}>Try again</Text></Pressable></View> : null}
      {readyScope === authorityScope && stale && !inWorkspace ? <View style={styles.warning}><Text style={styles.body}>The last encrypted Team data is available to view. Saving, linking and publishing stay blocked until the connection refreshes.</Text></View> : null}
      {readyScope !== authorityScope && loading ? <View style={styles.loading}><BrandLoader /><Text style={styles.body}>Loading Formation Board...</Text></View> : null}
      {boardRendered ? <CoachFormationBoard context={context} matches={matches} onBack={onBack} onMarkerGestureEnd={onMarkerGestureEnd} onMarkerGestureStart={onMarkerGestureStart} palette={palette} players={players} registerBackHandler={registerBackHandler} stale={stale} user={user} /> : null}
    </View>
  )
}
