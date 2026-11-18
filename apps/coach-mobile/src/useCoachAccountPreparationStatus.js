import { useEffect, useState } from 'react'
import { readCoachAccountPreparation } from './offline'

export function useCoachAccountPreparationStatus(user, contexts, enabled) {
  const [saved, setSaved] = useState(null)
  const userId = user?.id
  useEffect(() => {
    if (!enabled || !userId) return undefined
    let current = true
    const read = async () => {
      try {
        const statuses = await readCoachAccountPreparation(userId, contexts)
        if (current) setSaved({ userId, statuses })
      } catch { if (current) setSaved(null) }
    }
    void read()
    const timer = setInterval(() => void read(), 10_000)
    return () => { current = false; clearInterval(timer) }
  }, [userId, contexts, enabled])
  return saved?.userId === userId ? saved.statuses : {}
}
