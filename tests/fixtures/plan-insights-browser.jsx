import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlanInsights } from '../../src/components/billing/PlanInsights.jsx'
import { MATCHDAY_DEFAULT_FLAGS } from '../../src/lib/matchday-policy.js'

export function Fixture() {
  const [available, setAvailable] = useState(true)
  const insights = available
    ? { teams: 3, players: 40, teamCapacity: 10, matchdayPolicy: { revision: 1, flags: MATCHDAY_DEFAULT_FLAGS } }
    : null
  return <main>
    <button type="button" onClick={() => setAvailable(value => !value)}>Toggle usage data</button>
    <PlanInsights currentPlanKey="club" insights={insights} />
  </main>
}

createRoot(document.getElementById('root')).render(<Fixture />)
