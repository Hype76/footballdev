import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { clearCoachPerformanceSamples, readCoachPerformanceSamples } from './coachPerformanceDiagnostics'
import { COACH_STARTUP_DESTINATIONS, COACH_TIMED_TABS } from './coachPerformanceDiagnosticsCore'

const LABELS = Object.freeze({
  home: 'Complete Home refresh',
  'home.matches': 'Match summary',
  'home.sessions': 'Session summary',
  'home.calendar': 'Calendar summary',
  'home.development': 'Development summary',
  'home.chatRooms': 'Chat summary',
  'home.polls': 'Poll summary',
  'home.invites': 'Availability summary',
})
const OUTCOMES = Object.freeze({ saved: 'Saved data', left: 'Left before this stage', error: 'Failed' })
const START_MARKERS = Object.freeze({ bundle: 'From app code start', runtime: 'From runtime start', foreground: 'From foreground activation' })

let speedCheckSequence = 0

function formatDuration(value) {
  const duration = Number(value || 0)
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s`
}

function TimingRows({ title, rows, styles }) {
  return <View>
    <Text accessibilityRole="header" style={styles.bodyText}>{title}</Text>
    {rows.map(([label, sample]) => {
      const outcome = START_MARKERS[sample?.source] || OUTCOMES[sample?.status]
      const value = !sample ? 'Awaiting sample' : sample.status === 'cached' ? 'Saved data only' : `${formatDuration(sample.durationMs)}${outcome ? ` · ${outcome}` : ''}`
      return <View key={label} style={styles.infoRow}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    })}
  </View>
}

export function CoachSpeedDiagnostics({ connectionOffline, reloadHome, styles }) {
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [samples, setSamples] = useState([])
  const refresh = useCallback(async () => {
    const next = await readCoachPerformanceSamples().catch(() => [])
    setSamples(next)
    return next
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const latest = useMemo(() => {
    const byName = new Map()
    for (const sample of samples) if (!byName.has(sample.name)) byName.set(sample.name, sample)
    return byName
  }, [samples])
  const latestHomeRun = samples.find(sample => sample.runId && sample.name === 'home')?.runId
  const homeResults = useMemo(() => {
    if (!latestHomeRun) return latest
    return new Map(samples.filter(sample => sample.runId === latestHomeRun).reverse().map(sample => [sample.name, sample]))
  }, [latest, latestHomeRun, samples])
  const startup = samples.find(sample => sample.name.startsWith('startup.') && sample.name !== 'startup.workspace')
  const tapRows = (stage) => Object.entries(COACH_TIMED_TABS)
    .filter(([route]) => stage === 'screen' || route !== 'more')
    .map(([route, label]) => [label, latest.get(`tab.${route}.${stage}`)])
  const run = async () => {
    if (running) return
    setRunning(true)
    setNotice('Running a fresh Home speed check...')
    try {
      const diagnosticRunId = `${Date.now().toString(36)}-${++speedCheckSequence}`
      await reloadHome({ diagnostics: true, diagnosticRunId, refresh: true })
      const result = (await refresh()).find(sample => sample.runId === diagnosticRunId && sample.name === 'home')
      setNotice(result?.status === 'success' ? 'Speed check complete. Results stay on this phone.'
        : result ? 'Some Home information could not refresh. See the timings below.'
          : 'No new result. Wait for the connection, then try again.')
    } catch {
      await refresh()
      setNotice('The check finished with an unavailable service. Recorded timings are shown below.')
    } finally { setRunning(false) }
  }
  const clear = async () => {
    await clearCoachPerformanceSamples()
    setSamples([])
    setNotice('Saved speed results cleared from this phone.')
  }
  return <View style={{ gap: 10, paddingVertical: 4 }}>
    <Text style={styles.bodyText}>Fully close and reopen Coach to measure startup. Tab layout can appear before results or actions are ready. On devices without a native launch marker the opening measurement starts when app code begins. Results stay on this phone.</Text>
    <TimingRows title="App startup to content" rows={[[COACH_STARTUP_DESTINATIONS[startup?.name.slice('startup.'.length)] || 'Coach Home', startup]]} styles={styles} />
    <TimingRows title="Tap to tab layout" rows={tapRows('screen')} styles={styles} />
    <TimingRows title="Tap to first data" rows={tapRows('first')} styles={styles} />
    <TimingRows title="Tap to fresh data" rows={tapRows('fresh')} styles={styles} />
    <TimingRows title="Tap to available action" rows={[[ 'Open Create match', latest.get('tab.matchday.create') ]]} styles={styles} />
    <View style={styles.infoRow}><Text style={styles.infoLabel}>Coach connection</Text><Text style={styles.infoValue}>{connectionOffline ? 'Offline' : 'Online'}</Text></View>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: running }} disabled={running} onPress={run} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 10 }}>
      <Text style={styles.bodyText}>{running ? 'Checking speed...' : 'Run speed check'}</Text>
    </Pressable>
    <TimingRows title="Home refresh requests" rows={Object.entries(LABELS).map(([name, label]) => [label, homeResults.get(name)])} styles={styles} />
    {samples.length ? <Pressable accessibilityRole="button" onPress={clear} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8 }}><Text style={styles.helperText}>Clear saved results</Text></Pressable> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{notice}</Text> : null}
  </View>
}
