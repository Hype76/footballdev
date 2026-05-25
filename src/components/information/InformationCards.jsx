import { useState } from 'react'
import { Link } from 'react-router-dom'

export function InfoCard({ title, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-base font-black text-slate-950">{title}</h3>
      <div className="mt-2 text-sm leading-6 text-slate-600">{children}</div>
    </div>
  )
}

function DetailList({ items }) {
  return (
    <div className="mt-4 space-y-2">
      {items.map((item) => (
        <div key={item} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm leading-6 text-slate-700">{item}</p>
        </div>
      ))}
    </div>
  )
}

export function PlanCard({ plan, isCurrent }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-950">{plan.label}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{plan.summary}</p>
        </div>
        {isCurrent ? (
          <span className="inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-800">
            Current
          </span>
        ) : null}
      </div>
      <DetailList items={plan.details} />
    </div>
  )
}

export function RoleCard({ guide }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <h3 className="text-lg font-black text-slate-950">{guide.label}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{guide.summary}</p>
      <DetailList items={guide.capabilities} />
    </div>
  )
}

export function QuickLinks({ links }) {
  if (!links.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
        No quick links are available for this role yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {links.map((link) => (
        <Link
          key={link.path}
          to={link.path}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-xl px-5 py-3 text-sm font-bold transition',
            link.primary
              ? 'bg-emerald-700 text-white hover:bg-emerald-800'
              : 'border border-slate-200 bg-white text-slate-900 hover:bg-slate-50',
          ].join(' ')}
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}

function VideoMedia({ guide }) {
  const [hasVideoError, setHasVideoError] = useState(false)

  if (hasVideoError) {
    return (
      <div className="relative aspect-video w-full overflow-hidden bg-slate-950">
        <img className="h-full w-full object-cover" src={guide.poster} alt="" />
        <div className="absolute inset-x-0 bottom-0 bg-slate-950/80 px-4 py-3 text-sm font-bold text-white">
          Video file will appear here after recording.
        </div>
      </div>
    )
  }

  return (
    <video
      className="aspect-video w-full bg-slate-950"
      controls
      preload="metadata"
      poster={guide.poster}
      aria-label={guide.title}
      onErrorCapture={() => setHasVideoError(true)}
    >
      <source src={guide.src} type="video/mp4" />
      {guide.captions ? <track src={guide.captions} kind="captions" srcLang="en" label="English" default /> : null}
    </video>
  )
}

export function VideoGuideCard({ guide }) {
  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
      <div className="bg-slate-950">
        <VideoMedia guide={guide} />
      </div>
      <div className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-black text-slate-950">{guide.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{guide.caption}</p>
          </div>
          <span className="inline-flex w-fit shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
            {guide.duration}
          </span>
        </div>
        {guide.steps?.length ? <DetailList items={guide.steps} /> : null}
      </div>
    </article>
  )
}

export function VideoGuideGrid({ guides }) {
  if (!guides.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
        No video walkthroughs are available for this role yet.
      </div>
    )
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {guides.map((guide) => (
        <VideoGuideCard key={guide.key} guide={guide} />
      ))}
    </div>
  )
}
