import { Link } from 'react-router-dom'

export function PlayerStatsCards({
  evaluatedPlayerCount,
  squadPlayerCount,
  totalEvaluations,
  trialPlayerCount,
}) {
  const cards = [
    {
      label: 'Trial players',
      value: trialPlayerCount,
      detail: 'Active footballers still waiting for the club decision.',
      to: '/players/current?section=Trial',
      action: 'Open trial list',
      tone: 'border-[#fedf89] bg-[#fffaeb] text-[#93370d]',
    },
    {
      label: 'Squad players',
      value: squadPlayerCount,
      detail: 'Available for sessions, parent updates, and match day work.',
      to: '/players/current?section=Squad',
      action: 'Open squad list',
      tone: 'border-[#b2ddff] bg-[#eff8ff] text-[#175cd3]',
    },
    {
      label: 'Development records',
      value: totalEvaluations,
      detail: `${evaluatedPlayerCount} players have coach history attached.`,
      to: '/assess-player/completed',
      action: 'Review records',
      tone: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Link
          key={card.label}
          to={card.to}
          aria-label={card.action}
          className="group block rounded-lg border border-[#d8e3ee] bg-white p-5 shadow-sm shadow-[#0f172a]/5 transition hover:-translate-y-0.5 hover:border-[#2563eb] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#475569]">{card.label}</p>
              <p className="mt-3 text-4xl font-black tracking-tight text-[#0f172a]">{card.value}</p>
            </div>
            <span className={['inline-flex min-h-8 items-center rounded-lg border px-3 text-xs font-black', card.tone].join(' ')}>
              Register
            </span>
          </div>
          <p className="mt-3 min-h-10 text-sm font-semibold leading-5 text-[#475569]">{card.detail}</p>
          <span className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#0f172a] px-4 py-2 text-sm font-black text-white transition group-hover:bg-[#1d4ed8]">
            {card.action}
          </span>
        </Link>
      ))}
    </div>
  )
}
