import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { readCoachOfflineReadiness } from './offline'
import { syncCoachOfflineNow } from './useCoachOfflinePreparation'

export function CoachOfflineReadiness({ user, context, styles }) {
  const [summary, setSummary] = useState('Your team information is saved automatically while you use Coach.')
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  async function syncNow() {
    if (syncing) return
    setSyncing(true)
    setNotice('')
    try {
      await syncCoachOfflineNow(user, context)
      setNotice('Sync complete. Your saved information is up to date.')
      setRefresh(value => value + 1)
    } catch (error) { setNotice(error?.message || 'Sync could not finish. Your saved changes remain on this phone.') }
    finally { setSyncing(false) }
  }
  useEffect(() => {
    let active = true
    const inspect = async () => {
      try {
        const { resources, journals, pending } = await readCoachOfflineReadiness(user.id, context)
        if (!active) return
        const count = journals.filter(journal => journal?.baseMatch).length
        setSummary(`${resources.players?.length || 0} Players and ${count} fixtures saved on this phone. ${pending ? `${pending} saved changes will sync when connected.` : 'No changes waiting to sync.'}`)
      } catch { if (active) setSummary('Saved information could not be checked. Coach will retry automatically.') }
    }
    void inspect()
    const timer = setInterval(() => void inspect(), 15_000)
    return () => { active = false; clearInterval(timer) }
  }, [user.id, context, refresh])
  if (!context.teamId) return null
  return <View style={{ gap: 12, paddingVertical: 8 }}>
    <Text style={styles.bodyText}>{summary}</Text>
    <Text style={styles.helperText}>Saves and refreshes automatically when connected. Your unsent changes stay on this phone until they sync.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: syncing }} disabled={syncing} onPress={syncNow} style={{ minHeight: 48, justifyContent: 'center', padding: 12, borderWidth: 1, borderRadius: 10 }}><Text style={styles.bodyText}>{syncing ? 'Syncing...' : 'Sync now'}</Text></Pressable>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.bodyText}>{notice}</Text> : null}
  </View>
}
