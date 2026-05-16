import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button } from '../components/Button'
import { TextField } from '../components/TextField'
import { createMobilePlayer, getMobileTeams } from '../lib/data'
import { colors, spacing } from '../theme'

const initialForm = {
  playerName: '',
  section: 'Trial',
  team: '',
  parentName: '',
  parentEmail: '',
  positions: '',
  notes: '',
}

function SegmentedOption({ active, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active ? styles.segmentActive : null]}>
      <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{label}</Text>
    </Pressable>
  )
}

export function AddPlayerScreen({ onBack, onCreated, user }) {
  const [form, setForm] = useState(initialForm)
  const [teams, setTeams] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadTeams = async () => {
      setIsLoading(true)
      setError('')

      try {
        const nextTeams = await getMobileTeams(user)
        if (isMounted) {
          setTeams(nextTeams)
          setForm((current) => ({
            ...current,
            team: current.team || nextTeams[0]?.name || '',
          }))
        }
      } catch (loadError) {
        console.error(loadError)
        if (isMounted) {
          setError(loadError.message || 'Could not load teams.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadTeams()

    return () => {
      isMounted = false
    }
  }, [user])

  const updateField = (field, value) => {
    setMessage('')
    setError('')
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async () => {
    setIsSaving(true)
    setMessage('')
    setError('')

    try {
      const createdPlayer = await createMobilePlayer(user, form)
      setMessage(`${createdPlayer.playerName} has been added.`)
      setForm({
        ...initialForm,
        section: form.section,
        team: form.team,
      })
      onCreated?.(createdPlayer)
    } catch (saveError) {
      console.error(saveError)
      setError(saveError.message || 'Could not add player.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.webWrap}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topbar}>
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={styles.topbarTitle}>Add Player</Text>
          </View>

          <View style={styles.shell}>
            <View style={styles.pageHeader}>
              <Text style={styles.kicker}>Players</Text>
              <Text style={styles.title}>Add Player</Text>
              <Text style={styles.description}>Add the player once, then start assessments from the player profile.</Text>
            </View>

            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Loading player setup...</Text>
              </View>
            ) : (
              <View style={styles.formCard}>
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

                {message ? <Text style={styles.message}>{message}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Button disabled={isSaving || !form.playerName.trim() || !form.team} onPress={handleSubmit}>
                  {isSaving ? 'Adding...' : 'Add Player'}
                </Button>
              </View>
            )}
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
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 20,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  formCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    marginTop: 12,
    padding: spacing.card,
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
