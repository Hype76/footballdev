import { useId } from 'react'
import { COACH_DEADLINE_MODES, DEFAULT_COACH_REMINDER_POLICY } from '../../lib/coach-reminder-policy.js'

// Controlled editor, deliberately not mounted in account settings until policy
// ownership is decided. It performs no persistence or communication itself.
export function CoachReminderOptions({ value = DEFAULT_COACH_REMINDER_POLICY, onChange, disabled = false, error = '' }) {
  const options = { ...DEFAULT_COACH_REMINDER_POLICY, ...value }
  const helpId = useId()
  const update = (field, next) => onChange({ ...options, [field]: next })
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3" aria-describedby={helpId}>
      <legend className="text-sm font-bold">Match and training reminder options</legend>
      <p id={helpId} className="text-sm">Applies to future availability invitations. Parents can correct availability after a deadline.</p>
      <label className="flex min-h-11 items-center gap-3 border-b py-2">
        <input type="checkbox" className="!h-5 !w-5 shrink-0" checked={options.reminderEnabled} onChange={event => update('reminderEnabled', event.target.checked)} />
        <span className="min-w-0 flex-1 text-left">Automatically remind players with no answer</span>
      </label>
      {options.reminderEnabled ? (
        <label className="flex min-h-11 items-center justify-between gap-3 border-b py-2">
          Hours after the invitation is delivered
          <input aria-label="Reminder hours" type="number" min="1" max="720" step="1" value={options.reminderAfterHours}
            onChange={event => update('reminderAfterHours', event.target.value)} className="min-h-11 w-24 border px-2" />
        </label>
      ) : null}
      <label className="block border-b py-2">
        <span className="block text-sm">When a response deadline is missed</span>
        <select aria-label="Deadline option" value={options.deadlineMode} onChange={event => update('deadlineMode', event.target.value)} className="mt-1 min-h-11 w-full min-w-0 max-w-full border px-2">
          {Object.entries(COACH_DEADLINE_MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {options.deadlineMode !== 'reminders_only' ? (
        <label className="flex min-h-11 items-center justify-between gap-3 border-b py-2">
          Deadline hours after delivery
          <input aria-label="Deadline hours" type="number" min="1" max="720" step="1" value={options.deadlineAfterHours}
            onChange={event => update('deadlineAfterHours', event.target.value)} className="min-h-11 w-24 border px-2" />
        </label>
      ) : null}
      <label className="flex min-h-11 items-center gap-3 border-b py-2">
        <input type="checkbox" className="!h-5 !w-5 shrink-0" checked={options.squadReminderEnabled} onChange={event => update('squadReminderEnabled', event.target.checked)} />
        <span className="min-w-0 flex-1 text-left">Remind team coaches when the match squad is unselected</span>
      </label>
      {options.squadReminderEnabled ? (
        <label className="flex min-h-11 items-center justify-between gap-3 border-b py-2">
          Calendar days before the match
          <input aria-label="Squad reminder days" type="number" min="1" max="30" step="1" value={options.squadDaysBefore}
            onChange={event => update('squadDaysBefore', event.target.value)} className="min-h-11 w-24 border px-2" />
        </label>
      ) : null}
      {options.deadlineMode === 'automatic_not_attending' ? <p className="text-sm">Automatic not attending is labelled as a coach deadline action. Explicit answers stay unchanged.</p> : null}
      {error ? <p role="alert" className="text-sm">{error}</p> : null}
    </fieldset>
  )
}
