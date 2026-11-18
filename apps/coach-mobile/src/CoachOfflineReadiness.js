import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { readCoachOfflineReadiness, readCoachAccountPreparation } from './offline'
import { syncCoachOfflineNow } from './useCoachOfflinePreparation'
import { coachAccountOfflineLabel } from './coachAccountOfflinePreparation'

export function CoachOfflineReadiness({ user, context, styles }) {
  const [summary, setSummary] = useState('Club records and files save while Coach is open and connected.')
  const [teams, setTeams] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  async function syncNow() {
    if (syncing) return
    setSyncing(true)
    setNotice('')
    try {
      const result = await syncCoachOfflineNow(user, context)
      setNotice(result.accountPreparation.complete ? 'Download complete. All your teams are ready offline.' : 'Download complete. The links listed below still need internet.')
      setRefresh(value => value + 1)
    } catch (error) { setNotice(error?.message || 'Sync could not finish. Your saved changes remain on this phone.') }
    finally { setSyncing(false) }
  }
  useEffect(() => {
    let active = true
    const inspect = async () => {
      try {
        const { resources, journals, pending } = await readCoachOfflineReadiness(user.id, context)
        const contexts = (user.coachContexts || [context]).filter(item => item.clubId)
        const statuses = await readCoachAccountPreparation(user.id, contexts)
        if (!active) return
        setTeams(contexts.map(item => ({ ...item, status: statuses[item.id] })))
        const count = journals.filter(journal => journal?.baseMatch).length
        setSummary(`${resources.players?.length || 0} Players and ${count} fixtures saved on this phone. ${pending ? `${pending} saved changes will sync when connected.` : 'No changes waiting to sync.'}`)
      } catch { if (active) setSummary('Saved information could not be checked. Coach will retry automatically.') }
    }
    void inspect()
    const timer = setInterval(() => void inspect(), 15_000)
    return () => { active = false; clearInterval(timer) }
  }, [user, context, refresh])
  return <View style={{ gap: 12, paddingVertical: 8 }}>
    <Text style={styles.bodyText}>{summary}</Text>
    <Text style={styles.helperText}>Keep Coach open and connected until your teams are ready. Includes records, badges and uploaded files. External links need internet. Your unsent changes stay on this phone.</Text>
    {teams.map(team => <View key={team.id} style={{ paddingVertical: 10, borderBottomWidth: 0.5 }}>
      <Text style={styles.bodyText}>{team.clubName} | {team.teamName || 'Club overview'}</Text>
      <Text style={styles.helperText}>{coachAccountOfflineLabel(team.status)}</Text>
      {team.status?.error ? <Text style={styles.helperText}>{team.status.error}</Text> : null}
      {team.status?.onlineOnly?.map(item => <Text key={item.id} style={styles.helperText}>{item.title || 'External link'}: internet required</Text>)}
    </View>)}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: syncing }} disabled={syncing} onPress={syncNow} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 12 }}><Text style={styles.bodyText}>{syncing ? 'Downloading...' : 'Sync and download all teams'}</Text></Pressable>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.bodyText}>{notice}</Text> : null}
  </View>
}
