import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { completeMobileSession, getMobileSession, getMobileSessionPlayers } from '../lib/data'
import { colors, spacing } from '../theme'
import { AssessPlayerScreen } from './AssessPlayerScreen'
import { PlayerProfileScreen } from './PlayerProfileScreen'

export function SessionDetailScreen({ initialSession, onBack, user }) {
  const [session, setSession] = useState(initialSession)
  const [players, setPlayers] = useState([])
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [assessmentPlayer, setAssessmentPlayer] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadSession = async () => {
    setIsLoading(true)
    setError('')

    try {
      const nextSession = await getMobileSession(user, initialSession.id)
      const nextPlayers = await getMobileSessionPlayers(user, nextSession)
      setSession(nextSession)
      setPlayers(nextPlayers)
    } catch (loadError) {
      console.error(loadError)
      setError(loadError.message || 'Could not load session.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setIsLoading(true)
      setError('')

      try {
        const nextSession = await getMobileSession(user, initialSession.id)
        const nextPlayers = await getMobileSessionPlayers(user, nextSession)
        if (isMounted) {
          setSession(nextSession)
          setPlayers(nextPlayers)
        }
      } catch (loadError) {
        console.error(loadError)
        if (isMounted) {
          setError(loadError.message || 'Could not load session.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      isMounted = false
    }
  }, [initialSession.id, user])

  const assessedCount = players.filter((player) => player.isAssessed).length
  const progressLabel = `${assessedCount} of ${players.length} assessed`
  const sessionCompleted = session.status === 'completed'
  const canCompleteSession = Number(user?.roleRank || 0) >= 50 && !sessionCompleted

  const handleCompleteSession = async () => {
    setIsSaving(true)
    setError('')
    setMessage('')

    try {
      const completedSession = await completeMobileSession(user, session.id)
      setSession(completedSession)
      setMessage('Session completed.')
    } catch (completeError) {
      console.error(completeError)
      setError(completeError.message || 'Could not complete session.')
    } finally {
      setIsSaving(false)
    }
  }

  if (assessmentPlayer) {
    return (
      <AssessPlayerScreen
        onBack={() => setAssessmentPlayer(null)}
        onSaved={() => {
          setAssessmentPlayer(null)
          void loadSession()
        }}
        player={assessmentPlayer}
        session={session}
        user={user}
      />
    )
  }

  if (selectedPlayer) {
    return (
      <PlayerProfileScreen
        initialPlayer={selectedPlayer}
        onBack={() => setSelectedPlayer(null)}
        onChanged={(updatedPlayer) => {
          setPlayers((current) => current.map((player) => (player.id === updatedPlayer.id ? updatedPlayer : player)))
          setSelectedPlayer(updatedPlayer)
        }}
        user={user}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.webWrap}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.topbar}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={styles.topbarTitle}>Session</Text>
          </View>

          <View style={styles.shell}>
            <View style={styles.pageHeader}>
              <Text style={styles.kicker}>{session.sessionType}</Text>
              <Text style={styles.title}>{session.title}</Text>
              <Text style={styles.description}>{[session.team, session.opponent ? `vs ${session.opponent}` : '', session.sessionDate].filter(Boolean).join(' | ')}</Text>
              <View style={styles.progressRow}>
                <Text style={styles.statusPill}>{sessionCompleted ? 'Completed' : 'Open'}</Text>
                <Text style={styles.progressText}>{progressLabel}</Text>
              </View>
            </View>

            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Loading session players...</Text>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}

            {!isLoading && !error ? (
              <View style={styles.list}>
                {canCompleteSession ? (
                  <View style={styles.sessionActionCard}>
                    <View style={styles.sessionActionText}>
                      <Text style={styles.sessionActionTitle}>Complete session</Text>
                      <Text style={styles.sessionActionDescription}>Mark this session complete when assessments are finished.</Text>
                    </View>
                    <Button disabled={isSaving} onPress={handleCompleteSession} variant="secondary">
                      {isSaving ? 'Completing...' : 'Complete'}
                    </Button>
                  </View>
                ) : null}
                {players.map((player) => (
                  <View key={player.id} style={styles.playerCard}>
                    <Pressable onPress={() => setSelectedPlayer(player)} style={styles.playerInfo}>
                      <View style={styles.playerHeader}>
                        <Text style={styles.playerName}>{player.playerName}</Text>
                        <Text style={[styles.playerBadge, player.isAssessed ? styles.playerBadgeDone : null]}>
                          {player.isAssessed ? 'Assessed' : 'Pending'}
                        </Text>
                      </View>
                      <Text style={styles.playerMeta}>{[player.section, player.positions].filter(Boolean).join(' | ')}</Text>
                      {player.isAssessed ? (
                        <Text style={styles.playerMeta}>
                          Score {player.averageScore !== null ? Number(player.averageScore).toFixed(1) : '-'} | {player.assessmentStatus || 'Submitted'}
                        </Text>
                      ) : null}
                    </Pressable>
                    <Button disabled={sessionCompleted} onPress={() => setAssessmentPlayer(player)}>
                      {player.isAssessed ? 'Reassess' : 'Assess'}
                    </Button>
                  </View>
                ))}
                {players.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No players found</Text>
                    <Text style={styles.emptyText}>Add players to this team before assessing the session.</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  backText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  emptyCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 21,
    marginVertical: 18,
  },
  message: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 20,
    marginTop: 12,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  list: {
    gap: 12,
    marginTop: 12,
  },
  loading: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    marginTop: 12,
    padding: spacing.card,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  pageHeader: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  playerCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: spacing.card,
  },
  playerBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    textTransform: 'uppercase',
  },
  playerBadgeDone: {
    color: colors.accent,
  },
  playerHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  playerInfo: {
    gap: 5,
  },
  playerMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  playerName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  progressText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    padding: Platform.OS === 'web' ? 10 : 0,
    paddingBottom: 36,
  },
  shell: {
    backgroundColor: colors.shell,
    borderColor: colors.border,
    borderRadius: Platform.OS === 'web' ? 8 : 0,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    padding: 12,
  },
  sessionActionCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: spacing.card,
  },
  sessionActionDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  sessionActionText: {
    flex: 1,
  },
  sessionActionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  statusPill: {
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.accent,
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 6,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 31,
    marginTop: 9,
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  topbarTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  webWrap: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: Platform.OS === 'web' ? 460 : undefined,
    width: '100%',
  },
})
