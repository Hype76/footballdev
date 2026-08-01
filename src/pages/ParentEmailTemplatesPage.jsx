import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useBlocker, useSearchParams } from 'react-router-dom'
import { TemplateAudienceTabs } from '../components/parent-email-templates/TemplateAudienceTabs.jsx'
import { TemplateEditorSection } from '../components/parent-email-templates/TemplateEditorSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageParentEmailTemplates, useAuth } from '../lib/auth.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature, createUiFeatureUnavailableMessage } from '../lib/paywall-ui.js'
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
      body: 'A template should only appear where it makes sense for parents, players, and team updates.',
    },
]

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const statCardClass = 'rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10'

function getTemplateRouteId(template) {
  return String(template?.key || template?.id || '').trim()
}

function getTemplateSignature(template) {
  return JSON.stringify({
    audience: template?.audience || '',
    body: template?.body || '',
    isEnabled: template?.isEnabled !== false,
    key: template?.key || '',
    label: template?.label || '',
    sectionAvailability: Array.isArray(template?.sectionAvailability) ? template.sectionAvailability : [],
    subject: template?.subject || '',
  })
}

function createTemplateSignatureMap(templates) {
  return Object.fromEntries(templates.map((template) => [template.key, getTemplateSignature(template)]))
}

export function ParentEmailTemplatesPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [audience, setAudience] = useState(EMAIL_TEMPLATE_AUDIENCES.parent)
  const [templates, setTemplates] = useState(() => mergeParentEmailTemplates([], EMAIL_TEMPLATE_AUDIENCES.parent))
  const [savedSignatures, setSavedSignatures] = useState(() => createTemplateSignatureMap(mergeParentEmailTemplates([], EMAIL_TEMPLATE_AUDIENCES.parent)))
  const [isLoading, setIsLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [deletingKey, setDeletingKey] = useState('')
  const [focusTemplateKey, setFocusTemplateKey] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [pendingAudience, setPendingAudience] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${user.planKey}:${user.activeTeamId || ''}` : ''
  const canUseParentEmail = canUseUiFeature(user, CAPABILITIES.parentEmails)
  const selectedTemplateRouteId = String(searchParams.get('templateId') || '').trim()
  const selectedTemplate = templates.find((template) => getTemplateRouteId(template) === selectedTemplateRouteId) || templates[0] || null
  const hasExplicitSelection = Boolean(selectedTemplateRouteId && selectedTemplate)
  const hasUnsavedChanges = useMemo(
    () => templates.some((template) => savedSignatures[template.key] !== getTemplateSignature(template)),
    [savedSignatures, templates],
  )
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges)
  const navigationBlocker = useBlocker(hasUnsavedChanges)

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChangesRef.current) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadTemplates = async () => {
      if (!user?.clubId || !canUseParentEmail) {
        setIsLoading(false)
        return
      }

      setErrorMessage('')

      try {
        const savedTemplates = await getParentEmailTemplates({ user, includeDisabled: true, audience: 'all' })

        if (isMounted) {
          const mergedTemplates = mergeParentEmailTemplates(savedTemplates, audience)
          setTemplates(mergedTemplates)
          setSavedSignatures(createTemplateSignatureMap(mergedTemplates))
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
  }, [audience, canUseParentEmail, user, userScopeKey])

  useEffect(() => {
    if (isLoading || !selectedTemplateRouteId || templates.some((template) => getTemplateRouteId(template) === selectedTemplateRouteId)) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('templateId')
    setSearchParams(nextSearchParams, { replace: true })
  }, [isLoading, searchParams, selectedTemplateRouteId, setSearchParams, templates])

  if (!canManageParentEmailTemplates(user) || !canUseParentEmail) {
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
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('templateId', getTemplateRouteId(newTemplate))
    setSearchParams(nextSearchParams)
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
      setSavedSignatures((current) => ({ ...current, [savedTemplate.key]: getTemplateSignature(savedTemplate) }))
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
      setSavedSignatures((current) => {
        const next = { ...current }
        delete next[template.key]
        return next
      })
      if (getTemplateRouteId(template) === selectedTemplateRouteId) {
        const nextSearchParams = new URLSearchParams(searchParams)
        nextSearchParams.delete('templateId')
        setSearchParams(nextSearchParams, { replace: true })
      }
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

  const selectTemplate = (template) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('templateId', getTemplateRouteId(template))
    setSearchParams(nextSearchParams)
  }

  const returnToTemplateList = () => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('templateId')
    setSearchParams(nextSearchParams, { replace: true })
  }

  const changeAudience = (nextAudience) => {
    if (nextAudience === audience) {
      return
    }

    if (hasUnsavedChanges) {
      setPendingAudience(nextAudience)
      return
    }

    returnToTemplateList()
    setAudience(nextAudience)
  }

  const stayAndContinueEditing = () => {
    setPendingAudience('')
    if (navigationBlocker.state === 'blocked') {
      navigationBlocker.reset()
    }
  }

  const leaveWithoutSaving = () => {
    if (pendingAudience) {
      const nextAudience = pendingAudience
      setPendingAudience('')
      setAudience(nextAudience)
      return
    }

    if (navigationBlocker.state === 'blocked') {
      navigationBlocker.proceed()
    }
  }

  return (
    <>
    <div className="space-y-4 sm:space-y-5">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
          <div className="min-w-0">
            <p className={eyebrowClass}>Message templates</p>
            <h1 className="mt-2 max-w-4xl text-3xl font-black leading-[1.05] tracking-tight text-[#101828] sm:text-4xl">
              Email Templates
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55] sm:text-base">
              Choose one team template, update its approved content and settings, then review it before saving.
            </p>
            <details className="mt-3 max-w-3xl rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
              <summary className="cursor-pointer text-sm font-black text-[#101828]">Template guidance</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {templateRules.map((rule) => (
                  <div key={rule.label}>
                    <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                    <p className={`mt-1 ${bodyTextClass}`}>{rule.body}</p>
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-inner shadow-[#047857]/10">
            <p className={eyebrowClass}>Current team</p>
            <p className="mt-2 text-lg font-black tracking-tight text-[#101828]">{enabledTemplateCount} enabled for {audienceLabel} emails</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <TemplateMetric label="Loaded" value={templates.length} />
              <TemplateMetric label="Enabled" value={enabledTemplateCount} />
              <TemplateMetric label="Custom" value={customTemplateCount} />
              <TemplateMetric label="Audience" value={audienceLabel} />
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Template action failed" message={errorMessage} /> : null}
      {message ? <NoticeBanner title="Template saved" message={message} tone="info" /> : null}

      <TemplateAudienceTabs audience={audience} onAudienceChange={changeAudience} />

      <TemplateEditorSection
        audience={audience}
        deletingKey={deletingKey}
        focusTemplateKey={focusTemplateKey}
        isLoading={isLoading}
        onAddCustomTemplate={addCustomTemplate}
        onDeleteTemplate={deleteTemplate}
        onFieldInsert={insertField}
        onBackToList={returnToTemplateList}
        onSelectTemplate={selectTemplate}
        onTemplateFocused={() => setFocusTemplateKey('')}
        onResetTemplate={resetTemplate}
        onSaveTemplate={saveTemplate}
        onSectionToggle={toggleTemplateSection}
        onTemplateChange={updateTemplate}
        savingKey={savingKey}
        hasExplicitSelection={hasExplicitSelection}
        hasUnsavedChanges={hasUnsavedChanges}
        selectedTemplateKey={selectedTemplate?.key || ''}
        templates={templates}
        user={user}
      />

      {!canUseParentEmail ? (
        <NoticeBanner title="Parent email unavailable" message={createUiFeatureUnavailableMessage(user, CAPABILITIES.parentEmails)} tone="info" />
      ) : null}
    </div>
      <ConfirmModal
        isOpen={Boolean(pendingAudience) || navigationBlocker.state === 'blocked'}
        title="Unsaved template changes"
        message="You have unsaved template changes. Leave without saving?"
        cancelLabel="Stay and continue editing"
        confirmLabel="Leave without saving"
        onCancel={stayAndContinueEditing}
        onClose={stayAndContinueEditing}
        onConfirm={leaveWithoutSaving}
      />
    </>
  )
}

function TemplateMetric({ label, value }) {
  return (
    <div className={`${statCardClass} px-3 py-3`}>
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-1 break-words text-lg font-black text-[#101828]">{value}</p>
    </div>
  )
}
