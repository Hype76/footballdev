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
      detail: 'Active players still waiting for the club decision.',
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
      tone: 'border-[#bbf7d0] bg-[#ecfdf5] text-[#065f46]',
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Link
          key={card.label}
          to={card.to}
          aria-label={card.action}
          className="group block rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#101828]/5 transition hover:-translate-y-0.5 hover:border-[#047857] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#047857]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#4b5f55]">{card.label}</p>
              <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{card.value}</p>
            </div>
            <span className={['inline-flex min-h-8 items-center rounded-lg border px-3 text-xs font-black', card.tone].join(' ')}>
              Register
            </span>
          </div>
          <p className="mt-3 min-h-10 text-sm font-semibold leading-5 text-[#4b5f55]">{card.detail}</p>
          <span className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition group-hover:bg-[#065f46]">
            {card.action}
          </span>
        </Link>
      ))}
    </div>
  )
}
