import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EVENT_RESPONSE_FILTERS,
  getEventResponseManagerView,
} from '../../lib/domain/event-response-manager.js'

const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-2.5 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-2.5 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#bbf7d0]'

function formatRespondedAt(value) {
  if (!value) {
    return 'No response'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return 'Response recorded'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

function getEmptyState(activeFilter, hasSearch, total) {
  if (total === 0) {
    return {
      detail: 'Add players through Manage players when this event needs a participant scope.',
      title: 'No players have been added.',
    }
  }

  if (hasSearch) {
    return {
      detail: 'Clear the search or choose another response filter.',
      title: 'No players match this filter.',
    }
  }

  if (activeFilter === EVENT_RESPONSE_FILTERS.deliveryIssue) {
    return {
      detail: 'No invitation delivery needs attention for this event.',
      title: 'No delivery issues.',
    }
  }

  if (activeFilter === EVENT_RESPONSE_FILTERS.awaitingResponse) {
    return {
      detail: 'Every response-required invitation currently has a final response.',
      title: 'No response has been received yet.',
    }
  }

  if (activeFilter === EVENT_RESPONSE_FILTERS.invitationNotSent) {
    return {
      detail: 'Every current participant has a response-enabled or informational invitation.',
      title: 'No invitations have been left unsent.',
    }
  }

  return {
    detail: 'Choose All to review the complete grouped response set.',
    title: 'No players match this filter.',
  }
}

export function EventResponseSummary({
  buttonRef,
  manager,
  onViewResponses,
}) {
  if (!manager || manager.counts.total === 0) {
    return null
  }

  return (
    <section
      aria-labelledby="event-response-summary-title"
      className="mt-4 rounded-lg border border-[#d7e5dc] bg-white p-4"
      data-testid="event-response-summary"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Responses</p>
          <h4 id="event-response-summary-title" className="mt-1 text-base font-black text-[#101828]">
            {manager.counts.total} participant{manager.counts.total === 1 ? '' : 's'}
          </h4>
        </div>
        <span className="w-fit rounded-full border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#065f46]">
          Counts reconcile
        </span>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {manager.summary.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg bg-[#f7faf8] px-3 py-2">
            <dt className="text-sm font-bold text-[#4b5f55]">{item.label}</dt>
            <dd className="text-sm font-black text-[#101828]">{item.count}</dd>
          </div>
        ))}
      </dl>

      {manager.eventType === 'match' ? (
        <div className="mt-4 border-t border-[#d7e5dc] pt-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Match selection</p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f7faf8] px-3 py-2">
              <dt className="text-sm font-bold text-[#4b5f55]">Selected</dt>
              <dd className="text-sm font-black text-[#101828]">{manager.counts.selected}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-[#f7faf8] px-3 py-2">
              <dt className="text-sm font-bold text-[#4b5f55]">Not selected</dt>
              <dd className="text-sm font-black text-[#101828]">{manager.counts.notSelected}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <button
        ref={buttonRef}
        type="button"
        onClick={onViewResponses}
        className={`${primaryButtonClass} mt-4 w-full sm:w-auto`}
      >
        View responses
      </button>
    </section>
  )
}

function ResponseManagerRow({
  activeActionPlayerId,
  eventType,
  isBusy,
  onActionMenuChange,
  onAcceptOnBehalf,
  row,
}) {
  const actionMenuOpen = activeActionPlayerId === row.playerId
  const actionLabel = eventType === 'training'
    ? 'Mark attending on behalf'
    : 'Mark available on behalf'

  return (
    <div
      role="row"
      className="relative grid min-w-0 gap-3 border-b border-[#d7e5dc] px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(12rem,1.6fr)_minmax(8rem,1fr)_minmax(7rem,0.9fr)_minmax(7rem,0.9fr)_minmax(8rem,1fr)_auto] sm:items-center sm:px-4"
      data-player-id={row.playerId}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ecfdf5] text-xs font-black text-[#065f46]"
        >
          {row.initials}
        </span>
        <span className="min-w-0 break-words text-sm font-black text-[#101828]">{row.playerName}</span>
      </div>
      <div role="cell" className="min-w-0">
        <span className="mr-2 text-[11px] font-black uppercase tracking-wide text-[#60756a] sm:hidden">Response</span>
        <span className="text-sm font-black text-[#101828]">{row.responseLabel}</span>
        {row.warningLabel ? <span className="mt-1 block break-words text-xs font-bold text-red-700">{row.warningLabel}</span> : null}
      </div>
      <div role="cell" className="min-w-0">
        <span className="mr-2 text-[11px] font-black uppercase tracking-wide text-[#60756a] sm:hidden">Selection</span>
        <span className="text-sm font-bold text-[#4b5f55]">{row.selectionLabel || 'Not applicable'}</span>
      </div>
      <div role="cell" className="min-w-0">
        <span className="mr-2 text-[11px] font-black uppercase tracking-wide text-[#60756a] sm:hidden">Invitation</span>
        <span className="text-sm font-bold text-[#4b5f55]">{row.deliveryLabel}</span>
      </div>
      <div role="cell" className="min-w-0">
        <span className="mr-2 text-[11px] font-black uppercase tracking-wide text-[#60756a] sm:hidden">Responded</span>
        <span className="block text-sm font-bold text-[#4b5f55]">{formatRespondedAt(row.respondedAt)}</span>
        <span className="mt-1 block text-xs font-semibold text-[#60756a]">{row.responseSourceLabel}</span>
      </div>
      <div role="cell" className="relative flex min-w-0 justify-start sm:justify-end">
        {row.canAcceptOnBehalf ? (
          <>
            <button
              type="button"
              aria-expanded={actionMenuOpen}
              aria-haspopup="menu"
              aria-label={`Actions for ${row.playerName}`}
              onClick={() => onActionMenuChange(actionMenuOpen ? '' : row.playerId)}
              className={secondaryButtonClass}
            >
              Actions
            </button>
            {actionMenuOpen ? (
              <div
                role="menu"
                aria-label={`Actions for ${row.playerName}`}
                className="absolute bottom-full left-0 z-20 mb-2 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-[#d7e5dc] bg-white p-2 shadow-xl shadow-[#101828]/15 sm:bottom-auto sm:left-auto sm:right-0 sm:top-full sm:mb-0 sm:mt-2"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={isBusy}
                  onClick={() => {
                    onActionMenuChange('')
                    onAcceptOnBehalf(row)
                  }}
                  className={`${secondaryButtonClass} w-full justify-start text-left`}
                >
                  {actionLabel}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <span className="text-xs font-bold text-[#60756a]">No action</span>
        )}
      </div>
    </div>
  )
}

export function EventResponseManagerDialog({
  ariaHidden = false,
  dialogRef,
  eventContext = '',
  eventTitle = 'Event responses',
  isBusy = false,
  manager,
  onAcceptOnBehalf,
  onClose,
}) {
  const [activeFilter, setActiveFilter] = useState(EVENT_RESPONSE_FILTERS.all)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeActionPlayerId, setActiveActionPlayerId] = useState('')
  const searchInputRef = useRef(null)
  const view = useMemo(() => getEventResponseManagerView({
    activeFilter,
    model: manager,
    searchTerm,
  }), [activeFilter, manager, searchTerm])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const emptyState = getEmptyState(
    view.activeFilter,
    view.hasSearch,
    manager?.counts?.total ?? 0,
  )

  return (
    <div
      className="fixed inset-0 z-[90] flex h-[100dvh] items-stretch justify-center bg-[#101828]/55 sm:px-4 sm:py-4"
      data-testid="event-response-manager-overlay"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={ariaHidden ? 'true' : undefined}
        aria-labelledby="event-response-manager-title"
        className="flex h-[100dvh] min-h-0 w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl shadow-[#101828]/20 sm:h-[min(92dvh,58rem)] sm:rounded-lg"
        data-testid="event-response-manager"
      >
        <header className="shrink-0 border-b border-[#d7e5dc] bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Responses</p>
              <h2 id="event-response-manager-title" className="mt-2 break-words text-xl font-black text-[#101828] sm:text-2xl">
                {eventTitle}
              </h2>
              {eventContext ? <p className="mt-1 break-words text-sm font-semibold text-[#4b5f55]">{eventContext}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className={secondaryButtonClass}
              aria-label="Close response manager"
            >
              Close
            </button>
          </div>
        </header>

        <div className="shrink-0 border-b border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 sm:px-6">
          <div
            role="tablist"
            aria-label="Response filters"
            className="flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1"
          >
            {(manager?.filters || []).map((filter) => (
              <button
                key={filter.key}
                type="button"
                role="tab"
                aria-selected={view.activeFilter === filter.key}
                onClick={() => {
                  setActiveFilter(filter.key)
                  setActiveActionPlayerId('')
                }}
                className={`${view.activeFilter === filter.key ? primaryButtonClass : secondaryButtonClass} shrink-0`}
              >
                {filter.label} ({filter.count})
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block min-w-0">
              <span className="mb-1 block text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]">Search players</span>
              <input
                ref={searchInputRef}
                type="search"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value)
                  setActiveActionPlayerId('')
                }}
                placeholder="Search by player name"
                className="min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-semibold text-[#101828] outline-none placeholder:text-[#94a3b8] focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]"
              />
            </label>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <p className="text-sm font-black text-[#4b5f55]" aria-live="polite">
                {view.visibleCount} of {manager?.counts?.total ?? 0} players
              </p>
              {searchTerm ? (
                <button type="button" onClick={() => setSearchTerm('')} className={secondaryButtonClass}>
                  Clear search
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-24 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-6">
          {view.groups.length > 0 ? (
            <div
              role="table"
              aria-label={`${eventTitle} response rows`}
              className="overflow-visible rounded-lg border border-[#d7e5dc] bg-white"
            >
              <div
                role="row"
                className="sticky top-0 z-10 hidden grid-cols-[minmax(12rem,1.6fr)_minmax(8rem,1fr)_minmax(7rem,0.9fr)_minmax(7rem,0.9fr)_minmax(8rem,1fr)_auto] gap-3 border-b border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-[#4b5f55] sm:grid"
              >
                <span role="columnheader">Player</span>
                <span role="columnheader">Response</span>
                <span role="columnheader">Selection</span>
                <span role="columnheader">Invitation</span>
                <span role="columnheader">Responded</span>
                <span role="columnheader">Actions</span>
              </div>

              {view.groups.map((group) => (
                <section key={group.key} role="rowgroup" aria-labelledby={`response-group-${group.key}`}>
                  <div role="row" className="sticky top-0 z-[5] border-b border-[#d7e5dc] bg-[#ecfdf5] px-3 py-2 sm:top-11 sm:px-4">
                    <h3
                      id={`response-group-${group.key}`}
                      role="columnheader"
                      aria-colspan="6"
                      className="text-xs font-black uppercase tracking-[0.14em] text-[#065f46]"
                    >
                      {group.label} ({group.rows.length})
                    </h3>
                  </div>
                  {group.rows.map((row) => (
                    <ResponseManagerRow
                      key={row.id}
                      activeActionPlayerId={activeActionPlayerId}
                      eventType={manager.eventType}
                      isBusy={isBusy}
                      onActionMenuChange={setActiveActionPlayerId}
                      onAcceptOnBehalf={onAcceptOnBehalf}
                      row={row}
                    />
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#b8cbc0] bg-[#f7faf8] p-6 text-center">
              <h3 className="text-lg font-black text-[#101828]">{emptyState.title}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{emptyState.detail}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
