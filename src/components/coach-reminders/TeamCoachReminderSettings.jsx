import { useEffect, useSyncExternalStore } from 'react'
import { CoachReminderOptions } from './CoachReminderOptions.jsx'

export function TeamCoachReminderSettings({ store }) {
  const state = useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot)
  useEffect(() => { void store.load() },[store])
  return (
    <section className="min-w-0 space-y-3" aria-label="Shared team reminder settings">
      <p className="text-sm">These settings are shared by all authorised coaches for this team.</p>
      {!state.loaded ? <p role="status">{state.busy ? 'Loading team reminder settings...' : 'Team reminder settings could not be loaded.'}</p> : (
        <>
          <CoachReminderOptions value={state.options} disabled={state.busy || state.needsReload} onChange={options => store.edit({ options })} />
          <label className="flex min-h-11 items-center gap-3 border-b py-2">
            <input type="checkbox" className="!h-5 !w-5 shrink-0" disabled={state.busy || state.needsReload} checked={state.optedIn} onChange={event => store.edit({ optedIn:event.target.checked })} />
            <span>Enable this team’s configured reminders and deadlines</span>
          </label>
          {!state.deliveryEnabled ? <p className="text-sm">Automatic reminders are not available yet. Your choices can be saved for later.</p> : null}
        </>
      )}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.notice ? <p role="status">{state.notice}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!state.loaded || state.busy || state.needsReload} onClick={() => { void store.save() }} className="min-h-11 px-3 py-2 font-bold">
          {state.busy ? 'Please wait...' : 'Save team reminders'}
        </button>
        <button type="button" disabled={state.busy} onClick={() => { void store.load() }} className="min-h-11 px-3 py-2">Reload team settings</button>
      </div>
    </section>
  )
}
