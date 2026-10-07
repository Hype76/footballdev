import { MobileSwitch as Switch } from './MobileSwitch.js'
import { useEffect, useState } from 'react'
import { AppState, Linking, Pressable, Text, TextInput, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { normalizeTeamLeagueUrl } from '../../../src/lib/team-league-link.js'
import { useTeamLeagueLink } from './useTeamLeagueLink'

function useLeagueForegroundRefresh(load) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void load() })
    return () => subscription.remove()
  }, [load])
}

export function TeamLeagueLinkRow({ client, scope, palette, styles, coach = false }) {
  const league = useTeamLeagueLink(client, scope)
  useLeagueForegroundRefresh(league.load)
  if (!league.value?.enabled || !league.value.url || league.status !== 'ready') return null
  const text = palette.textPrimary || palette.text
  const accent = palette.accentText || palette.accent
  return <View>
    <Pressable accessibilityRole="link" accessibilityLabel={`Current league for ${league.value.teamName || 'this team'}`} accessibilityHint="Opens the league website in your browser" onPress={() => { void league.open(Linking) }} style={({ pressed }) => [coach ? styles.homeNextRow : [styles.compactRow, { minHeight: 64, paddingVertical: 8, borderBottomColor: palette.border, borderBottomWidth: 1 }], pressed && styles.pressed]}>
      <MaterialIcons accessible={false} color={coach ? accent : text} name="public" size={coach ? 30 : 31} />
      <View style={coach ? styles.homeNextCopy : styles.compactCopy}>
        <Text style={coach ? styles.iconEyebrow : styles.cardTitle}>Current league</Text>
        {coach ? <><Text numberOfLines={1} style={styles.homeNextValue}>View league website</Text><Text numberOfLines={1} style={styles.iconMeta}>{league.value.teamName}</Text></> : <Text style={styles.cardMeta}>{league.value.teamName} · View league website</Text>}
      </View>
      <MaterialIcons accessible={false} color={accent} name="chevron-right" size={22} />
    </Pressable>
    {league.error ? <Text accessibilityLiveRegion="polite" style={{ color: palette.danger, lineHeight: 20 }}>{league.error}</Text> : null}
  </View>
}

export function TeamLeagueLinkSettings({ client, scope, palette }) {
  const league = useTeamLeagueLink(client, scope)
  const [draft, setDraft] = useState(null)
  const [message, setMessage] = useState('')
  useLeagueForegroundRefresh(league.load)
  const values = draft || { url: league.value?.url || '', enabled: league.value?.enabled === true }
  const canEdit = league.value?.canEdit === true && league.status === 'ready'
  const change = patch => { setMessage(''); setDraft({ ...values, ...patch }) }
  const save = async () => {
    try { normalizeTeamLeagueUrl(values.url) } catch (error) { setMessage(error.message); return }
    if (await league.save(values)) { setDraft(null); setMessage('League link saved.') }
  }
  const text = palette.textPrimary || palette.text
  const muted = palette.textSecondary || palette.textMuted
  if (!scope.teamId || !scope.userId) return null
  return <View style={{ gap: 10 }}>
    <Text style={{ color: text, fontSize: 18, fontWeight: '700' }}>Current league</Text>
    <Text style={{ color: muted, lineHeight: 20 }}>One league website for this team. Turn it off to hide the link for Coaches, Parents and Players while keeping the saved address.</Text>
    {league.status === 'loading' ? <Text style={{ color: muted }}>Loading league link...</Text> : null}
    {league.value?.canEdit ? <>
      <TextInput accessibilityLabel="Current league website URL" autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={canEdit} maxLength={2048} onChangeText={url => change({ url })} placeholder="https://" placeholderTextColor={muted} style={{ borderBottomColor: palette.border, borderBottomWidth: 1, color: text, minHeight: 44, paddingVertical: 8 }} value={values.url} />
      <View style={{ alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 }}>
        <Text style={{ color: text, fontWeight: '600' }}>Show league link</Text><Switch accessibilityLabel="Show league link" disabled={!canEdit} onValueChange={enabled => change({ enabled })} value={values.enabled} />
      </View>
      <Pressable accessibilityRole="button" disabled={!canEdit} onPress={() => { void save() }} style={{ alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 }}><Text style={{ color: palette.accentText || palette.accent, fontWeight: '700' }}>{league.status === 'saving' ? 'Saving...' : 'Save league link'}</Text></Pressable>
    </> : league.status === 'ready' ? <Text style={{ color: muted }}>Only an assigned Team Admin can change this team's league link.</Text> : null}
    {league.error || message ? <Text accessibilityLiveRegion="polite" style={{ color: league.error ? palette.danger : text, lineHeight: 20 }}>{league.error || message}</Text> : null}
    {league.status === 'error' ? <Pressable accessibilityRole="button" onPress={() => { void league.load() }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: palette.accentText || palette.accent }}>Retry league link</Text></Pressable> : null}
  </View>
}
