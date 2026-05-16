import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { getMobilePlayers, getMobileSessions, getMobileTeams } from '../lib/data'
import { colors, spacing } from '../theme'
import { AssessPlayerScreen } from './AssessPlayerScreen'
import { PlayerProfileScreen } from './PlayerProfileScreen'
import { SessionDetailScreen } from './SessionDetailScreen'

function MetaLine({ children }) {
  if (!children) {
    return null
  }

  return <Text style={styles.meta}>{children}</Text>
}

function SessionRow({ item, onPress }) {
  const detail = [item.team, item.opponent ? `vs ${item.opponent}` : '', item.sessionDate].filter(Boolean).join(' | ')

  return (
    <Pressable onPress={() => onPress(item)} style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}>
      <Text style={styles.rowTitle}>{item.title}</Text>
      <MetaLine>{detail}</MetaLine>
      <Text style={styles.badge}>{item.status}</Text>
    </Pressable>
  )
}

function PlayerRow({ item, onPress }) {
  const detail = [item.section, item.team, item.positions].filter(Boolean).join(' | ')

  return (
    <Pressable onPress={() => onPress(item)} style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}>
      <Text style={styles.rowTitle}>{item.playerName}</Text>
      <MetaLine>{detail}</MetaLine>
      <Text style={styles.badge}>{item.status}</Text>
    </Pressable>
  )
}

function TeamRow({ item }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{item.name}</Text>
      <Text style={styles.badge}>{item.requireApproval ? 'Approval on' : 'Approval off'}</Text>
    </View>
  )
}

export function ListScreen({ routeKey, title, user, onBack }) {
  const [items, setItems] = useState([])
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [assessmentPlayer, setAssessmentPlayer] = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const isSessions = routeKey === 'sessions'
  const isPlayers = routeKey === 'players'
  const isEvaluations = routeKey === 'evaluations'
  const isTeams = routeKey === 'teams'

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setIsLoading(true)
      setError('')

      try {
        const nextItems = isSessions
          ? await getMobileSessions(user)
          : isPlayers || isEvaluations
            ? await getMobilePlayers(user)
            : isTeams
              ? await getMobileTeams(user)
              : []
        if (isMounted) {
          setItems(nextItems)
        }
      } catch (loadError) {
        console.error(loadError)
        if (isMounted) {
          setError(loadError.message || 'This view could not be loaded.')
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
  }, [isEvaluations, isPlayers, isSessions, isTeams, user])

  const isLiveList = isSessions || isPlayers || isEvaluations || isTeams

  if (assessmentPlayer) {
    return <AssessPlayerScreen onBack={() => setAssessmentPlayer(null)} player={assessmentPlayer} user={user} />
  }

  if (selectedPlayer) {
    return (
      <PlayerProfileScreen
        initialPlayer={selectedPlayer}
        onBack={() => setSelectedPlayer(null)}
        onChanged={(updatedPlayer) => {
          setItems((current) => current.map((item) => (item.id === updatedPlayer.id ? updatedPlayer : item)))
          setSelectedPlayer(updatedPlayer)
        }}
        user={user}
      />
    )
  }

  if (selectedSession) {
    return <SessionDetailScreen initialSession={selectedSession} onBack={() => setSelectedSession(null)} user={user} />
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.webWrap}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.topbar}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={styles.topbarTitle}>{title}</Text>
          </View>

          <View style={styles.shell}>
            <View style={styles.pageHeader}>
              <Text style={styles.kicker}>Workspace</Text>
              <Text style={styles.title}>{title}</Text>
            </View>

            {!isLiveList ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Coming next</Text>
                <Text style={styles.emptyText}>This workflow will be matched to the current mobile PWA screen.</Text>
              </View>
            ) : null}

            {isLiveList && isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Loading {title.toLowerCase()}...</Text>
              </View>
            ) : null}

            {isLiveList && error ? <Text style={styles.error}>{error}</Text> : null}

            {isLiveList && !isLoading && !error && items.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No records found</Text>
                <Text style={styles.emptyText}>There are no {title.toLowerCase()} available for this account yet.</Text>
              </View>
            ) : null}

            {isLiveList && items.length > 0 ? (
              <View style={styles.list}>
                {items.map((item) =>
                  isSessions ? (
                    <SessionRow item={item} key={item.id} onPress={setSelectedSession} />
                  ) : isPlayers || isEvaluations ? (
                    <PlayerRow item={item} key={item.id} onPress={isEvaluations ? setAssessmentPlayer : setSelectedPlayer} />
                  ) : (
                    <TeamRow item={item} key={item.id} />
                  ),
                )}
              </View>
            ) : null}

            <Button onPress={onBack} variant="secondary">
              Back To Home
            </Button>
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
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    marginTop: 12,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: 'uppercase',
  },
  emptyCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    marginTop: 14,
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
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  list: {
    gap: 12,
    marginBottom: 14,
    marginTop: 14,
  },
  loading: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    marginVertical: 20,
    padding: spacing.card,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  meta: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  row: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  rowPressed: {
    backgroundColor: colors.sidebarActive,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
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
  pageHeader: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
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
