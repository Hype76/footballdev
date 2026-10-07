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
  const input = { color: palette.textPrimary, borderBottomColor: palette.border, borderBottomWidth: 1, minHeight: 48, fontSize: 16, paddingVertical: 10 }
  const row = { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border }
  const button = (label, press, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={press} style={{ minHeight: 48, paddingVertical: 12 }}><Text style={[styles.secondaryActionText, { color: disabled ? palette.textMuted : palette.accentText }]}>{label}</Text></Pressable>
  const hours = (key, label) => <View style={row}><Text style={[body, { flex: 1 }]}>{label}</Text><TextInput accessibilityLabel={label} editable={policy.canManage && !saving} keyboardType="number-pad" maxLength={3} onChangeText={value => setPolicy(current => ({ ...current, [key]: value === '' ? '' : Number(value.replace(/\D/g, '')) }))} value={String(policy[key])} style={[input, { width: 64, textAlign: 'center' }]} /></View>
  return <View>
    {policy && section !== 'coaches' ? <>
      <Text style={styles.sectionTitle}>Team reminders</Text>
      <View style={row}><Text style={[body, { flex: 1 }]}>Squad selection reminder</Text><Switch accessibilityLabel="Squad selection reminder" disabled={!policy.canManage || saving} value={policy.squadEnabled} onValueChange={value => setPolicy({ ...policy, squadEnabled: value })} /></View>
      {hours('squadHoursBefore', 'Hours before kick-off')}
      <Text style={styles.helperText}>Team admins and coaches are reminded if the squad has not been selected and confirmed. The default is 48 hours.</Text>
      <View style={row}><Text style={[body, { flex: 1 }]}>Automatic availability reminder</Text><Switch accessibilityLabel="Automatic availability reminder" disabled={!policy.canManage || saving} value={policy.availabilityEnabled} onValueChange={value => setPolicy({ ...policy, availabilityEnabled: value })} /></View>
      {hours('availabilityHoursBefore', 'Hours before a match or training')}
      <Text style={styles.helperText}>Remind only invited families who have not responded. Existing invitations and responses stay unchanged.</Text>
      {policy.canManage ? button('Save reminders', () => { void action('save') }, saving) : <Text style={styles.helperText}>Only the team admin can change reminders.</Text>}
    </> : null}
    {policy?.canManage && section !== 'reminders' ? <>
      <Text style={styles.sectionTitle}>Add a coach</Text>
      <TextInput accessibilityLabel="Coach email address" autoCapitalize="none" autoCorrect={false} editable={!saving} keyboardType="email-address" onChangeText={setEmail} placeholder="Coach email address" placeholderTextColor={palette.textMuted} value={email} style={input} />
      <View style={row}>{['coach', 'assistant_coach'].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: role === value }} disabled={saving} onPress={() => setRole(value)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={[body, { color: role === value ? palette.accentText : palette.textPrimary }]}>{value === 'coach' ? 'Coach' : 'Assistant coach'}</Text></Pressable>)}</View>
      {button('Send coach invitation', () => { void action('invite') }, saving || !email.trim())}
    </> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{notice}</Text> : null}
    {!policy ? button('Retry team settings', () => setRetry(value => value + 1)) : null}
  </View>
}
