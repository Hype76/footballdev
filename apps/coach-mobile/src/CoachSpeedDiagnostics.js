import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { clearCoachPerformanceSamples, getCoachConnectionLabel, readCoachPerformanceSamples } from './coachPerformanceDiagnostics'

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

function formatDuration(value) {
  const duration = Number(value || 0)
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s`
}

export function CoachSpeedDiagnostics({ reloadHome, styles }) {
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [samples, setSamples] = useState([])
  const refresh = useCallback(() => readCoachPerformanceSamples().then(setSamples).catch(() => setSamples([])), [])
  useEffect(() => { void refresh() }, [refresh])
  const latest = useMemo(() => {
    const seen = new Set()
    return samples.filter((sample) => {
      if (seen.has(sample.name)) return false
      seen.add(sample.name)
      return true
    }).slice(0, 8)
  }, [samples])
  const run = async () => {
    if (running) return
    setRunning(true)
    setNotice('Running a fresh Home speed check...')
    try {
      await reloadHome({ diagnostics: true, refresh: true })
      await refresh()
      setNotice('Speed check complete. Results stay on this phone.')
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
    <Text style={styles.bodyText}>Runs a fresh Home request and records timings locally. No account content or diagnostic results are uploaded.</Text>
    <View style={styles.infoRow}><Text style={styles.infoLabel}>Connection reported</Text><Text style={styles.infoValue}>{getCoachConnectionLabel()}</Text></View>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: running }} disabled={running} onPress={run} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 10 }}>
      <Text style={styles.bodyText}>{running ? 'Checking speed...' : 'Run speed check'}</Text>
    </Pressable>
    {latest.map((sample) => <View key={sample.id} style={styles.infoRow}>
      <Text style={styles.infoLabel}>{LABELS[sample.name] || sample.name}</Text>
      <Text style={styles.infoValue}>{sample.status === 'error' ? 'Unavailable' : formatDuration(sample.durationMs)}</Text>
    </View>)}
    {samples.length ? <Pressable accessibilityRole="button" onPress={clear} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8 }}><Text style={styles.helperText}>Clear saved results</Text></Pressable> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{notice}</Text> : null}
  </View>
}
