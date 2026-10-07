import { useEffect, useRef, useState } from 'react'
import { Pressable, Switch, Text, TextInput, View } from 'react-native'
import { addCoachFromPhone, readCoachTeamAdministration, saveCoachTeamReminders } from '../../mobile-core/src/coachTeamAdministration'

export function CoachTeamAdministration({ user, context, palette, styles, section = 'all' }) {
  const [policy, setPolicy] = useState(null)
  const [notice, setNotice] = useState('Loading team settings...')
  const [saving, setSaving] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('coach')
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const savingRef = useRef(false)
  const userRef = useRef(user)
  userRef.current = user
  const scope = `${user?.id}:${user?.clubId}:${user?.activeTeamId}:${user?.teamId}:${user?.status}:${user?.hasActivePlanAccess}:${user?.role}:${user?.roleRank}:${context?.teamId}:${context?.role}:${context?.roleRank}`
  useEffect(() => {
    const request = ++generation.current
    setPolicy(null); savingRef.current = false; setSaving(false); setNotice('Loading team settings...'); setEmail('')
    readCoachTeamAdministration(userRef.current).then(value => {
      if (request === generation.current) { setPolicy(value); setNotice('') }
    }).catch(error => { if (request === generation.current) setNotice(error.message) })
    return () => { generation.current += 1 }
  }, [scope, retry])
  const action = async kind => {
    if (savingRef.current || !policy?.canManage) return
    if (kind === 'save' && (![policy.squadHoursBefore, policy.availabilityHoursBefore].every(value => Number.isInteger(value) && value >= 1 && value <= 168))) {
      setNotice('Choose reminder times from 1 to 168 hours.'); return
    }
    const request = generation.current
    savingRef.current = true
    setSaving(true)
    setNotice(kind === 'save' ? 'Saving reminder settings...' : 'Saving coach invitation...')
    try {
      const result = kind === 'save' ? await saveCoachTeamReminders(user, policy) : await addCoachFromPhone(user, email, role)
      if (request !== generation.current) return
      if (kind === 'save') { setPolicy(result); setNotice('Reminder settings saved.') }
      else { setEmail(''); setNotice(result.message) }
    } catch (error) { if (request === generation.current) setNotice(error.message) }
    finally { if (request === generation.current) { savingRef.current = false; setSaving(false) } }
  }
  const body = styles.bodyText || { color: palette.textPrimary, fontSize: 15, lineHeight: 22 }
  const helper = [styles.helperText, { color: palette.textSecondary || palette.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '400' }]
  const input = { color: palette.textPrimary, borderBottomColor: palette.border, borderBottomWidth: 1, minHeight: 48, fontSize: 16, paddingVertical: 10 }
  const row = { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 }
  const group = { paddingVertical: 12, gap: 4, borderBottomWidth: 1, borderBottomColor: palette.border }
  const button = (label, press, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={press} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 12 }}><Text style={[styles.secondaryActionText, { color: disabled ? palette.textSecondary : palette.accentText }]}>{label}</Text></Pressable>
  const hours = (key, label) => <View style={row}><Text style={[helper, { flex: 1 }]}>{label}</Text><TextInput accessibilityLabel={label} editable={policy.canManage && !saving} keyboardType="number-pad" maxLength={3} onChangeText={value => setPolicy(current => ({ ...current, [key]: value === '' ? '' : Number(value.replace(/\D/g, '')) }))} value={String(policy[key])} style={[input, { width: 64, textAlign: 'center', fontWeight: '600' }]} /></View>
  const toggle = (key, label) => <View style={row}><Text style={[body, { flex: 1, fontWeight: '600' }]}>{label}</Text><View style={{ minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center' }}><Switch accessibilityLabel={label} disabled={!policy.canManage || saving} value={policy[key]} onValueChange={value => setPolicy(current => ({ ...current, [key]: value }))} trackColor={{ false: palette.textSecondary, true: palette.accentText }} thumbColor={palette.background} ios_backgroundColor={palette.textSecondary} hitSlop={12} /></View></View>
  return <View>
    {policy && section !== 'coaches' ? <>
      <Text style={styles.sectionTitle}>Team reminders</Text>
      <View style={group}>
      {toggle('squadEnabled', 'Squad selection reminder')}
      <Text style={helper}>Remind staff when the squad is not confirmed.</Text>
      {hours('squadHoursBefore', 'Hours before kick-off')}
      </View>
      <View style={group}>
      {toggle('availabilityEnabled', 'Automatic availability reminder')}
      <Text style={helper}>Remind invited families who have not responded.</Text>
      {hours('availabilityHoursBefore', 'Hours before a match or training')}
      </View>
      {policy.canManage ? button(saving ? 'Saving reminders...' : 'Save reminders', () => { void action('save') }, saving) : <Text style={[helper, { paddingVertical: 12 }]}>Only the team admin can change reminders.</Text>}
    </> : null}
    {policy?.canManage && section !== 'reminders' ? <>
      <Text style={styles.sectionTitle}>Add a coach</Text>
      <Text style={[helper, { marginBottom: 8 }]}>Invite a coach to this team.</Text>
      <TextInput accessibilityLabel="Coach email address" autoCapitalize="none" autoCorrect={false} editable={!saving} keyboardType="email-address" onChangeText={setEmail} placeholder="Coach email address" placeholderTextColor={palette.textMuted} value={email} style={input} />
      <View style={[row, { marginTop: 8 }]}>{['coach', 'assistant_coach'].map(value => <Pressable key={value} accessibilityRole="radio" aria-checked={role === value} accessibilityState={{ checked: role === value, disabled: saving }} disabled={saving} onPress={() => setRole(value)} style={{ minHeight: 48, flex: 1, justifyContent: 'center', borderBottomWidth: role === value ? 2 : 0, borderBottomColor: palette.accentText }}><Text style={[body, { fontWeight: role === value ? '600' : '400', color: role === value ? palette.accentText : palette.textPrimary }]}>{value === 'coach' ? 'Coach' : 'Assistant coach'}</Text></Pressable>)}</View>
      {button('Send coach invitation', () => { void action('invite') }, saving || !email.trim())}
    </> : null}
    {policy && !policy.canManage && section === 'coaches' ? <Text style={helper}>Only the team admin can add coaches.</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={[helper, { paddingVertical: 8, fontWeight: '600', color: palette.textPrimary }]}>{notice}</Text> : null}
    {!policy ? button('Retry team settings', () => setRetry(value => value + 1)) : null}
  </View>
}
