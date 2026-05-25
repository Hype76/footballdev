import { Link } from 'react-router-dom'

export function PageHeader({ eyebrow, title, description, action, tourId = 'page-header' }) {
  return (
    <div
      data-tour-id={tourId}
      className="flex min-w-0 flex-col gap-5 rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm shadow-slate-200/80 sm:px-7 sm:py-8 lg:flex-row lg:items-end lg:justify-between xl:px-9"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">{eyebrow}</p>
            <h2 className="mt-3 break-words text-3xl font-black tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">{title}</h2>
          </div>
          <Link
            to="/"
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 shadow-sm shadow-slate-200/80 transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-white lg:hidden"
          >
            Home
          </Link>
        </div>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{description}</p>
      </div>
      {action ? <div className="w-full shrink-0 sm:w-auto">{action}</div> : null}
    </div>
  )
}
