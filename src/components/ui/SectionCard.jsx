import { useId, useMemo, useState } from 'react'

const SECTION_CARD_STORAGE_PREFIX = 'pf-section-card-open'

function getSectionStorageKey(storageKey, title, tourId) {
  if (storageKey) {
    return `${SECTION_CARD_STORAGE_PREFIX}:${storageKey}`
  }

  const path = typeof window === 'undefined' ? 'app' : window.location.pathname
  const titleSlug = String(tourId || title || 'section')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${SECTION_CARD_STORAGE_PREFIX}:${path}:${titleSlug || 'section'}`
}

function readStoredOpenState(storageKey, defaultOpen) {
  if (typeof window === 'undefined') {
    return defaultOpen
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey)
    if (storedValue === 'open') {
      return true
    }
    if (storedValue === 'closed') {
      return false
    }
  } catch (error) {
    console.error('Section card state could not be read', error)
  }

  return defaultOpen
}

function writeStoredOpenState(storageKey, isOpen) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, isOpen ? 'open' : 'closed')
  } catch (error) {
    console.error('Section card state could not be saved', error)
  }
}

export function SectionCard({
  title,
  description,
  children,
  actions,
  tourId,
  defaultCollapsed = false,
  storageKey,
}) {
  const contentId = useId()
  const cardStorageKey = useMemo(() => getSectionStorageKey(storageKey, title, tourId), [storageKey, title, tourId])
  const [isOpen, setIsOpen] = useState(() => readStoredOpenState(cardStorageKey, !defaultCollapsed))

  function handleToggle() {
    setIsOpen((currentValue) => {
      const nextValue = !currentValue
      writeStoredOpenState(cardStorageKey, nextValue)
      return nextValue
    })
  }

  return (
    <section
      data-tour-id={tourId}
      className="min-w-0 scroll-mt-28 overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/5"
    >
      <div className="flex flex-col gap-4 border-b border-[#cbd5e1] bg-[#f8fafc] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h3 className="text-2xl font-black tracking-tight text-[#0f172a]">{title}</h3>
          {description ? <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#475569]">{description}</p> : null}
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          {actions ? <div className="w-full sm:w-auto">{actions}</div> : null}
          <button
            type="button"
            onClick={handleToggle}
            aria-controls={contentId}
            aria-expanded={isOpen}
            className="inline-flex min-h-10 min-w-[6.25rem] items-center justify-center whitespace-nowrap rounded-lg border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-black text-[#475569] shadow-sm shadow-[#2563eb]/5 transition hover:border-[#2563eb] hover:bg-[#eff6ff]"
          >
            {isOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {isOpen ? (
        <div id={contentId} className="px-5 py-5 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
  )
}
