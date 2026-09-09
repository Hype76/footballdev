import { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import { getCoachCalendarResources } from '../../mobile-core/src/coachCalendarData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { getCoachDevelopmentWorkspace } from '../../mobile-core/src/coachPhase31EData'
import { getCoachMatchDayList, getCoachMatchDayDetail } from '../../mobile-core/src/coachMatchDayData'
import { MATCH_DAY_OFFLINE_MAX_AGE } from '../../mobile-core/src/matchDayOutboxCore'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { readCoachOfflineReadiness, saveCoachOfflineResources, updateCoachMatchDayOutbox } from './offline'

export function CoachOfflineReadiness({ user, context, styles }) {
  const [summary, setSummary] = useState('Checking saved information...')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const inspect = useCallback(async () => {
    const { resources, journals, pending } = await readCoachOfflineReadiness(user.id, context)
    const ready = journals.filter(journal => journal?.baseMatch && Date.now() - Date.parse(journal.verifiedAt) < MATCH_DAY_OFFLINE_MAX_AGE)
    setSummary(`${resources.players?.length || 0} Players, ${resources['phase31e:development']?.forms?.length || 0} Development forms and ${ready.length} fixtures ready for offline recording. ${pending ? `${pending} saved items waiting to sync across your teams.` : 'No saved changes waiting to sync.'}`)
  }, [context, user.id])
  useEffect(() => {
    let active = true
    const check = () => { if (active) void inspect().catch(() => setSummary('Saved information could not be checked.')) }
    check()
    const timer = setInterval(check, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [inspect])
  const download = async () => {
    setBusy(true); setMessage('Downloading Players and Development forms...')
    try {
      const [players, development] = await Promise.all([
        withMobileAsyncTimeout(() => getCoachPlayerList(user)),
        withMobileAsyncTimeout(() => getCoachDevelopmentWorkspace(user)),
      ])
      await saveCoachOfflineResources(user.id, context, { players, calendarPlayers: players, matchDayPlayers: players, 'phase31e:development': development })
      setMessage('Downloading Calendar and fixtures...')
      const [calendar, matches] = await Promise.all([
        withMobileAsyncTimeout(() => getCoachCalendarResources(user)),
        withMobileAsyncTimeout(() => getCoachMatchDayList(user)),
      ])
      await saveCoachOfflineResources(user.id, context, { calendar, matchDayList: matches })
      const today = new Date().toISOString().slice(0, 10)
      const upcoming = matches.filter(match => !['completed', 'cancelled', 'deleted'].includes(match.status) && match.matchDate >= today)
        .sort((a, b) => a.matchDate.localeCompare(b.matchDate)).slice(0, 8)
      for (let index = 0; index < upcoming.length; index++) {
        setMessage(`Downloading fixture ${index + 1} of ${upcoming.length}...`)
        const detail = await withMobileAsyncTimeout(() => getCoachMatchDayDetail(user, upcoming[index].id))
        await updateCoachMatchDayOutbox(user.id, context, detail.id, previous => previous?.pending?.length ? previous : {
          baseMatch: detail, pending: [], verifiedAt: new Date().toISOString(), error: '',
        })
      }
      setMessage(`Saved on this phone. ${upcoming.length} upcoming fixtures downloaded. Refresh fixtures within 24 hours of recording.`)
    } catch (error) { setMessage(`Download incomplete. ${error.message || 'Reconnect and try again.'} Successfully saved items remain available.`) }
    finally { await inspect().catch(() => {}); setBusy(false) }
  }
  if (!context.teamId) return null
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>Offline readiness</Text>
    <Text accessibilityLiveRegion="polite" style={styles.bodyText}>{summary}</Text>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.bodyText}>{message}</Text> : null}
    {busy ? <BrandLoader /> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || user.isOfflineProfile, busy }} disabled={busy || user.isOfflineProfile} onPress={() => void download()} style={{ minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: '#668879', borderRadius: 12, padding: 12 }}>
      <Text style={styles.cardTitle}>{busy ? 'Downloading...' : 'Download for offline'}</Text>
    </Pressable>
    <Text style={styles.helperText}>Downloads the selected team's Players, forms, Calendar and up to 8 upcoming fixtures. Open another fixture online to save it too.</Text>
  </View>
}
