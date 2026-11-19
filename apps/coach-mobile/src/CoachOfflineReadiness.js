import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { readCoachOfflineReadiness, readCoachAccountPreparation } from './offline'
import { syncCoachOfflineNow } from './useCoachOfflinePreparation'
import { subscribeCoachOfflinePreparation } from './coachAccountOfflineService'
import { assertCoachAccountPreparationFinished, coachAccountOfflineLabel } from './coachAccountOfflinePreparation'

function hasCompletedDownload(status) {
  return status?.state === 'ready' || (status?.state === 'partial' && status.onlineOnly?.length && !status.error && !status.filesFailed)
}

export function CoachOfflineReadiness({ user, context, styles }) {
  const [summary, setSummary] = useState('Club records and files save while Coach is open and connected.')
  const [teams, setTeams] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [live, setLive] = useState({ active: false, statuses: {} })
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  async function syncNow() {
    if (syncing || user.isOfflineProfile) return
    setSyncing(true)
    setNotice('')
    try {
      const result = await syncCoachOfflineNow(user, context)
      const outcome = assertCoachAccountPreparationFinished(result.accountPreparation, user.coachContexts || [context])
      setNotice(outcome.complete
        ? 'Download complete. All your teams are ready offline.'
        : `All team records and uploaded files are saved. ${outcome.onlineOnlyCount} external links still need internet.`)
    } catch (error) { setNotice(error?.message || 'Sync could not finish. Your saved changes remain on this phone.') }
    finally { setSyncing(false); setRefresh(value => value + 1) }
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
        if (contexts.some(item => statuses[item.id]?.state === 'saving')) setNotice('')
        const count = journals.filter(journal => journal?.baseMatch).length
        setSummary(`${resources.players?.length || 0} Players and ${count} fixtures saved on this phone. ${pending ? `${pending} saved changes will sync when connected.` : 'No changes waiting to sync.'}`)
      } catch { if (active) setSummary('Saved information could not be checked. Coach will retry automatically.') }
    }
    void inspect()
    const timer = setInterval(() => void inspect(), 15_000)
    return () => { active = false; clearInterval(timer) }
  }, [user, context, refresh, live.active])
  useEffect(() => subscribeCoachOfflinePreparation(user.id, snapshot => setLive({ ...snapshot, userId: user.id })), [user.id])
  const currentFeed = live.userId === user.id ? live : { active: false, statuses: {} }
  const statuses = Object.fromEntries(teams.map(team => [team.id, currentFeed.statuses?.[team.id] || team.status]))
  const remaining = teams.filter(team => !hasCompletedDownload(statuses[team.id])).length
  return <View style={{ gap: 12, paddingVertical: 8 }}>
    <Text style={styles.bodyText}>{summary}</Text>
    <Text style={styles.helperText}>Keep Coach open and connected until your teams are ready. Includes records, badges and uploaded files. External links need internet. Your unsent changes stay on this phone.</Text>
    {currentFeed.active ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{remaining} team{remaining === 1 ? '' : 's'} remaining</Text> : null}
    {teams.map(team => {
      const status = statuses[team.id]
      const saving = status?.state === 'saving'
      const reached = Object.prototype.hasOwnProperty.call(currentFeed.statuses || {}, team.id)
      const queued = currentFeed.active && !reached && !hasCompletedDownload(status)
      const label = queued ? 'Waiting to download' : saving && !currentFeed.active ? `Download paused. ${status.filesSaved || 0} files saved. Keep Coach open and connected to resume.` : coachAccountOfflineLabel(status)
      const phase = status?.phase === 'records' ? 'Saving records' : status?.phase === 'files' ? 'Saving files' : status?.phase === 'verifying' ? 'Checking saved information' : ''
      const family = status?.resourceKey ? String(status.resourceKey).replace(/[_:-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') : ''
      return <View key={team.id} style={{ paddingVertical: 10, borderBottomWidth: 0.5 }}>
      <Text style={styles.bodyText}>{team.clubName} | {team.teamName || 'Club overview'}</Text>
      <Text style={styles.helperText}>{label}</Text>
      {saving && currentFeed.active && reached && phase ? <Text style={styles.helperText}>{phase}{family && status.phase === 'records' ? `: ${family}` : ''}</Text> : null}
      {saving && currentFeed.active && reached && status.phase === 'files' ? <Text style={styles.helperText}>{status.filesSaved || 0} of {status.filesTotal || 0} files saved{status.filesFailed ? `, ${status.filesFailed} failed` : ''}</Text> : null}
      {saving && currentFeed.active && reached && status.currentFile ? <Text style={styles.helperText}>{status.currentFile}</Text> : null}
      {status?.error ? <Text style={styles.helperText}>{status.error}</Text> : null}
      {status?.onlineOnly?.map(item => <Text key={item.id} style={styles.helperText}>{item.title || 'External link'}: internet required</Text>)}
    </View>})}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: syncing || Boolean(user.isOfflineProfile) }} disabled={syncing || user.isOfflineProfile} onPress={syncNow} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 12 }}><Text style={styles.bodyText}>{syncing ? 'Downloading...' : 'Sync and download all teams'}</Text></Pressable>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.bodyText}>{notice}</Text> : null}
  </View>
}
