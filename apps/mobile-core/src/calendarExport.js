import { Alert, Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { buildParentCalendarIcs } from '../../parent-mobile/src/parentExperience.js'

export async function shareCalendarEvent(item) {
  const ics = buildParentCalendarIcs(item)
  if (!ics) throw new Error('This event needs a confirmed date before it can be added to a calendar.')
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'football-player-event.ics'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return
  }
  if (!await Sharing.isAvailableAsync()) throw new Error('Calendar file sharing is unavailable on this device.')
  if (Platform.OS === 'ios') {
    const proceed = await new Promise(resolve => Alert.alert('Add to Apple Calendar',
      'Share this calendar file to Mail and send it to yourself. Open the attachment in Apple Mail, then tap Add to Calendar. This saves a copy of this event; later changes will not sync automatically.',
      [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Share calendar file', onPress: () => resolve(true) }]))
    if (!proceed) return
  }
  const directory = `${FileSystem.cacheDirectory}calendar-export-${Date.now()}-${Math.random().toString(36).slice(2)}/`
  const uri = `${directory}football-player-event.ics`
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  try {
    await FileSystem.writeAsStringAsync(uri, ics, { encoding: FileSystem.EncodingType.UTF8 })
    await Sharing.shareAsync(uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics', dialogTitle: 'Add event to calendar' })
  } finally {
    await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => {})
  }
}
