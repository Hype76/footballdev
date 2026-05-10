import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AvailableTemplateFieldsSection } from '../components/parent-email-templates/AvailableTemplateFieldsSection.jsx'
import { TemplateAudienceTabs } from '../components/parent-email-templates/TemplateAudienceTabs.jsx'
import { TemplateEditorSection } from '../components/parent-email-templates/TemplateEditorSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { canManageParentEmailTemplates, useAuth } from '../lib/auth.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import { EMAIL_TEMPLATE_AUDIENCES, validateParentEmailTemplateContent } from '../lib/email-templates.js'
import { mergeParentEmailTemplates } from '../lib/parent-template-page-utils.js'
import {
  EVALUATION_SECTIONS,
  getDefaultClubParentEmailTemplates,
  getParentEmailTemplates,
  upsertParentEmailTemplate,
} from '../lib/supabase.js'

export function ParentEmailTemplatesPage() {
  const { user } = useAuth()
  const [audience, setAudience] = useState(EMAIL_TEMPLATE_AUDIENCES.parent)
  const [templates, setTemplates] = useState(() => mergeParentEmailTemplates([], EMAIL_TEMPLATE_AUDIENCES.parent))
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
          ? template.sectionAvailability.filter((item) => EVALUATION_SECTIONS.includes(item))
          : [...EVALUATION_SECTIONS]
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

      <AvailableTemplateFieldsSection />

      <TemplateAudienceTabs audience={audience} onAudienceChange={setAudience} />

      <TemplateEditorSection
        audience={audience}
        isLoading={isLoading}
        onFieldInsert={insertField}
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
