import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'
import { archiveMobilePlayer, getMobilePlayer, getMobilePreviousEvaluations, getMobileTeams, updateMobilePlayer } from '../lib/data'
import { colors, spacing } from '../theme'
import { AssessPlayerScreen } from './AssessPlayerScreen'

function makeForm(player) {
  return {
    playerName: player?.playerName || '',
    section: player?.section || 'Trial',
    team: player?.team || '',
    parentName: player?.parentName || '',
    parentEmail: player?.parentEmail || '',
    positions: player?.positions || '',
    notes: player?.notes || '',
  }
}

function SegmentedOption({ active, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active ? styles.segmentActive : null]}>
      <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{label}</Text>
    </Pressable>
  )
}

export function PlayerProfileScreen({ initialPlayer, onBack, onChanged, user }) {
  const [player, setPlayer] = useState(initialPlayer)
  const [form, setForm] = useState(() => makeForm(initialPlayer))
  const [teams, setTeams] = useState([])
  const [evaluations, setEvaluations] = useState([])
  const [isEditing, setIsEditing] = useState(false)
  const [isAssessing, setIsAssessing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      setIsLoading(true)
      setError('')

      try {
        const [nextPlayer, nextTeams, nextEvaluations] = await Promise.all([
          getMobilePlayer(user, initialPlayer.id),
          getMobileTeams(user),
          getMobilePreviousEvaluations(user, initialPlayer),
        ])
        if (isMounted) {
          setPlayer(nextPlayer)
          setForm(makeForm(nextPlayer))
          setTeams(nextTeams)
          setEvaluations(nextEvaluations)
        }
      } catch (loadError) {
        console.error(loadError)
        if (isMounted) {
          setError(loadError.message || 'Could not load player profile.')
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
  }, [initialPlayer.id, user])

  const updateField = (field, value) => {
    setMessage('')
    setError('')
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      const updated = await updateMobilePlayer(user, player.id, form)
      setPlayer(updated)
      setForm(makeForm(updated))
      setIsEditing(false)
      setMessage('Player profile saved.')
      onChanged?.(updated)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Could not save player profile.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setForm(makeForm(player))
    setIsEditing(false)
    setError('')
    setMessage('')
  }

  const handleArchive = async () => {
    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      const updated = await archiveMobilePlayer(user, player.id)
      setPlayer(updated)
      setMessage('Player archived.')
      onChanged?.(updated)
    } catch (archiveError) {
      console.error(archiveError)
      setError(archiveError.message || 'Could not archive player.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isAssessing) {
    return (
      <AssessPlayerScreen
        onBack={() => setIsAssessing(false)}
        onSaved={(_saved, nextEvaluations) => setEvaluations(nextEvaluations)}
        player={player}
        user={user}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.webWrap}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topbar}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={styles.topbarTitle}>Player Profile</Text>
          </View>

          <View style={styles.shell}>
            <View style={styles.pageHeader}>
              <Text style={styles.kicker}>{player?.section || 'Player'}</Text>
              <Text style={styles.title}>{player?.playerName || 'Player Profile'}</Text>
              <Text style={styles.description}>{[player?.team, player?.positions].filter(Boolean).join(' | ') || 'Player details'}</Text>
            </View>

            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Loading profile...</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {isEditing ? (
                  <>
                    <TextField
                      autoCapitalize="words"
                      label="Player Name"
                      onChangeText={(value) => updateField('playerName', value)}
                      placeholder="Player name"
                      value={form.playerName}
                    />

                    <View>
                      <Text style={styles.fieldLabel}>Section</Text>
                      <View style={styles.segmentWrap}>
                        <SegmentedOption active={form.section === 'Trial'} label="Trial" onPress={() => updateField('section', 'Trial')} />
                        <SegmentedOption active={form.section === 'Squad'} label="Squad" onPress={() => updateField('section', 'Squad')} />
                      </View>
                    </View>

                    <View>
                      <Text style={styles.fieldLabel}>Team</Text>
                      <View style={styles.teamList}>
                        {teams.map((team) => (
                          <Pressable
                            key={team.id}
                            onPress={() => updateField('team', team.name)}
                            style={[styles.teamOption, form.team === team.name ? styles.teamOptionActive : null]}
                          >
                            <Text style={[styles.teamOptionText, form.team === team.name ? styles.teamOptionTextActive : null]}>{team.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>

                    <TextField
                      autoCapitalize="words"
                      label="Parent or Guardian Name"
                      onChangeText={(value) => updateField('parentName', value)}
                      placeholder="Contact name"
                      value={form.parentName}
                    />
                    <TextField
                      keyboardType="email-address"
                      label="Parent or Guardian Email"
                      onChangeText={(value) => updateField('parentEmail', value)}
                      placeholder="parent@example.com"
                      value={form.parentEmail}
                    />
                    <TextField
                      autoCapitalize="characters"
                      label="Player Positions"
                      onChangeText={(value) => updateField('positions', value)}
                      placeholder="CM, RW"
                      value={form.positions}
                    />
                    <TextField
                      autoCapitalize="sentences"
                      label="Notes"
                      onChangeText={(value) => updateField('notes', value)}
                      placeholder="Optional notes"
                      value={form.notes}
                    />
                  </>
                ) : (
                  <>
                    <InfoBlock label="Team" value={player?.team || 'Not set'} />
                    <InfoBlock label="Section" value={player?.section || 'Trial'} />
                    <InfoBlock label="Positions" value={player?.positions || 'Not set'} />
                    <InfoBlock label="Contact" value={[player?.parentName, player?.parentEmail].filter(Boolean).join(' | ') || 'Not set'} />
                    <InfoBlock label="Notes" value={player?.notes || 'No notes yet.'} />
                  </>
                )}

                {message ? <Text style={styles.message}>{message}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}

                {isEditing ? (
                  <View style={styles.actions}>
                    <Button disabled={isSaving || !form.playerName.trim() || !form.team} onPress={handleSave}>
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button disabled={isSaving} onPress={handleCancel} variant="secondary">
                      Cancel
                    </Button>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    <Button onPress={() => setIsAssessing(true)}>Assess Player</Button>
                    <Button onPress={() => setIsEditing(true)} variant="secondary">Edit Player</Button>
                    <Button disabled={isSaving || player?.status === 'archived'} onPress={handleArchive} variant="secondary">Archive Player</Button>
                  </View>
                )}
              </View>
            )}

            {!isLoading && !isEditing ? (
              <View style={styles.card}>
                <View>
                  <Text style={styles.historyTitle}>Assessment History</Text>
                  <Text style={styles.historyDescription}>
                    {evaluations.length > 0
                      ? `${evaluations.length} recent assessment${evaluations.length === 1 ? '' : 's'} for this player.`
                      : 'No assessments have been saved for this player yet.'}
                  </Text>
                </View>
                {evaluations.map((evaluation) => (
                  <EvaluationCard evaluation={evaluation} key={evaluation.id} />
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

function InfoBlock({ label, value }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function getEvaluationItems(evaluation) {
  const responses = evaluation.formResponses && Object.keys(evaluation.formResponses).length > 0
    ? evaluation.formResponses
    : {
        ...evaluation.scores,
        Strengths: evaluation.comments?.strengths,
        Improvements: evaluation.comments?.improvements,
        'Overall Comments': evaluation.comments?.overall,
      }

  return Object.entries(responses)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .slice(0, 5)
}

function EvaluationCard({ evaluation }) {
  const items = getEvaluationItems(evaluation)

  return (
    <View style={styles.evaluationCard}>
      <View style={styles.evaluationHeader}>
        <View style={styles.evaluationHeaderText}>
          <Text style={styles.evaluationDate}>{evaluation.date || 'No date entered'}</Text>
          <Text style={styles.evaluationMeta}>{[evaluation.session, evaluation.coach, evaluation.status].filter(Boolean).join(' | ')}</Text>
        </View>
        <Text style={styles.evaluationScore}>{evaluation.averageScore !== null ? Number(evaluation.averageScore).toFixed(1) : '-'}</Text>
      </View>
      {items.length > 0 ? (
        <View style={styles.evaluationItems}>
          {items.map(([label, value]) => (
            <View key={label} style={styles.evaluationItem}>
              <Text style={styles.evaluationItemLabel}>{label}</Text>
              <Text style={styles.evaluationItemValue}>{String(value)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.evaluationEmpty}>No assessment details were entered.</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  actions: {
    gap: 10,
  },
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
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    marginTop: 12,
    padding: spacing.card,
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 20,
  },
  evaluationCard: {
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  evaluationDate: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  evaluationEmpty: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  evaluationHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  evaluationHeaderText: {
    flex: 1,
  },
  evaluationItem: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  evaluationItemLabel: {
    color: colors.secondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  evaluationItemValue: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  evaluationItems: {
    gap: 8,
    marginTop: 10,
  },
  evaluationMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  evaluationScore: {
    color: colors.accent,
    fontSize: 18,
    fontWeight: '900',
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  historyDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  historyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  infoBlock: {
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  infoLabel: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
    marginTop: 6,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
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
  message: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 20,
  },
  pageHeader: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.card,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    padding: Platform.OS === 'web' ? 10 : 0,
    paddingBottom: 36,
  },
  segment: {
    alignItems: 'center',
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.sidebarActive,
    borderColor: colors.accent,
  },
  segmentText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: colors.text,
  },
  segmentWrap: {
    flexDirection: 'row',
    gap: 10,
  },
  shell: {
    backgroundColor: colors.shell,
    borderColor: colors.border,
    borderRadius: Platform.OS === 'web' ? 8 : 0,
    borderWidth: Platform.OS === 'web' ? 1 : 0,
    padding: 12,
  },
  teamList: {
    gap: 8,
  },
  teamOption: {
    backgroundColor: colors.panelAlt,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  teamOptionActive: {
    backgroundColor: colors.sidebarActive,
    borderColor: colors.accent,
  },
  teamOptionText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  teamOptionTextActive: {
    color: colors.text,
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
