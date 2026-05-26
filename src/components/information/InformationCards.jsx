import { useState } from 'react'
import { Link } from 'react-router-dom'

const surfaceClass = 'rounded-lg border border-[#bddcca] bg-white shadow-sm shadow-[#067a46]/10'
const insetSurfaceClass = 'rounded-lg border border-[#bddcca] bg-[#f6fbf8] shadow-sm shadow-[#067a46]/10'
const labelClass = 'text-xs font-black uppercase tracking-[0.14em] text-[#067a46]'
const titleClass = 'text-base font-black text-[#10231a]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#456653]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-5 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:bg-[#f6fbf8]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a]'

export function InfoCard({ title, children }) {
  return (
    <div className={`${insetSurfaceClass} p-4`}>
      <h3 className={titleClass}>{title}</h3>
      <div className={`mt-2 ${bodyClass}`}>{children}</div>
    </div>
  )
}

function DetailList({ items }) {
  return (
    <div className="mt-4 space-y-2">
      {items.map((item) => (
        <div key={item} className="flex gap-3 rounded-lg border border-[#bddcca] bg-white px-4 py-3 shadow-sm shadow-[#067a46]/10">
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#067a46]" />
          <p className="text-sm font-semibold leading-6 text-[#4d6458]">{item}</p>
        </div>
      ))}
    </div>
  )
}

export function PlanCard({ plan, isCurrent }) {
  return (
    <div className={`${insetSurfaceClass} p-5`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-[#10231a]">{plan.label}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{plan.summary}</p>
        </div>
        {isCurrent ? (
          <span className="inline-flex w-fit rounded-lg border border-[#bddcca] bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#067a46]">
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
    <div className={`${insetSurfaceClass} p-5`}>
      <h3 className="text-lg font-black text-[#10231a]">{guide.label}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{guide.summary}</p>
      <DetailList items={guide.capabilities} />
    </div>
  )
}

export function QuickLinks({ links }) {
  if (!links.length) {
    return (
      <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
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
          className={link.primary ? primaryButtonClass : secondaryButtonClass}
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
      <div className="grid aspect-video w-full place-items-center bg-[#f0fdf6] p-5">
        <div className="w-full max-w-md rounded-lg border border-[#bddcca] bg-white p-5 text-center shadow-sm shadow-[#067a46]/10">
          <img className="mx-auto h-16 w-16 rounded-lg border border-[#bddcca] bg-[#10231a] object-cover p-1" src={guide.poster} alt="" />
          <p className="mt-4 text-sm font-black text-[#10231a]">Video pending</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">
            This guide has a task checklist now. The recorded video can be added without changing the page layout.
          </p>
        </div>
      </div>
    )
  }

  return (
    <video
      className="aspect-video w-full bg-[#f0fdf6]"
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
    <article className={`overflow-hidden ${surfaceClass}`}>
      <div className="border-b border-[#bddcca] bg-[#f0fdf6]">
        <VideoMedia guide={guide} />
      </div>
      <div className="p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={labelClass}>Video guide</p>
            <h3 className="mt-2 text-lg font-black text-[#10231a]">{guide.title}</h3>
            <p className={`mt-2 ${bodyClass}`}>{guide.caption}</p>
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
      <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
        No video guides are available for this role yet.
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
