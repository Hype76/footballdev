import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlanPriceCalculator } from '../../src/components/billing/PlanPriceCalculator.jsx'

export function Fixture() {
  const [planKey, setPlanKey] = useState('club')
  const [quote, setQuote] = useState({ includedTeams: 30, billingCycle: 'monthly' })
  useEffect(() => { window.modernPricingQuote = quote }, [quote])
  return <main>
    <div role="group" aria-label="Plan selection">
      {['team', 'club'].map((key) => <button key={key} type="button" onClick={() => { setPlanKey(key); setQuote({ includedTeams: key === 'club' ? 30 : 1, billingCycle: 'monthly' }) }}>{key}</button>)}
    </div>
    <PlanPriceCalculator key={planKey} planKey={planKey} value={quote} onChange={setQuote} />
  </main>
}

createRoot(document.getElementById('root')).render(<Fixture />)
