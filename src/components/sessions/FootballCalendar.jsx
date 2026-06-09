const viewButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-xs font-black transition'
const calendarCardClass = 'rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5'

function toDateOnly(value) {
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

function getDateKey(date) {
  return date.toISOString().slice(0, 10)
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
  const startOffset = (firstDay.getDay() + 6) % 7
  const startDate = new Date(firstDay)
  startDate.setDate(firstDay.getDate() - startOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    return date
  })
}

function getEventTone(type) {
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

export function FootballCalendar({
  cursor,
  events,
  isLoading,
  onCursorChange,
  onOpenEvent,
  onViewChange,
  view,
}) {
  const eventByDate = events.reduce((map, event) => {
    if (!map.has(event.date)) {
      map.set(event.date, [])
    }
    map.get(event.date).push(event)
    return map
  }, new Map())
  const monthDates = getMonthGrid(cursor)
  const weekDates = getWeekDates(cursor)

  const moveCursor = (offset) => {
    const nextDate = new Date(cursor)
    if (view === 'week') {
      nextDate.setDate(cursor.getDate() + offset * 7)
    } else {
      nextDate.setMonth(cursor.getMonth() + offset)
    }
    onCursorChange(nextDate)
  }

  const moveToToday = () => {
    onCursorChange(new Date())
  }

  const titleLabel = view === 'week' ? getWeekTitle(cursor) : getMonthTitle(cursor)

  return (
    <section className={calendarCardClass}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Calendar</p>
          <h2 className="mt-2 text-xl font-black tracking-tight text-[#101828]">Football activity</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Sessions, match days, parent response cut offs, and saved development activity.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 gap-2">
            {['month', 'week'].map((item) => (
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
                {item === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-2">
            <button type="button" onClick={() => moveCursor(-1)} className={viewButtonClass + ' border-[#d7e5dc] bg-white text-[#101828]'}>
              Prev
            </button>
            <button type="button" onClick={moveToToday} className={viewButtonClass + ' border-[#d7e5dc] bg-white text-[#101828]'}>
              Today
            </button>
            <p className="min-w-[6.5rem] text-center text-xs font-black text-[#101828] sm:min-w-[9rem] sm:text-sm">{titleLabel}</p>
            <button type="button" onClick={() => moveCursor(1)} className={viewButtonClass + ' border-[#d7e5dc] bg-white text-[#101828]'}>
              Next
            </button>
          </div>
        </div>
      </div>

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

              return (
                <div key={dateKey} className="min-h-[4.8rem] border-b border-r border-[#d7e5dc] bg-white p-1 sm:min-h-[8rem] sm:p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={isCurrentMonth ? 'text-xs font-black text-[#101828] hover:text-[#047857] sm:text-sm' : 'text-xs font-black text-[#9aa89f] hover:text-[#047857] sm:text-sm'}
                      title={formatDateLabel(dateKey)}
                    >
                      {date.getDate()}
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
                        title={event.title}
                        className={`block w-full truncate rounded-md border px-1 py-0.5 text-left text-[0.62rem] font-black leading-3 sm:px-2 sm:py-1 sm:text-xs sm:leading-4 ${getEventTone(event.type)}`}
                      >
                        {event.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 ? (
                      <p className="px-1 pt-0.5 text-[0.62rem] font-bold text-[#4b5f55] sm:px-2 sm:pt-1 sm:text-xs">+{dayEvents.length - 3} more</p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-lg border border-[#d7e5dc] bg-[#f7faf8]">
          <div className="divide-y divide-[#d7e5dc] sm:hidden">
            {weekDates.map((date) => {
              const dateKey = getDateKey(date)
              const dayEvents = eventByDate.get(dateKey) ?? []

              return (
                <div key={dateKey} className="bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">
                        {date.toLocaleDateString('en-GB', { weekday: 'long' })}
                      </p>
                      <p className="mt-1 text-sm font-black text-[#101828]">{formatDateLabel(dateKey)}</p>
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
                        className={`block min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm font-black leading-5 ${getEventTone(event.type)}`}
                      >
                        <span className="block">{event.title}</span>
                        {event.time ? <span className="mt-1 block text-xs font-semibold opacity-80">{event.time}</span> : null}
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

              return (
                <div key={dateKey} className="min-h-[14rem] border-b border-[#d7e5dc] bg-white p-3 sm:border-r">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-[#047857]">
                      {date.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </p>
                    <p className="mt-1 text-lg font-black text-[#101828]">{date.getDate()}</p>
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
                        className={`block w-full rounded-md border px-3 py-2 text-left text-xs font-black leading-4 ${getEventTone(event.type)}`}
                      >
                        <span className="block">{event.title}</span>
                        {event.time ? <span className="mt-1 block font-semibold opacity-80">{event.time}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
