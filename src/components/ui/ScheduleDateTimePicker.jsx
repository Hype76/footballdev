function padTimePart(value) {
  return String(value).padStart(2, '0')
}

function getTodayDatePart() {
  const now = new Date()
  const offsetMs = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10)
}

function parseDateTimeValue(value) {
  const normalizedValue = String(value ?? '').trim()

  return {
    date: normalizedValue.slice(0, 10),
    hour: normalizedValue.slice(11, 13),
    minute: normalizedValue.slice(14, 16),
  }
}

function buildDateTimeValue({ date, hour, minute }) {
  if (!date || !hour || !minute) {
    return ''
  }

  return `${date}T${hour}:${minute}`
}

function getDefaultTimeParts() {
  const next = new Date(Date.now() + 60 * 60 * 1000)

  return {
    hour: padTimePart(next.getHours()),
    minute: '00',
  }
}

const QUICK_TIMES = [
  { label: '09:00', hour: '09', minute: '00' },
  { label: '12:00', hour: '12', minute: '00' },
  { label: '17:00', hour: '17', minute: '00' },
]

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => padTimePart(index))
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => padTimePart(index))

export function ScheduleDateTimePicker({
  label = 'Send date and time',
  value,
  onChange,
}) {
  const inputClass =
    'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'
  const compactInputClass =
    'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-center text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100'
  const parts = parseDateTimeValue(value)
  const fallbackTime = getDefaultTimeParts()
  const date = parts.date || ''
  const hour = parts.hour || ''
  const minute = parts.minute || ''

  const updateParts = (nextParts) => {
    onChange(buildDateTimeValue({
      date,
      hour,
      minute,
      ...nextParts,
    }))
  }

  const handleDateChange = (event) => {
    updateParts({
      date: event.target.value,
      hour: hour || fallbackTime.hour,
      minute: minute || fallbackTime.minute,
    })
  }

  const handleHourChange = (event) => {
    updateParts({
      date: date || getTodayDatePart(),
      hour: event.target.value,
      minute: minute || '00',
    })
  }

  const handleMinuteChange = (event) => {
    updateParts({
      date: date || getTodayDatePart(),
      hour: hour || fallbackTime.hour,
      minute: event.target.value,
    })
  }

  return (
    <fieldset className="block">
      <legend className="mb-2 block text-sm font-bold text-slate-950">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_5rem_5rem]">
        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">Date</span>
          <input
            type="date"
            value={date}
            onChange={handleDateChange}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">Hour</span>
          <select
            value={hour}
            onChange={handleHourChange}
            className={compactInputClass}
          >
            <option value="">HH</option>
            {HOUR_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-emerald-700">Minute</span>
          <select
            value={minute}
            onChange={handleMinuteChange}
            className={compactInputClass}
          >
            <option value="">MM</option>
            {MINUTE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_TIMES.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => updateParts({
              date: date || getTodayDatePart(),
              hour: option.hour,
              minute: option.minute,
            })}
            className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-slate-50"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
