import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageParentEmailTemplates, useAuth } from '../lib/auth.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import { EMAIL_TEMPLATE_AUDIENCES, EMAIL_TEMPLATE_FIELDS, validateParentEmailTemplateContent } from '../lib/email-templates.js'
import {
  getDefaultClubParentEmailTemplates,
  getParentEmailTemplates,
  upsertParentEmailTemplate,
} from '../lib/supabase.js'

function mergeTemplates(savedTemplates, audience) {
  const savedByKey = new Map(
    savedTemplates
      .filter((template) => template.audience === audience)
      .map((template) => [template.key, template]),
  )

  return getDefaultClubParentEmailTemplates(audience).map((defaultTemplate) => ({
    ...defaultTemplate,
    ...(savedByKey.get(defaultTemplate.key) ?? {}),
    audience,
  }))
}

export function ParentEmailTemplatesPage() {
  const { user } = useAuth()
  const [audience, setAudience] = useState(EMAIL_TEMPLATE_AUDIENCES.parent)
  const [templates, setTemplates] = useState(() => mergeTemplates([], EMAIL_TEMPLATE_AUDIENCES.parent))
  const [isLoading, setIsLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${user.planKey}` : ''

  useEffect(() => {
    let isMounted = true

    const loadTemplates = async () => {
      if (!user?.clubId || !hasPlanFeature(user, 'parentEmail')) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const savedTemplates = await getParentEmailTemplates({ user, includeDisabled: true, audience: 'all' })

        if (isMounted) {
          setTemplates(mergeTemplates(savedTemplates, audience))
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Could not load parent email templates.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadTemplates()

    return () => {
      isMounted = false
    }
  }, [audience, user, userScopeKey])

  if (!canManageParentEmailTemplates(user) || !hasPlanFeature(user, 'parentEmail')) {
    return <Navigate to="/" replace />
  }

  const updateTemplate = (templateKey, fieldName, value) => {
    setMessage('')
    setErrorMessage('')
    setTemplates((current) =>
      current.map((template) =>
        template.key === templateKey
          ? {
              ...template,
              [fieldName]: fieldName === 'isEnabled' ? Boolean(value) : value,
            }
          : template,
      ),
    )
  }

  const resetTemplate = (templateKey) => {
    const defaultTemplate = getDefaultClubParentEmailTemplates(audience).find((template) => template.key === templateKey)

    if (!defaultTemplate) {
      return
    }

    setTemplates((current) => current.map((template) => (template.key === templateKey ? { ...template, ...defaultTemplate } : template)))
    setMessage('')
    setErrorMessage('')
  }

  const insertField = (templateKey, fieldKey) => {
    setTemplates((current) =>
      current.map((template) =>
        template.key === templateKey
          ? {
              ...template,
              body: `${String(template.body ?? '').trimEnd()}\n{${fieldKey}}`,
            }
          : template,
      ),
    )
  }

  const saveTemplate = async (template) => {
    setSavingKey(template.key)
    setMessage('')
    setErrorMessage('')

    try {
      validateParentEmailTemplateContent(template)
      const savedTemplate = await upsertParentEmailTemplate({ user, template })
      setTemplates((current) => current.map((item) => (item.key === savedTemplate.key ? savedTemplate : item)))
      setMessage(`${savedTemplate.label} saved for the club.`)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save this template.')
    } finally {
      setSavingKey('')
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Email templates"
        description="Create the club templates used when sending parent or player emails."
      />

      {errorMessage ? <NoticeBanner title="Template action failed" message={errorMessage} /> : null}
      {message ? <NoticeBanner title="Template saved" message={message} tone="info" /> : null}

      <SectionCard
        title="Available fields"
        description="Only these fields can be used inside a subject or body."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {EMAIL_TEMPLATE_FIELDS.map((field) => (
            <div key={field.key} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{field.label}</p>
              <p className="mt-1 font-mono text-xs text-[var(--text-secondary)]">{`{${field.key}}`}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-wrap gap-2">
        {[
          { key: EMAIL_TEMPLATE_AUDIENCES.parent, label: 'Parent Templates' },
          { key: EMAIL_TEMPLATE_AUDIENCES.player, label: 'Player Templates' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setAudience(item.key)}
            className={`inline-flex min-h-11 items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
              audience === item.key
                ? 'border-[var(--accent)] bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                : 'border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <SectionCard title="Templates" description="Loading club templates.">
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading templates...
          </div>
        </SectionCard>
      ) : (
        templates.map((template) => (
          <SectionCard
            key={template.key}
            title={template.label}
            description={
              template.id
                ? `This saved club template is available when sending ${audience} emails.`
                : `Save this default before it can be used for ${audience} emails.`
            }
          >
            <div className="space-y-4">
              <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={template.isEnabled !== false}
                  onChange={(event) => updateTemplate(template.key, 'isEnabled', event.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border-color)]"
                />
                <span>Available for this club</span>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Subject</span>
                <input
                  type="text"
                  value={template.subject}
                  onChange={(event) => updateTemplate(template.key, 'subject', event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Body</span>
                <textarea
                  value={template.body}
                  onChange={(event) => updateTemplate(template.key, 'body', event.target.value)}
                  rows={12}
                  className="w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm leading-6 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                {EMAIL_TEMPLATE_FIELDS.map((field) => (
                  <button
                    key={field.key}
                    type="button"
                    onClick={() => insertField(template.key, field.key)}
                    className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
                  >
                    {`Add {${field.key}}`}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void saveTemplate(template)}
                  disabled={savingKey === template.key}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {savingKey === template.key ? 'Saving...' : 'Save Template'}
                </button>
                <button
                  type="button"
                  onClick={() => resetTemplate(template.key)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] sm:w-auto"
                >
                  Use Default
                </button>
              </div>
            </div>
          </SectionCard>
        ))
      )}

      {!hasPlanFeature(user, 'parentEmail') ? (
        <NoticeBanner title="Parent email unavailable" message={createFeatureUpgradeMessage('parentEmail')} tone="info" />
      ) : null}
    </div>
  )
}
