import { Text, Pressable, View } from 'react-native'

export function AttendancePendingRows({ outbox, onRefresh, styles }) {
  return <View>
    {outbox.error ? <Text accessibilityRole="alert" style={styles.error || styles.danger}>{outbox.error}</Text> : null}
    {outbox.commands.filter(command => command.status !== 'saved' || command.notifyPending).map(command => <View key={command.id} style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{command.label}: {command.response === 'available' ? 'Attending' : command.response === 'unavailable' ? 'Not attending' : 'Maybe'}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.helper || styles.body}>{command.error || (command.status === 'persisting' ? 'Saving on this phone' : command.status === 'sending' ? 'Saving to server' : 'Saved on phone, waiting to sync')}</Text>
      </View>
      {['retryable', 'saved'].includes(command.status) ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry ${command.label}`} onPress={() => void outbox.retry()} style={{ padding: 12 }}><Text style={styles.body}>Retry</Text></Pressable> : null}
      {['conflict', 'rejected'].includes(command.status) ? <Pressable accessibilityRole="button" accessibilityLabel={`Review ${command.label}`} onPress={() => { Promise.resolve(onRefresh?.()).then(confirmed => confirmed === true ? outbox.review(command.id) : undefined).catch(() => {}) }} style={{ padding: 12 }}><Text style={styles.body}>Refresh and review</Text></Pressable> : null}
    </View>)}
  </View>
}
