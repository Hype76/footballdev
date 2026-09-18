import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionCard } from '../ui/SectionCard.jsx'
import { NoticeBanner } from '../ui/NoticeBanner.jsx'
import { MATCHDAY_DEFAULT_FLAGS, validateMatchdayFlags } from '../../lib/matchday-policy.js'
import { supabase } from '../../lib/supabase.js'

const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-black text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'

function labelForFlag(key) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase())
}

function readConfig(value) {
  const payload = Array.isArray(value) ? value[0] : value
  if (!payload || typeof payload !== 'object' || !payload.flags) return null
  if (!Number.isInteger(payload.revision)) return null
  return { revision: payload.revision, flags: validateMatchdayFlags(payload.flags) }
}

export function PlatformMatchdayConfigSection() {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const { data, error } = await supabase.rpc('get_matchday_plan_config')
      if (error) throw error
      const next = readConfig(data)
      if (!next) throw new Error('The Matchday plan configuration was not returned in a recognised format.')
      setConfig(next)
      setDraft(next.flags)
    } catch (error) {
      setErrorMessage(error?.message || 'The Matchday plan configuration could not be loaded.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void loadConfig() }, [loadConfig])

  const hasChanges = useMemo(() => Boolean(config && draft && Object.keys(config.flags).some((key) => config.flags[key] !== draft[key])), [config, draft])

  async function handleSave(event) {
    event.preventDefault()
    if (!config || !draft || isSaving) return
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const flags = validateMatchdayFlags(draft)
      const { data, error } = await supabase.rpc('save_matchday_plan_config', { p_flags: flags, p_expected_revision: config.revision })
      if (error) throw error
      const next = readConfig(data)
      if (!next) throw new Error('The saved Matchday plan configuration was not returned.')
      setConfig(next)
      setDraft(next.flags)
      setSuccessMessage('Matchday plan settings saved.')
    } catch (error) {
      const code = String(error?.code || error?.message || '').toLowerCase()
      setErrorMessage(code.includes('revision') || code.includes('conflict')
        ? 'This configuration changed in another session. Reload the latest settings before saving again.'
        : error?.message || 'The Matchday plan settings could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <SectionCard
      title="Matchday plan configuration"
      description="Control the canonical Matchday free tier. Server validation and the expected revision protect concurrent changes."
      storageKey="platform-matchday-plan-config"
    >
      <div className="space-y-4">
        {errorMessage ? <NoticeBanner title="Matchday configuration unavailable" message={errorMessage} /> : null}
        {successMessage ? <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#047857]" role="status">{successMessage}</div> : null}
        {isLoading ? <p className="text-sm font-semibold text-[var(--text-muted)]" role="status">Loading Matchday settings.</p> : null}
        {!isLoading && draft ? (
          <form className="space-y-4" onSubmit={handleSave}>
            <div className="divide-y divide-[var(--border-color)] overflow-hidden rounded-lg border border-[var(--border-color)]">
              {Object.keys(MATCHDAY_DEFAULT_FLAGS).map((key) => (
                <label key={key} className="flex min-h-14 cursor-pointer items-center justify-between gap-4 bg-[var(--panel-bg)] px-4 py-3 hover:bg-[var(--panel-alt)]">
                  <span>
                    <span className="block text-sm font-black text-[var(--text-primary)]">{labelForFlag(key)}</span>
                    <span className="block text-xs font-semibold text-[var(--text-muted)]">{draft[key] ? 'Enabled for Matchday' : 'Disabled for Matchday'}</span>
                  </span>
                  <input type="checkbox" checked={draft[key] === true} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 accent-[var(--accent)]" />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={!hasChanges || isSaving} className={primaryButtonClass}>{isSaving ? 'Saving...' : 'Save Matchday settings'}</button>
              <button type="button" disabled={!hasChanges || isSaving} onClick={() => setDraft(config.flags)} className={secondaryButtonClass}>Discard changes</button>
              <span className="text-xs font-semibold text-[var(--text-muted)]">Revision {config.revision || 'Unknown'}</span>
            </div>
          </form>
        ) : null}
        {!isLoading && !config ? <button type="button" onClick={() => void loadConfig()} className={secondaryButtonClass}>Retry loading settings</button> : null}
      </div>
    </SectionCard>
  )
}
