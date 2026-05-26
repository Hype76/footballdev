import { Link } from 'react-router-dom'

export function PageHeader({ eyebrow, title, description, action, tourId = 'page-header' }) {
  return (
    <div
      data-tour-id={tourId}
      className="overflow-hidden rounded-lg border border-[#b7efce] bg-white shadow-sm shadow-[#067a46]/5"
    >
      <div className="grid gap-5 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#05603a]">{eyebrow}</p>
              <h2 className="mt-3 break-words text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">{title}</h2>
            </div>
            <Link
              to="/"
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#cfeedd] bg-white px-3 py-2 text-sm font-black text-[#101828] shadow-sm transition hover:bg-[#f8fdf9] focus:outline-none focus:ring-2 focus:ring-[#20a464] focus:ring-offset-2 focus:ring-offset-white lg:hidden"
            >
              Home
            </Link>
          </div>
          <p className="mt-3 max-w-3xl text-base font-semibold leading-7 text-[#456653]">{description}</p>
        </div>
        {action ? <div className="w-full shrink-0 sm:w-auto">{action}</div> : null}
      </div>
    </div>
  )
}
