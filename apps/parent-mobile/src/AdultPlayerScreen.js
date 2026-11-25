import { useEffect, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { getOwnAdultPlayerInvitations, respondToOwnAdultPlayerInvitation } from '../../../src/lib/adult-player-invitations.js'
import { getParentProductDateTimeParts } from '../../mobile-core/src/parentDateTimeCore'
import { createParentMobileTheme } from '../../mobile-core/src/parentThemeCore'
import { supabase } from '../../mobile-core/src/supabase'
import { LoadingScreen } from '../../mobile-core/src/ui'

const labels = {
  match_attendance: ['Available', 'Maybe', 'Unavailable'],
  training_attendance: ['Attending', 'Maybe', 'Not attending'],
  calendar_attendance: ['Attending', 'Maybe', 'Not attending'],
}
const responses = ['available', 'maybe', 'unavailable']

function eventDateLabel(start) {
  const { date, time } = getParentProductDateTimeParts(start)
  const formattedDate = date.split('-').reverse().join(':')
  return [formattedDate, time].filter(Boolean).join(' at ') || 'Date to be confirmed'
}

function PlayerAction({ label, onPress, colors, disabled, selected }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(selected) }}
      disabled={disabled} onPress={onPress} style={[styles.action, selected && { backgroundColor: colors.buttonPrimary }]}>
      <Text style={[styles.actionText, { color: selected ? colors.accentForeground : disabled ? colors.textSecondary : colors.accentText }]}>{label}</Text>
    </Pressable>
  )
}

export function AdultPlayerScreen({ access, onRefresh, onSignOut, onSwitchAccount, switchLabel }) {
  const { link, status } = access
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light'
  const { branding, tokens: colors } = createParentMobileTheme({ mode, selectedLink: link, polished: true })
  const [failedLogo, setFailedLogo] = useState('')
  const [loaded, setLoaded] = useState(null)
  const [pending, setPending] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [actionError, setActionError] = useState('')
  const logo = branding.clubLogoUrl

  useEffect(() => {
    if (status !== 'linked') return
    let current = true
    getOwnAdultPlayerInvitations(supabase).then(items => {
      if (current) setLoaded({ link, items })
    }).catch(error => {
      if (current) setLoaded({ link, error: error.message })
    })
    return () => { current = false }
  }, [link, status])

  const result = status === 'linked' && loaded?.link === link ? loaded : null
  const error = actionError || result?.error || access.message
  const retry = () => {
    setConfirmation('')
    setActionError('')
    onRefresh()
  }

  async function respond(invitation, responseState) {
    setPending(invitation.invitationId)
    setConfirmation('')
    setActionError('')
    try {
      await respondToOwnAdultPlayerInvitation(supabase, { invitation, responseState })
      setConfirmation('Your response has been saved.')
      onRefresh()
    } catch (failure) {
      setActionError(failure.message)
    } finally {
      setPending('')
    }
  }

  if (status === 'checking') return <LoadingScreen message="Loading your club..." />

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        {status === 'linked' && link ? (
          <>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Image accessibilityIgnoresInvertColors resizeMode="contain" style={styles.logo}
                source={logo && failedLogo !== logo ? { uri: logo } : require('../assets/football-player-logo.png')}
                onError={() => setFailedLogo(logo)} />
              <View style={styles.headerCopy}>
                <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{link.clubName}</Text>
                <Text style={[styles.text, { color: colors.textSecondary }]}>{link.teamName}</Text>
              </View>
            </View>
            <Text style={[styles.text, { color: colors.textPrimary }]}>{link.playerName} | Player</Text>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>Your invitations</Text>
            {result?.items?.length === 0 ? <Text style={[styles.text, { color: colors.textSecondary }]}>New match, training and event invitations will appear here.</Text> : null}
            {result?.items?.map(invitation => {
              const options = labels[invitation.invitationType]
              const current = options?.[responses.indexOf(invitation.responseState)] || 'Awaiting response'
              return (
                <View key={invitation.invitationId} style={[styles.row, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{invitation.eventTitle}</Text>
                  <Text style={[styles.text, { color: colors.textSecondary }]}>{eventDateLabel(invitation.eventStart)}</Text>
                  {invitation.eventLocation ? <Text style={[styles.text, { color: colors.textSecondary }]}>{invitation.eventLocation}</Text> : null}
                  <Text style={[styles.text, { color: colors.textPrimary }]}>Response: {current}</Text>
                  {invitation.selectionState === 'selected' ? <Text style={[styles.text, { color: colors.textPrimary }]}>You are selected for this fixture.</Text> : null}
                  {invitation.canRespond && options ? (
                    <View style={styles.actions}>
                      {options.map((label, index) => <PlayerAction key={label} label={label} colors={colors} disabled={Boolean(pending)}
                        selected={invitation.responseState === responses[index]} onPress={() => void respond(invitation, responses[index])} />)}
                    </View>
                  ) : invitation.lockReason ? <Text style={[styles.text, { color: colors.textSecondary }]}>{invitation.lockReason}</Text> : null}
                </View>
              )
            })}
            {!result ? <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.textSecondary }]}>Loading your invitations...</Text> : null}
          </>
        ) : (
          <>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Player access</Text>
            {status === 'denied' ? <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.textSecondary }]}>
              Your Player access is unavailable. Ask your club to check your invitation.
            </Text> : null}
          </>
        )}
        {confirmation ? <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.textPrimary }]}>{confirmation}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={[styles.text, { color: colors.danger }]}>{error}</Text> : null}
        <View style={[styles.actions, styles.footer, { borderTopColor: colors.border }]}>
          <PlayerAction label={status === 'linked' ? 'Refresh invitations' : 'Check for access'} colors={colors} disabled={Boolean(pending)} onPress={retry} />
          {onSwitchAccount ? <PlayerAction label={switchLabel} colors={colors} onPress={onSwitchAccount} /> : null}
          <PlayerAction label="Sign out" colors={colors} onPress={() => void onSignOut().catch(failure => setActionError(failure.message))} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 12 },
  actionText: { fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  content: { alignSelf: 'center', gap: 14, maxWidth: 670, padding: 20, width: '100%' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 14, paddingBottom: 16 },
  headerCopy: { flex: 1 },
  logo: { height: 52, width: 52 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, gap: 5, paddingBottom: 12 },
  rowTitle: { fontSize: 17, fontWeight: '700' },
  sectionTitle: { fontSize: 20, fontWeight: '800', marginTop: 6 },
  text: { fontSize: 16, lineHeight: 23 },
  title: { fontSize: 24, fontWeight: '800' },
})
