import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AvailableTemplateFieldsSection } from '../components/parent-email-templates/AvailableTemplateFieldsSection.jsx'
import { TemplateAudienceTabs } from '../components/parent-email-templates/TemplateAudienceTabs.jsx'
import { TemplateEditorSection } from '../components/parent-email-templates/TemplateEditorSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageParentEmailTemplates, useAuth } from '../lib/auth.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import { EMAIL_TEMPLATE_AUDIENCES, EMAIL_TEMPLATE_SECTIONS, validateParentEmailTemplateContent } from '../lib/email-templates.js'
import { deleteParentEmailTemplate } from '../lib/domain/parent-email-templates.js'
import { createCustomParentEmailTemplate, mergeParentEmailTemplates } from '../lib/parent-template-page-utils.js'
import {
  getDefaultClubParentEmailTemplates,
  getParentEmailTemplates,
  upsertParentEmailTemplate,
} from '../lib/supabase.js'

const templateRules = [
  {
    label: 'Audience stays separate',
    body: 'Parent and player messages should not reuse copy without checking the audience.',
  },
  {
    label: 'Approved fields only',
    body: 'Use the listed merge fields so messages can be generated from real workspace data.',
  },
  {
    label: 'Sections control use',
    body: 'A template should only appear in the football workflow sections where it makes sense.',
  },
]

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#067a46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#5f7468]'
const statCardClass = 'rounded-lg border border-[#cfeedd] bg-white px-4 py-4 shadow-sm shadow-[#d7eadf]/70'

export function ParentEmailTemplatesPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [audience, setAudience] = useState(EMAIL_TEMPLATE_AUDIENCES.parent)
  const [templates, setTemplates] = useState(() => mergeParentEmailTemplates([], EMAIL_TEMPLATE_AUDIENCES.parent))
  const [isLoading, setIsLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [deletingKey, setDeletingKey] = useState('')
  const [focusTemplateKey, setFocusTemplateKey] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${user.planKey}:${user.activeTeamId || ''}` : ''

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
          setTemplates(mergeParentEmailTemplates(savedTemplates, audience))
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

  const toggleTemplateSection = (templateKey, section, checked) => {
    setMessage('')
    setErrorMessage('')
    setTemplates((current) =>
      current.map((template) => {
        if (template.key !== templateKey) {
          return template
        }

        const currentSections = Array.isArray(template.sectionAvailability)
          ? template.sectionAvailability.filter((item) => EMAIL_TEMPLATE_SECTIONS.includes(item))
          : [...EMAIL_TEMPLATE_SECTIONS]
        const nextSections = checked
          ? [...new Set([...currentSections, section])]
          : currentSections.filter((item) => item !== section)

        return {
          ...template,
          sectionAvailability: nextSections,
        }
      }),
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

  const addCustomTemplate = () => {
    setMessage('')
    setErrorMessage('')
    const newTemplate = createCustomParentEmailTemplate({
      audience,
      existingTemplates: templates,
    })
    setFocusTemplateKey(newTemplate.key)
    setTemplates((current) => [
      ...current,
      newTemplate,
    ])
  }

  const insertField = (templateKey, fieldKey, selection = null) => {
    setTemplates((current) =>
      current.map((template) =>
        template.key === templateKey
          ? (() => {
              const body = String(template.body ?? '')
              const insertText = `{${fieldKey}}`
              const start = Number(selection?.start)
              const end = Number(selection?.end)
              const hasSelectionRange = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start
              const safeStart = hasSelectionRange ? Math.min(start, body.length) : body.length
              const safeEnd = hasSelectionRange ? Math.min(end, body.length) : body.length

              return {
                ...template,
                body: `${body.slice(0, safeStart)}${insertText}${body.slice(safeEnd)}`,
              }
            })()
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
      setMessage(`${savedTemplate.label} saved for this team.`)
      showToast({ title: 'Template saved', message: `${savedTemplate.label} is available for this team.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save this template.')
      showToast({ title: 'Template not saved', message: error.message || 'Could not save this template.', tone: 'error' })
    } finally {
      setSavingKey('')
    }
  }

  const deleteTemplate = async (template) => {
    setMessage('')
    setErrorMessage('')

    if (!template?.isCustom) {
      setErrorMessage('Default templates cannot be deleted.')
      return
    }

    if (template.id && !window.confirm(`Delete ${template.label}? This cannot be undone.`)) {
      return
    }

    setDeletingKey(template.key)

    try {
      if (template.id) {
        await deleteParentEmailTemplate({ user, template })
      }

      setTemplates((current) => current.filter((item) => item.key !== template.key))
      setMessage(`${template.label} deleted.`)
      showToast({ title: 'Template deleted', message: `${template.label} has been removed.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete this template.')
    } finally {
      setDeletingKey('')
    }
  }

  const enabledTemplateCount = templates.filter((template) => template.isEnabled !== false).length
  const customTemplateCount = templates.filter((template) => template.isCustom).length
  const audienceLabel = audience === EMAIL_TEMPLATE_AUDIENCES.player ? 'player' : 'parent'

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="overflow-hidden rounded-lg border border-[#cfeedd] bg-white shadow-sm shadow-[#d7eadf]/80">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className={eyebrowClass}>Message templates</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-5xl">
              Build the match week messages the club can trust.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475467]">
              Prepare short parent and player updates with approved fields, clear audience rules, and team-specific saved copy.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {templateRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-[#cfeedd] bg-[#f8fdf9] px-4 py-4 shadow-sm shadow-[#d7eadf]/60">
                  <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                  <p className={`mt-2 ${bodyTextClass}`}>{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#cfeedd] bg-[#f8fdf9] p-5 shadow-inner shadow-[#d7eadf]/60">
            <div>
              <p className={eyebrowClass}>Template state</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{enabledTemplateCount} enabled for {audienceLabel} emails</p>
              <p className={`mt-2 ${bodyTextClass}`}>
                {templates.length} templates are loaded for the current audience.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <TemplateMetric label="Loaded" value={templates.length} />
              <TemplateMetric label="Enabled" value={enabledTemplateCount} />
              <TemplateMetric label="Custom" value={customTemplateCount} />
              <TemplateMetric label="Audience" value={audienceLabel} />
            </div>
            <p className={`mt-4 ${bodyTextClass}`}>
              Keep every template practical enough to send from the touchline without rewriting it.
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Template action failed" message={errorMessage} /> : null}
      {message ? <NoticeBanner title="Template saved" message={message} tone="info" /> : null}

      <AvailableTemplateFieldsSection />

      <TemplateAudienceTabs audience={audience} onAudienceChange={setAudience} />

      <TemplateEditorSection
        audience={audience}
        deletingKey={deletingKey}
        focusTemplateKey={focusTemplateKey}
        isLoading={isLoading}
        onAddCustomTemplate={addCustomTemplate}
        onDeleteTemplate={deleteTemplate}
        onFieldInsert={insertField}
        onTemplateFocused={() => setFocusTemplateKey('')}
        onResetTemplate={resetTemplate}
        onSaveTemplate={saveTemplate}
        onSectionToggle={toggleTemplateSection}
        onTemplateChange={updateTemplate}
        savingKey={savingKey}
        templates={templates}
      />

      {!hasPlanFeature(user, 'parentEmail') ? (
        <NoticeBanner title="Parent email unavailable" message={createFeatureUpgradeMessage('parentEmail')} tone="info" />
      ) : null}
    </div>
  )
}

function TemplateMetric({ label, value }) {
  return (
    <div className={statCardClass}>
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-2 break-words text-2xl font-black text-[#101828]">{value}</p>
    </div>
  )
}
