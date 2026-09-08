import { createElement } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { getCoachInviteStatusLabel } from './coachPhase31ECore'

const states = {
  available: { backgroundColor: '#d1fae5', color: '#064e3b', borderColor: '#047857', icon: 'check-circle' },
  unavailable: { backgroundColor: '#fee2e2', color: '#7f1d1d', borderColor: '#b91c1c', icon: 'cancel' },
  maybe: { backgroundColor: '#fef3c7', color: '#78350f', borderColor: '#b45309', icon: 'help' },
  awaiting: { backgroundColor: '#dbeafe', color: '#1e3a8a', borderColor: '#1d4ed8', icon: 'schedule' },
  inactive: { backgroundColor: '#e5e7eb', color: '#1f2937', borderColor: '#4b5563', icon: 'remove-circle' },
}

export function InviteStatusBadge({ status, kind, Icon }) {
  const key = String(status || '').trim().toLowerCase()
  const state = states[key] || (['pending', 'responded', ''].includes(key) ? states.awaiting : states.inactive)
  const label = getCoachInviteStatusLabel(status, kind)
  return <View accessibilityLabel={label} style={[styles.badge, { backgroundColor: state.backgroundColor, borderColor: state.borderColor }]}>
    {createElement(Icon, { name: state.icon, size: 16, color: state.color, accessible: false })}
    <Text style={[styles.label, { color: state.color }]}>{label}</Text>
  </View>
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-end', alignItems: 'center', flexDirection: 'row', gap: 5, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5, maxWidth: '100%' },
  label: { flexShrink: 1, fontSize: 13, fontWeight: '800' },
})
