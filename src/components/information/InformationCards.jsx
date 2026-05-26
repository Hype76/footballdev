import { useState } from 'react'
import { Link } from 'react-router-dom'

export function InfoCard({ title, children }) {
  return (
    <div className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-4 shadow-sm shadow-[#d7eadf]/60">
      <h3 className="text-base font-black text-[#10231a]">{title}</h3>
      <div className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{children}</div>
    </div>
  )
}

function DetailList({ items }) {
  return (
    <div className="mt-4 space-y-2">
      {items.map((item) => (
        <div key={item} className="rounded-lg border border-[#d7eadf] bg-white px-4 py-3">
          <p className="text-sm font-semibold leading-6 text-[#4d6458]">{item}</p>
        </div>
      ))}
    </div>
  )
}

export function PlanCard({ plan, isCurrent }) {
  return (
    <div className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-5 shadow-sm shadow-[#d7eadf]/60">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-[#10231a]">{plan.label}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{plan.summary}</p>
        </div>
        {isCurrent ? (
          <span className="inline-flex w-fit rounded-lg border border-[#bfe8cd] bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#067a46]">
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
    <div className="rounded-lg border border-[#d7eadf] bg-[#f8fdf9] p-5 shadow-sm shadow-[#d7eadf]/60">
      <h3 className="text-lg font-black text-[#10231a]">{guide.label}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{guide.summary}</p>
      <DetailList items={guide.capabilities} />
    </div>
  )
}

export function QuickLinks({ links }) {
  if (!links.length) {
    return (
      <div className="rounded-lg border border-dashed border-[#bddcca] bg-[#f8fdf9] px-4 py-5 text-sm font-semibold text-[#5f7468]">
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
            'inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-3 text-sm font-bold transition',
            link.primary
              ? 'bg-[#067a46] text-white hover:bg-[#05603a]'
              : 'border border-[#bddcca] bg-white text-[#10231a] hover:bg-[#f8fdf9]',
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
    <article className="overflow-hidden rounded-lg border border-[#d7eadf] bg-[#f8fdf9] shadow-sm shadow-[#d7eadf]/60">
      <div className="bg-slate-950">
        <VideoMedia guide={guide} />
      </div>
      <div className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-black text-[#10231a]">{guide.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#5f7468]">{guide.caption}</p>
          </div>
          <span className="inline-flex w-fit shrink-0 rounded-lg border border-[#bddcca] bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#067a46]">
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
      <div className="rounded-lg border border-dashed border-[#bddcca] bg-[#f8fdf9] px-4 py-5 text-sm font-semibold text-[#5f7468]">
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
