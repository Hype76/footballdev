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
      detail: 'Need decisions before they become squad ready.',
      to: '/players/current?section=Trial',
      action: 'Open trial list',
      tone: 'border-amber-300 bg-amber-50 text-amber-900',
    },
    {
      label: 'Squad players',
      value: squadPlayerCount,
      detail: 'Available for team planning and match day work.',
      to: '/players/current?section=Squad',
      action: 'Open squad list',
      tone: 'border-sky-300 bg-sky-50 text-sky-900',
    },
    {
      label: 'Assessments',
      value: totalEvaluations,
      detail: `${evaluatedPlayerCount} players have assessment history.`,
      to: '/assess-player/completed',
      action: 'Review assessments',
      tone: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Link
          key={card.label}
          to={card.to}
          aria-label={card.action}
          className="group block rounded-md border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
              <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{card.value}</p>
            </div>
            <span className={['inline-flex min-h-8 items-center rounded-md border px-3 text-xs font-black', card.tone].join(' ')}>
              Live
            </span>
          </div>
          <p className="mt-3 min-h-10 text-sm leading-5 text-slate-600">{card.detail}</p>
          <span className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md bg-slate-950 px-4 py-2 text-sm font-black text-white transition group-hover:bg-emerald-700">
            {card.action}
          </span>
        </Link>
      ))}
    </div>
  )
}
