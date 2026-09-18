import { useMemo, useState } from 'react'
import { quoteSubscription } from '../../lib/subscription-pricing.js'

const capacityOptions = Array.from({ length: 50 }, (_, index) => (index + 1) * 10)

function formatPence(pence) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}

export function PlanPriceCalculator({ planKey = 'club', value, onChange }) {
  const [localCapacity, setTeamCapacity] = useState(planKey === 'club' ? 10 : 1)
  const [localCycle, setBillingCycle] = useState('monthly')
  const teamCapacity = planKey === 'club' ? (value?.includedTeams ?? localCapacity) : 1
  const billingCycle = value?.billingCycle ?? localCycle
  const quote = useMemo(() => quoteSubscription({ planKey, teamCapacity, billingCycle }), [planKey, teamCapacity, billingCycle])

  const update = (next) => {
    onChange?.(next)
  }

  const changeCapacity = (event) => {
    const nextCapacity = Number(event.target.value)
    setTeamCapacity(nextCapacity)
    update(quoteSubscription({ planKey, teamCapacity: nextCapacity, billingCycle }))
  }

  const changeCycle = (nextCycle) => {
    setBillingCycle(nextCycle)
    update(quoteSubscription({ planKey, teamCapacity, billingCycle: nextCycle }))
  }

  return (
    <section aria-label="Plan price calculator" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Billing interval">
        {['monthly', 'annual'].map((cycle) => (
          <button
            key={cycle}
            type="button"
            aria-pressed={billingCycle === cycle}
            onClick={() => changeCycle(cycle)}
            className={`min-h-10 rounded-md border px-4 py-2 text-sm font-black ${billingCycle === cycle ? 'border-[#047857] bg-[#ecfdf5] text-[#047857]' : 'border-[#b9cfc3] bg-white text-[#365247]'}`}
          >
            {cycle === 'monthly' ? 'Monthly' : 'Annual'}
          </button>
        ))}
      </div>

      {planKey === 'club' ? (
        <label className="flex max-w-sm flex-col gap-2 text-sm font-black text-[#183b2c]">
          Team capacity
          <select value={teamCapacity} onChange={changeCapacity} className="min-h-11 rounded-md border border-[#b9cfc3] bg-white px-3 py-2 text-base font-semibold text-[#183b2c]">
            {capacityOptions.map((capacity) => <option key={capacity} value={capacity}>{capacity} teams</option>)}
          </select>
        </label>
      ) : (
        <p className="text-sm font-semibold text-[#365247]">Includes one team.</p>
      )}

      <div className="space-y-1 border-y border-[#d7e5dc] py-4" aria-live="polite">
        <p className="text-2xl font-black text-[#101828]">{formatPence(quote.chargePence)} <span className="text-sm font-semibold">{billingCycle === 'annual' ? 'per year' : 'per month'}</span></p>
        {planKey === 'club' ? <p className="text-sm font-semibold text-[#365247]">Includes {quote.includedTeams} teams{quote.additionalTeamBlocks ? `, ${quote.additionalTeamBlocks} additional capacity block${quote.additionalTeamBlocks === 1 ? '' : 's'}` : ''}.</p> : null}
        {billingCycle === 'annual' && quote.annualSavingsPence > 0 ? <p className="text-sm font-semibold text-[#047857]">12 months monthly would be {formatPence(quote.monthlyPence * 12)}. Save {formatPence(quote.annualSavingsPence)}.</p> : null}
      </div>
    </section>
  )
}
