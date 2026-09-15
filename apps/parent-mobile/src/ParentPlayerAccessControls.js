import { useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { canRemoveOwnParentAccess } from '../../mobile-core/src/parentAccessRemovalCore'

export function ParentPlayerAccessControls({ links, disabled = false, onRemove, palette }) {
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const textStyle = { color: palette.text, fontSize: 15, lineHeight: 22 }
  const button = (label, onPress, { danger = false, unavailable = false } = {}) => (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={onPress}
      style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 12, borderWidth: 1, borderRadius: 12, borderColor: danger ? palette.danger : palette.border, backgroundColor: danger ? palette.dangerBackground : palette.card, opacity: unavailable ? 0.5 : 1 }}>
      <Text style={[textStyle, { color: danger ? palette.danger : palette.text, fontWeight: '800', textAlign: 'center' }]}>{label}</Text>
    </Pressable>
  )
  const close = () => { if (!submitting.current) { setTarget(null); setError('') } }
  const confirm = async () => {
    if (submitting.current || disabled || !target) return
    submitting.current = true
    setBusy(true)
    setError('')
    try { await onRemove(target); setTarget(null) }
    catch (failure) { setError(failure?.message || 'Your access could not be removed. Please try again.') }
    finally { submitting.current = false; setBusy(false) }
  }
  return <View style={{ gap: 16 }}>
    {links.length ? links.map(link => <View key={link.id} style={{ gap: 8, borderBottomWidth: 1, borderBottomColor: palette.border, paddingBottom: 16 }}>
      <Text style={[textStyle, { fontSize: 17, fontWeight: '800' }]}>{link.playerName}</Text>
      <Text style={textStyle}>{[link.clubName, link.teamName].filter(Boolean).join(' | ') || 'No Team assigned'}</Text>
      {canRemoveOwnParentAccess(link) ? button(`Remove my access to ${link.playerName}`, () => { setTarget(link); setError('') }, { danger: true, unavailable: disabled }) : null}
    </View>) : <Text style={textStyle}>No active player links are available.</Text>}
    {disabled ? <Text style={textStyle}>Connect and wait for any current action to finish before removing access.</Text> : null}
    {target ? <Modal animationType="fade" transparent visible onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.7)' }}>
        <ScrollView style={{ flexGrow: 0, maxHeight: '85%' }} contentContainerStyle={{ padding: 20, gap: 16, borderRadius: 18, backgroundColor: palette.card }} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[textStyle, { fontSize: 22, fontWeight: '900', lineHeight: 28 }]}>Remove your access to {target.playerName}?</Text>
          <Text style={textStyle}>{[target.clubName, target.teamName].filter(Boolean).join(' | ')}</Text>
          <Text style={textStyle}>This removes your Parent portal access to this player. Your account and access to other players will stay. The player and other parents will not be removed.</Text>
          <Text style={textStyle}>Your contact details will remain with the club. The club may still send you direct emails.</Text>
          <Text style={textStyle}>You will need a new invitation to regain access.</Text>
          {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[textStyle, { color: palette.danger }]}>{error}</Text> : null}
          {button('Keep my access', close, { unavailable: busy })}
          {button(busy ? 'Removing access...' : 'Remove my access', () => void confirm(), { danger: true, unavailable: busy || disabled })}
        </ScrollView>
      </View>
    </Modal> : null}
  </View>
}
