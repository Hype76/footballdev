import { useState } from 'react'

const viewButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-black transition'
const calendarCardClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5'

function toDateOnly(value) {
  if (value instanceof Date) {
    return getDateKey(value)
  }

  const normalizedValue = String(value ?? '').trim()
  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

function formatDateLabel(value) {
  const dateOnly = toDateOnly(value)
  if (!dateOnly) {
    return 'No date'
  }

  const date = new Date(`${dateOnly}T00:00:00`)
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function getMonthTitle(date) {
  return date.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

function getWeekTitle(date) {
  const weekDates = getWeekDates(date)
  const firstDate = weekDates[0]
  const lastDate = weekDates[6]
  const firstLabel = firstDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
  const lastLabel = lastDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return `${firstLabel} to ${lastLabel}`
}

function getAgendaTitle(events) {
  const firstEvent = events[0]
  const lastEvent = events[events.length - 1]

  if (!firstEvent || !lastEvent) {
    return 'Agenda'
  }

  const firstLabel = formatDateLabel(firstEvent.date)
  const lastLabel = formatDateLabel(lastEvent.date)

  return firstLabel === lastLabel ? firstLabel : `${firstLabel} to ${lastLabel}`
}

function getDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekDates(cursor) {
  const startOffset = (cursor.getDay() + 6) % 7
  const startDate = new Date(cursor)
  startDate.setDate(cursor.getDate() - startOffset)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    return date
  })
}

function getMonthGrid(cursor) {
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7
  const visibleDayCount = Math.ceil((startOffset + daysInMonth) / 7) * 7
  const startDate = new Date(firstDay)
  startDate.setDate(firstDay.getDate() - startOffset)

  return Array.from({ length: visibleDayCount }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    return date
  })
}

function getEventTypeTone(type) {
  const tones = {
    'club-event': 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828]',
    match: 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]',
    'match-day': 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]',
    training: 'border-[#d7e5dc] bg-white text-[#101828]',
    deadline: 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]',
    development: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
    'assessment-reminder': 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]',
  }

  return tones[type] || tones.training
}

const calendarVisualToneStyles = {
  accepted: {
    surface: 'border-[#86efac] bg-[#f0fdf4] text-[#166534]',
    badge: 'border-[#86efac] bg-white text-[#166534]',
    dot: 'bg-[#16a34a]',
  },
  declined: {
    surface: 'border-[#fca5a5] bg-[#fef2f2] text-[#991b1b]',
    badge: 'border-[#fca5a5] bg-white text-[#991b1b]',
    dot: 'bg-[#dc2626]',
  },
  action_required: {
    surface: 'border-[#fcd34d] bg-[#fffbeb] text-[#92400e]',
    badge: 'border-[#fcd34d] bg-white text-[#92400e]',
    dot: 'bg-[#d97706]',
  },
  informational: {
    surface: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
    badge: 'border-[#bfdbfe] bg-white text-[#1d4ed8]',
    dot: 'bg-[#2563eb]',
  },
  past: {
    surface: 'border-[#cbd5e1] bg-[#f8fafc] text-[#64748b]',
    badge: 'border-[#cbd5e1] bg-white text-[#64748b]',
    dot: 'bg-[#94a3b8]',
  },
  cancelled_or_postponed: {
    surface: 'border-dashed border-[#94a3b8] bg-[#f1f5f9] text-[#475569]',
    badge: 'border-dashed border-[#94a3b8] bg-white text-[#475569]',
    dot: 'bg-[#64748b]',
  },
}

const calendarStatusLegend = [
  { state: 'action_required', label: 'Response needed' },
  { state: 'accepted', label: 'Accepted or confirmed' },
  { state: 'declined', label: 'Declined or unavailable' },
  { state: 'informational', label: 'Information' },
  { state: 'past', label: 'Past' },
  { state: 'cancelled_or_postponed', label: 'Cancelled or postponed' },
]

function getCalendarVisualStyle(event) {
  const state = String(event?.calendarVisualState?.state ?? '').trim()
  return calendarVisualToneStyles[state] || null
}

function getEventTone(event) {
  return getCalendarVisualStyle(event)?.surface || getEventTypeTone(event?.type)
}

function getEventStatusLabel(event) {
  return String(event?.calendarVisualState?.label ?? '').trim()
}

function getEventAccessibleName(event) {
  return [
    event?.title,
    event?.childName ? `Child: ${event.childName}` : '',
    event?.date,
    event?.time ? `Time: ${event.time}` : '',
    getEventContextLabel(event),
    getEventStatusLabel(event) ? `Status: ${getEventStatusLabel(event)}` : '',
  ].filter(Boolean).join(', ')
}

function CalendarEventStatusCue({ compact = false, event }) {
  const style = getCalendarVisualStyle(event)
  const label = getEventStatusLabel(event)

  if (!style || !label) {
    return null
  }

  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.58rem] font-black leading-3 sm:px-2 sm:text-[0.65rem] ${style.badge}`}
      title={`Status: ${label}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      <span className={compact ? 'hidden truncate sm:inline' : 'truncate'}>{label}</span>
      {compact ? <span className="sr-only sm:hidden">{label}</span> : null}
    </span>
  )
}

function getEventScopeLabel(event) {
  return event?.isClubWide || event?.isInheritedClubEvent ? 'Club-wide' : ''
}

function getEventContextLabel(event) {
  return String(event?.contextLabel ?? '').trim()
}

function groupAgendaEvents(events) {
  const todayKey = getDateKey(new Date())
  const orderedEvents = [...events]
    .filter((event) => event.date >= todayKey)
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      String(left.time || '').localeCompare(String(right.time || '')) ||
      left.title.localeCompare(right.title),
    )
  const groupedEvents = []

  orderedEvents.forEach((event) => {
    const lastGroup = groupedEvents[groupedEvents.length - 1]

    if (!lastGroup || lastGroup.date !== event.date) {
      groupedEvents.push({
        date: event.date,
        events: [event],
      })
      return
    }

    lastGroup.events.push(event)
  })

  return groupedEvents
}

export function FootballCalendar({
  cursor,
  description = 'Sessions, match days, response deadlines, and shared development updates.',
  events,
  isLoading,
  onCursorChange,
  onOpenEvent,
  onViewChange,
  title = 'Activity',
  view,
}) {
  const [expandedDay, setExpandedDay] = useState(null)
  const eventByDate = events.reduce((map, event) => {
    if (!map.has(event.date)) {
      map.set(event.date, [])
    }
    map.get(event.date).push(event)
    return map
  }, new Map())
  const monthDates = getMonthGrid(cursor)
  const weekDates = getWeekDates(cursor)
  const agendaGroups = groupAgendaEvents(events)
  const agendaEvents = agendaGroups.flatMap((group) => group.events)
  const todayKey = getDateKey(new Date())
  const showStatusKey = events.some((event) => getCalendarVisualStyle(event))

  const moveCursor = (offset) => {
    const nextDate = new Date(cursor)
    if (view === 'week' || view === 'agenda') {
      nextDate.setDate(cursor.getDate() + offset * 7)
    } else {
      nextDate.setMonth(cursor.getMonth() + offset)
    }
    onCursorChange(nextDate)
  }

  const moveToToday = () => {
    onCursorChange(new Date())
  }

  const titleLabel = view === 'agenda' ? getAgendaTitle(agendaEvents) : view === 'week' ? getWeekTitle(cursor) : getMonthTitle(cursor)
  const expandedDayEvents = expandedDay ? eventByDate.get(expandedDay) ?? [] : []

  return (
    <section className={calendarCardClass}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Calendar</p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-[#101828]">{title}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            {description}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center xl:min-w-[31rem]">
          <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-1.5">
            {['month', 'week', 'agenda'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onViewChange(item)}
                className={[
                  viewButtonClass,
                  view === item
                    ? 'border-[#047857] bg-[#047857] text-white'
                    : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857] hover:bg-[#ecfdf5]',
                ].join(' ')}
              >
                {item === 'month' ? 'Month' : item === 'week' ? 'Week' : 'Agenda'}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-2">
            <p className="mb-2 min-w-0 text-center text-sm font-black text-[#101828]">{titleLabel}</p>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => moveCursor(-1)} className={viewButtonClass + ' border-[#d7e5dc] bg-white text-[#101828]'}>
                Prev
              </button>
              <button type="button" onClick={moveToToday} className={viewButtonClass + ' border-[#d7e5dc] bg-white text-[#101828]'}>
                Today
              </button>
              <button type="button" onClick={() => moveCursor(1)} className={viewButtonClass + ' border-[#d7e5dc] bg-white text-[#101828]'}>
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {showStatusKey ? (
        <div aria-label="Calendar status key" className="mt-4 flex flex-wrap gap-2" role="list">
          {calendarStatusLegend.map((item) => {
            const style = calendarVisualToneStyles[item.state]
            return (
              <span key={item.state} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.65rem] font-black ${style.badge}`} role="listitem">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${style.dot}`} />
                {item.label}
              </span>
            )
          })}
        </div>
      ) : null}

      {isLoading ? (
        <p className="mt-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-bold text-[#4b5f55]">
          Loading calendar activity...
        </p>
      ) : view === 'month' ? (
        <div className="mt-5 overflow-hidden rounded-lg border border-[#d7e5dc] bg-[#f7faf8]">
          <div className="grid grid-cols-7 border-b border-[#d7e5dc] bg-white text-center text-xs font-black uppercase tracking-[0.12em] text-[#047857]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} className="px-2 py-3">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDates.map((date) => {
              const dateKey = getDateKey(date)
              const dayEvents = eventByDate.get(dateKey) ?? []
              const isCurrentMonth = date.getMonth() === cursor.getMonth()
              const isToday = dateKey === todayKey

              return (
                <div
                  key={dateKey}
                  className={[
                    'min-h-[4.8rem] border-b border-r p-1 sm:min-h-[8rem] sm:p-2',
                    isToday
                      ? 'border-[#047857] bg-[#ecfdf5] ring-2 ring-inset ring-[#047857]'
                      : 'border-[#d7e5dc] bg-white',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={isToday ? 'inline-flex min-h-7 min-w-7 items-center justify-center rounded-full bg-[#047857] px-2 text-xs font-black text-white sm:text-sm' : isCurrentMonth ? 'text-xs font-black text-[#101828] hover:text-[#047857] sm:text-sm' : 'text-xs font-black text-[#9aa89f] hover:text-[#047857] sm:text-sm'}
                        title={formatDateLabel(dateKey)}
                      >
                        {date.getDate()}
                      </span>
                      {isToday ? (
                        <span className="hidden truncate text-[0.58rem] font-black uppercase tracking-[0.12em] text-[#047857] sm:inline">
                          Today
                        </span>
                      ) : null}
                    </span>
                    {dayEvents.length > 0 ? (
                      <span className="rounded-full bg-[#ecfdf5] px-1.5 py-0.5 text-[0.6rem] font-black text-[#047857] sm:px-2 sm:py-1 sm:text-[0.65rem]">
                        {dayEvents.length}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 space-y-1 sm:mt-2">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onOpenEvent(event)}
                        aria-label={getEventAccessibleName(event)}
                        title={getEventAccessibleName(event)}
                        className={`block w-full overflow-hidden rounded-md border px-1 py-0.5 text-left text-[0.62rem] font-black leading-3 sm:px-2 sm:py-1 sm:text-xs sm:leading-4 ${getEventTone(event)}`}
                      >
                        <span className="block truncate">{event.title}</span>
                        {getEventScopeLabel(event) ? <span className="ml-1 opacity-80">Club-wide</span> : null}
                        {getEventContextLabel(event) ? (
                          <span className="block truncate text-[0.55rem] font-semibold opacity-80 sm:text-[0.65rem]">
                            {getEventContextLabel(event)}
                          </span>
                        ) : null}
                        <span className="mt-1 block">
                          <CalendarEventStatusCue compact event={event} />
                        </span>
                      </button>
                    ))}
                    {dayEvents.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedDay(dateKey)}
                        className="w-full rounded-md px-1 pt-0.5 text-left text-[0.62rem] font-black text-[#047857] transition hover:bg-[#ecfdf5] sm:px-2 sm:pt-1 sm:text-xs"
                      >
                        +{dayEvents.length - 3} more
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : view === 'week' ? (
        <div className="mt-5 overflow-hidden rounded-lg border border-[#d7e5dc] bg-[#f7faf8]">
          <div className="divide-y divide-[#d7e5dc] sm:hidden">
            {weekDates.map((date) => {
              const dateKey = getDateKey(date)
              const dayEvents = eventByDate.get(dateKey) ?? []
              const isToday = dateKey === todayKey

              return (
                <div key={dateKey} className={isToday ? 'border-l-4 border-[#047857] bg-[#ecfdf5] p-3' : 'bg-white p-3'}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">
                        {date.toLocaleDateString('en-GB', { weekday: 'long' })}
                      </p>
                      <p className="mt-1 text-sm font-black text-[#101828]">
                        {formatDateLabel(dateKey)}
                        {isToday ? <span className="ml-2 rounded-full bg-[#047857] px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.12em] text-white">Today</span> : null}
                      </p>
                    </div>
                    {dayEvents.length > 0 ? (
                      <span className="rounded-full bg-[#ecfdf5] px-2 py-1 text-xs font-black text-[#047857]">
                        {dayEvents.length}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-2">
                    {dayEvents.length === 0 ? (
                      <p className="rounded-md border border-dashed border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-xs font-bold text-[#6d8076]">
                        No activity
                      </p>
                    ) : null}
                    {dayEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onOpenEvent(event)}
                        aria-label={getEventAccessibleName(event)}
                        title={getEventAccessibleName(event)}
                        className={`block min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm font-black leading-5 ${getEventTone(event)}`}
                      >
                        <span className="block">{event.title}</span>
                        {getEventContextLabel(event) ? <span className="mt-1 block text-xs font-semibold opacity-80">{getEventContextLabel(event)}</span> : null}
                        {getEventScopeLabel(event) ? <span className="mt-1 block text-xs font-semibold opacity-80">{getEventScopeLabel(event)}</span> : null}
                        {event.time ? <span className="mt-1 block text-xs font-semibold opacity-80">{event.time}</span> : null}
                        <span className="mt-2 block">
                          <CalendarEventStatusCue event={event} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="hidden sm:grid sm:grid-cols-7">
            {weekDates.map((date) => {
              const dateKey = getDateKey(date)
              const dayEvents = eventByDate.get(dateKey) ?? []
              const isToday = dateKey === todayKey

              return (
                <div
                  key={dateKey}
                  className={[
                    'min-h-[14rem] border-b p-3 sm:border-r',
                    isToday
                      ? 'border-[#047857] bg-[#ecfdf5] ring-2 ring-inset ring-[#047857]'
                      : 'border-[#d7e5dc] bg-white',
                  ].join(' ')}
                >
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">
                      {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-lg font-black text-[#101828]">
                      <span>{date.getDate()}</span>
                      {isToday ? <span className="rounded-full bg-[#047857] px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.12em] text-white">Today</span> : null}
                    </p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {dayEvents.length === 0 ? (
                      <p className="rounded-md border border-dashed border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-xs font-bold text-[#6d8076]">
                        No activity
                      </p>
                    ) : null}
                    {dayEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => onOpenEvent(event)}
                        aria-label={getEventAccessibleName(event)}
                        title={getEventAccessibleName(event)}
                        className={`block w-full rounded-md border px-3 py-2 text-left text-xs font-black leading-4 ${getEventTone(event)}`}
                      >
                        <span className="block">{event.title}</span>
                        {getEventContextLabel(event) ? <span className="mt-1 block font-semibold opacity-80">{getEventContextLabel(event)}</span> : null}
                        {getEventScopeLabel(event) ? <span className="mt-1 block font-semibold opacity-80">{getEventScopeLabel(event)}</span> : null}
                        {event.time ? <span className="mt-1 block font-semibold opacity-80">{event.time}</span> : null}
                        <span className="mt-2 block">
                          <CalendarEventStatusCue event={event} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {agendaGroups.length > 0 ? (
            agendaGroups.map((group) => (
              <section key={group.date} className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
                <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{formatDateLabel(group.date)}</p>
                  <p className="mt-1 text-sm font-bold text-[#4b5f55]">{group.events.length} item{group.events.length === 1 ? '' : 's'}</p>
                </div>
                <div className="divide-y divide-[#d7e5dc]">
                  {group.events.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onOpenEvent(event)}
                      aria-label={getEventAccessibleName(event)}
                      title={getEventAccessibleName(event)}
                      className={`block w-full px-4 py-4 text-left transition hover:brightness-[0.98] ${getCalendarVisualStyle(event) ? `border-l-4 ${getCalendarVisualStyle(event).surface}` : 'hover:bg-[#f7faf8]'}`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <span className={`inline-flex w-fit rounded-md border px-2 py-1 text-xs font-black ${getEventTypeTone(event.type)}`}>
                            {event.type === 'match-day' ? 'Match day' : event.type === 'club-event' ? 'Club event' : event.type}
                          </span>
                          <p className="mt-2 text-base font-black text-[#101828]">{event.title}</p>
                          <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                            {[event.time ? `Time: ${event.time}` : '', getEventContextLabel(event), event.location, event.teamName ? `Team: ${event.teamName}` : '', getEventScopeLabel(event)].filter(Boolean).join(', ') || 'Details will appear when the club shares them.'}
                          </p>
                          <span className="mt-2 block">
                            <CalendarEventStatusCue event={event} />
                          </span>
                        </div>
                        <span className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">Open</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-bold text-[#4b5f55]">
              No upcoming agenda items are available.
            </p>
          )}
        </div>
      )}
      {expandedDay ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#101828]/45 px-4 py-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-xl shadow-[#047857]/15"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Calendar day</p>
                <h3 className="mt-2 text-xl font-black tracking-tight text-[#101828]">
                  Events for {formatDateLabel(expandedDay)}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setExpandedDay(null)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-white"
              >
                Close
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {expandedDayEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => {
                    setExpandedDay(null)
                    onOpenEvent(event)
                  }}
                  aria-label={getEventAccessibleName(event)}
                  title={getEventAccessibleName(event)}
                  className={`block w-full rounded-lg border px-4 py-3 text-left text-sm font-black leading-5 ${getEventTone(event)}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {event.time ? <span>{event.time}</span> : null}
                    <span>{event.title}</span>
                    {getEventContextLabel(event) ? (
                      <span className="rounded-full border border-[#bbf7d0] bg-white px-2 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#065f46]">
                        {getEventContextLabel(event)}
                      </span>
                    ) : null}
                    {getEventScopeLabel(event) ? (
                      <span className="rounded-full border border-[#bbf7d0] bg-white px-2 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#065f46]">
                        {getEventScopeLabel(event)}
                      </span>
                    ) : null}
                  </span>
                  {event.location || event.description ? (
                    <span className="mt-1 block text-xs font-semibold opacity-80">
                      {event.location || event.description}
                    </span>
                  ) : null}
                  <span className="mt-2 block">
                    <CalendarEventStatusCue event={event} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
