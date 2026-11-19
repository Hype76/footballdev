import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { clearCoachPerformanceSamples, getCoachConnectionLabel, readCoachPerformanceSamples } from './coachPerformanceDiagnostics'
import { COACH_TIMED_TABS } from './coachPerformanceDiagnosticsCore'

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

function TimingRows({ title, rows, styles }) {
  return <View>
    <Text accessibilityRole="header" style={styles.bodyText}>{title}</Text>
    {rows.map(([label, sample]) => {
      const outcome = sample?.status === 'saved' ? ' · Saved data' : sample?.status === 'left' ? ' · Left before ready' : sample?.status === 'error' ? ' · Failed' : ''
      return <View key={label} style={styles.infoRow}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{sample ? formatDuration(sample.durationMs) + outcome : 'Awaiting sample'}</Text>
      </View>
    })}
  </View>
}

export function CoachSpeedDiagnostics({ reloadHome, styles }) {
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [samples, setSamples] = useState([])
  const refresh = useCallback(() => readCoachPerformanceSamples().then(setSamples).catch(() => setSamples([])), [])
  useEffect(() => { void refresh() }, [refresh])
  const latest = useMemo(() => {
    const byName = new Map()
    for (const sample of samples) if (!byName.has(sample.name)) byName.set(sample.name, sample)
    return byName
  }, [samples])
  const tapRows = (stage) => Object.entries(COACH_TIMED_TABS)
    .filter(([route]) => stage === 'screen' || route !== 'more')
    .map(([route, label]) => [label, latest.get(`tab.${route}.${stage}`)])
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
    <Text style={styles.bodyText}>Open the bottom tabs and wait for their data, then return here. Screen timing starts when Coach receives your tap. Results stay on this phone.</Text>
    <TimingRows title="Tap to screen" rows={tapRows('screen')} styles={styles} />
    <TimingRows title="Data wait after screen opens" rows={tapRows('data')} styles={styles} />
    <View style={styles.infoRow}><Text style={styles.infoLabel}>Connection reported</Text><Text style={styles.infoValue}>{getCoachConnectionLabel()}</Text></View>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: running }} disabled={running} onPress={run} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 10 }}>
      <Text style={styles.bodyText}>{running ? 'Checking speed...' : 'Run speed check'}</Text>
    </Pressable>
    <TimingRows title="Home refresh requests" rows={Object.entries(LABELS).map(([name, label]) => [label, latest.get(name)])} styles={styles} />
    {samples.length ? <Pressable accessibilityRole="button" onPress={clear} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8 }}><Text style={styles.helperText}>Clear saved results</Text></Pressable> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.helperText}>{notice}</Text> : null}
  </View>
}
