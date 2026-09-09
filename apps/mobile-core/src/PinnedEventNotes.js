import { Text, View } from 'react-native'

export function PinnedEventNotes({ notes, pinned, styles, colors = {} }) {
  if (!pinned || !String(notes || '').trim()) return null
  return <View accessibilityLabel="Pinned event notes" style={{ borderLeftWidth: 4, borderLeftColor: colors.accentText || colors.accent || '#197781', padding: 12, gap: 6 }}>
    <Text style={styles.cardTitle}>Pinned notes</Text>
    <Text style={styles.body}>{notes}</Text>
  </View>
}
