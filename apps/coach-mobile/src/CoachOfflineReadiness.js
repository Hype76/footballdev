import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { readCoachOfflineReadiness } from './offline'

export function CoachOfflineReadiness({ user, context, styles }) {
  const [summary, setSummary] = useState('Your team information is saved automatically while you use Coach.')
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
  }, [user.id, context])
  if (!context.teamId) return null
  return <View style={{ gap: 12, paddingVertical: 8 }}>
    <Text style={styles.bodyText}>{summary}</Text>
    <Text style={styles.helperText}>Saves and refreshes automatically when connected. Your unsent changes stay on this phone until they sync.</Text>
  </View>
}
