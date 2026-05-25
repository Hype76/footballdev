import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AddFieldSection } from '../components/form-builder/AddFieldSection.jsx'
import { CurrentFieldsSection } from '../components/form-builder/CurrentFieldsSection.jsx'
import { DefaultFormSection } from '../components/form-builder/DefaultFormSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageFormFields, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  createDraftFromField,
  createDraftMap,
  createScoreOptions,
  FIELD_PAGE_SIZE,
  getFieldTypeLabel,
  getOptionsForType,
  initialFieldForm,
  isScoreType,
} from '../hooks/form-builder/formBuilderUtils.js'
import {
  addFormField,
  deleteFormField,
  getDefaultFormFields,
  getConfiguredFormFields,
  readViewCache,
  readViewCacheValue,
  reorderFormFields,
  updateFormField,
  writeViewCache,
} from '../lib/supabase.js'

export function FormBuilderPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const defaultTemplateFields = getDefaultFormFields()
  const cacheKey = user?.clubId ? `form-builder:${user.clubId}` : ''
  const cachedBuilderState = readViewCache(cacheKey)
  const [fields, setFields] = useState(() => {
    const cachedFields = readViewCacheValue(cacheKey, 'fields', [])
    return Array.isArray(cachedFields) ? cachedFields : []
  })
  const [fieldDrafts, setFieldDrafts] = useState(() => {
    const cachedDrafts = readViewCacheValue(cacheKey, 'fieldDrafts', null)
    return cachedDrafts && typeof cachedDrafts === 'object' ? cachedDrafts : {}
  })
  const [fieldForm, setFieldForm] = useState(() => {
    const cachedFieldForm = cachedBuilderState?.fieldForm
    return cachedFieldForm && typeof cachedFieldForm === 'object' ? { ...initialFieldForm, ...cachedFieldForm } : initialFieldForm
  })
  const [isLoading, setIsLoading] = useState(() => fields.length === 0)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [fieldGroup, setFieldGroup] = useState('default')
  const [fieldPage, setFieldPage] = useState(1)
  const [fieldDeleteTarget, setFieldDeleteTarget] = useState(null)
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadFields = async () => {
      try {
        const nextFields = await getConfiguredFormFields({ user })

        if (!isMounted) {
          return
        }

        setFields(nextFields)
        setFieldDrafts(createDraftMap(nextFields))
        writeViewCache(cacheKey, {
          fields: nextFields,
          fieldDrafts: createDraftMap(nextFields),
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.fields) {
            setFields([])
            setFieldDrafts({})
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadFields()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, user, userScopeKey])

  useEffect(() => {
    if (!cacheKey) {
      return
    }

    writeViewCache(cacheKey, {
      fields,
      fieldDrafts,
      fieldForm,
    })
  }, [cacheKey, fieldDrafts, fieldForm, fields])

  const refreshFields = async () => {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const nextFields = await getConfiguredFormFields({ user })
      syncFields(nextFields)
      setSuccessMessage(nextFields.length > 0 ? 'Form fields loaded successfully.' : 'Default form is ready to be configured.')
      showToast({ title: 'Fields refreshed', message: 'Assessment fields are up to date.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not load the form fields for this club.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!canManageFormFields(user)) {
    return <Navigate to="/" replace />
  }

  const defaultFields = fields.filter((field) => field.isDefault)
  const customFields = fields.filter((field) => !field.isDefault)
  const visibleFields = fieldGroup === 'default' ? defaultFields : customFields
  const paginatedFields = getPaginatedItems(visibleFields, fieldPage, FIELD_PAGE_SIZE)
  const canUseCustomFields = hasPlanFeature(user, 'customFormFields')
  const enabledFieldsCount = fields.filter((field) => field.isEnabled).length
  const formRules = [
    {
      label: 'Default fields',
      value: defaultFields.length,
      caption: 'Club baseline fields can be reordered and switched on or off.',
      tone: 'emerald',
    },
    {
      label: 'Custom fields',
      value: customFields.length,
      caption: canUseCustomFields ? 'Club-specific fields can be added, edited, and removed.' : 'Upgrade required before custom fields can be added.',
      tone: 'sky',
    },
    {
      label: 'Enabled now',
      value: enabledFieldsCount,
      caption: 'Only enabled fields appear when coaches complete assessments.',
      tone: 'amber',
    },
  ]

  const handleFormChange = (event) => {
    const { name, value, type, checked } = event.target
    setErrorMessage('')
    setSuccessMessage('')

    setFieldForm((current) => {
      const nextValue = type === 'checkbox' ? checked : value
      const nextForm = {
        ...current,
        [name]: nextValue,
      }

      if (name === 'type' && isScoreType(value)) {
        nextForm.options = createScoreOptions(value).join(', ')
      }

      if (name === 'type' && value !== 'select' && !isScoreType(value)) {
        nextForm.options = ''
      }

      return nextForm
    })
  }

  const handleDraftChange = (fieldId, name, value) => {
    setErrorMessage('')
    setSuccessMessage('')
    setFieldDrafts((current) => {
      const nextDraft = {
        ...current[fieldId],
        [name]: value,
      }

      if (name === 'type' && isScoreType(value)) {
        nextDraft.options = createScoreOptions(value).join(', ')
      }

      if (name === 'type' && value !== 'select' && !isScoreType(value)) {
        nextDraft.options = ''
      }

      return {
        ...current,
        [fieldId]: nextDraft,
      }
    })
  }

  const syncFields = (nextFields) => {
    const nextDraftMap = createDraftMap(nextFields)
    setFields(nextFields)
    setFieldDrafts(nextDraftMap)
    writeViewCache(cacheKey, {
      fields: nextFields,
      fieldDrafts: nextDraftMap,
    })
  }

  const saveFieldOrder = async (nextGroupFields) => {
    const nextFields = fieldGroup === 'default'
      ? [...nextGroupFields, ...customFields]
      : [...defaultFields, ...nextGroupFields]
    const normalizedFields = nextFields.map((field, index) => ({
      ...field,
      orderIndex: index + 1,
    }))
    const previousFields = fields
    const previousDrafts = fieldDrafts

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    syncFields(normalizedFields)

    try {
      await reorderFormFields(normalizedFields, user)
      setSuccessMessage('Field order updated.')
      showToast({ title: 'Field order saved', message: 'Assessment field order has been updated.' })
    } catch (error) {
      console.error(error)
      setFields(previousFields)
      setFieldDrafts(previousDrafts)
      setErrorMessage(error.message || 'Could not reorder the fields.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddField = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      if (!canUseCustomFields) {
        throw new Error(createFeatureUpgradeMessage('customFormFields'))
      }

      const createdField = await addFormField({
        user,
        field: {
          ...fieldForm,
          options: getOptionsForType(fieldForm.type, fieldForm.options),
          orderIndex: fields.length + 1,
          isDefault: false,
          isEnabled: true,
        },
      })

      const nextFields = [...fields, createdField].sort((left, right) => left.orderIndex - right.orderIndex)
      syncFields(nextFields)
      setFieldForm(initialFieldForm)
      setSuccessMessage('Field added successfully.')
      showToast({ title: 'Field added', message: `${createdField.label} has been saved.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not add this field.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteField = async (fieldId) => {
    const targetField = fields.find((field) => field.id === fieldId)

    if (!targetField || targetField.isDefault) {
      return
    }

    setFieldDeleteTarget(targetField)
  }

  const confirmDeleteField = async (password) => {
    if (!fieldDeleteTarget) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deleteFormField(fieldDeleteTarget.id, user)
      const nextFields = fields
        .filter((field) => field.id !== fieldDeleteTarget.id)
        .map((field, index) => ({
          ...field,
          orderIndex: index + 1,
        }))

      await reorderFormFields(nextFields, user)
      syncFields(nextFields)
      setSuccessMessage('Field deleted successfully.')
      showToast({ title: 'Field deleted', message: `${fieldDeleteTarget.label} has been removed.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete this field.')
    } finally {
      setIsSaving(false)
      setFieldDeleteTarget(null)
    }
  }

  const handleMoveField = async (fieldId, direction) => {
    const currentGroupFields = fieldGroup === 'default' ? defaultFields : customFields
    const currentIndex = currentGroupFields.findIndex((field) => field.id === fieldId)
    const nextIndex = currentIndex + direction

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentGroupFields.length) {
      return
    }

    const reorderedGroupFields = [...currentGroupFields]
    const [movedField] = reorderedGroupFields.splice(currentIndex, 1)
    reorderedGroupFields.splice(nextIndex, 0, movedField)

    await saveFieldOrder(reorderedGroupFields)
  }

  const handleReorderField = async (fieldId, targetFieldId) => {
    if (!fieldId || !targetFieldId || fieldId === targetFieldId) {
      return
    }

    const currentGroupFields = fieldGroup === 'default' ? defaultFields : customFields
    const currentIndex = currentGroupFields.findIndex((field) => field.id === fieldId)
    const targetIndex = currentGroupFields.findIndex((field) => field.id === targetFieldId)

    if (currentIndex < 0 || targetIndex < 0) {
      return
    }

    const reorderedGroupFields = [...currentGroupFields]
    const [movedField] = reorderedGroupFields.splice(currentIndex, 1)
    reorderedGroupFields.splice(targetIndex, 0, movedField)

    await saveFieldOrder(reorderedGroupFields)
  }

  const handleToggleEnabled = async (field) => {
    const draft = fieldDrafts[field.id] ?? createDraftFromField(field)
    const nextEnabled = !draft.isEnabled

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const updatedField = await updateFormField(
        field.id,
        {
          isEnabled: nextEnabled,
        },
        user,
      )

      const nextFields = fields.map((item) => (item.id === field.id ? updatedField : item))
      syncFields(nextFields)
      setSuccessMessage(nextEnabled ? 'Field enabled.' : 'Field disabled.')
      showToast({ title: 'Field saved', message: `${updatedField.label} has been ${nextEnabled ? 'enabled' : 'disabled'}.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update this field.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveField = async (field) => {
    if (field.isDefault) {
      return
    }

    const draft = fieldDrafts[field.id]

    if (!draft) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const updatedField = await updateFormField(
        field.id,
        {
          label: draft.label,
          type: draft.type,
          required: draft.required,
          options: getOptionsForType(draft.type, draft.options),
          isEnabled: draft.isEnabled,
          orderIndex: field.orderIndex,
          isDefault: false,
        },
        user,
      )

      const nextFields = fields.map((item) => (item.id === field.id ? updatedField : item))
      syncFields(nextFields)
      setSuccessMessage('Field saved successfully.')
      showToast({ title: 'Field saved', message: `${updatedField.label} has been updated.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save this field.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Assessment Fields"
        title="Configure assessment fields"
        description="Default fields can be enabled or disabled. Custom fields can also be edited, reordered, or removed."
      />

      <section className="grid gap-4 md:grid-cols-3">
        {formRules.map((item) => (
          <article
            key={item.label}
            className={[
              'rounded-md border bg-white p-5 shadow-sm',
              item.tone === 'emerald' ? 'border-emerald-200' : '',
              item.tone === 'sky' ? 'border-sky-200' : '',
              item.tone === 'amber' ? 'border-amber-200' : '',
            ].join(' ')}
          >
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{item.value}</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{item.caption}</p>
          </article>
        ))}
      </section>

      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Setup rule</p>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
          Build the form coaches should use this week. Keep it short enough to complete pitch-side, then add custom fields only when a decision or parent report needs that data.
        </p>
      </section>

      {errorMessage ? <NoticeBanner title="Assessment fields action failed" message={errorMessage} /> : null}
      {successMessage ? <NoticeBanner title="Assessment fields updated" message={successMessage} tone="info" /> : null}

      <DefaultFormSection
        defaultTemplateFields={defaultTemplateFields}
        fieldsCount={fields.length}
        isSaving={isSaving}
        onRefreshFields={() => void refreshFields()}
      />

      <AddFieldSection
        canUseCustomFields={canUseCustomFields}
        fieldForm={fieldForm}
        isSaving={isSaving}
        onAddField={handleAddField}
        onFormChange={handleFormChange}
      />

      <CurrentFieldsSection
        customFields={customFields}
        defaultFields={defaultFields}
        fieldDrafts={fieldDrafts}
        fieldGroup={fieldGroup}
        fieldPage={fieldPage}
        fields={fields}
        isLoading={isLoading}
        isSaving={isSaving}
        onDeleteField={handleDeleteField}
        onDraftChange={handleDraftChange}
        onMoveField={handleMoveField}
        onPageChange={setFieldPage}
        onReorderField={handleReorderField}
        onSaveField={handleSaveField}
        onSetFieldGroup={setFieldGroup}
        onToggleEnabled={handleToggleEnabled}
        paginatedFields={paginatedFields}
        visibleFields={visibleFields}
      />

      <ConfirmModal
        isOpen={Boolean(fieldDeleteTarget)}
        isBusy={isSaving}
        title="Delete form field"
        message="This removes the custom field from the club form. Existing saved assessments keep their historic responses."
        items={[
          `Field: ${fieldDeleteTarget?.label || 'Selected field'}`,
          `Type: ${fieldDeleteTarget ? getFieldTypeLabel(fieldDeleteTarget.type) : 'Unknown type'}`,
        ]}
        confirmLabel="Delete Field"
        onCancel={() => setFieldDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteField(password)}
      />
    </div>
  )
}
