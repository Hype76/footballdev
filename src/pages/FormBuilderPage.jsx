import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AddFieldSection } from '../components/form-builder/AddFieldSection.jsx'
import { CurrentFieldsSection } from '../components/form-builder/CurrentFieldsSection.jsx'
import { DefaultFormSection } from '../components/form-builder/DefaultFormSection.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import { canManageFormFields, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature, createUiFeatureUnavailableMessage } from '../lib/paywall-ui.js'
import {
  createDraftFromField,
  createDraftMap,
  createScoreOptions,
  FIELD_PAGE_SIZE,
  buildReorderedFormFields,
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

const developmentFormRules = [
  {
    label: 'Short form wins',
    body: 'Only keep fields coaches can complete after training or a match.',
  },
  {
    label: 'Decision data only',
    body: 'Add a field when it changes a football decision or improves a parent update.',
  },
  {
    label: 'Enabled fields go live',
    body: 'Disabled fields stay out of new development records until the club is ready.',
  },
]

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const metricCardClass = 'rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10'

export function FormBuilderPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const defaultTemplateFields = getDefaultFormFields()
  const activeTeamId = String(user?.activeTeamId ?? '').trim()
  const activeTeamName = String(user?.activeTeamName ?? '').trim()
  const cacheKey = user?.clubId && activeTeamId ? `form-builder:${user.clubId}:${activeTeamId}` : ''
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
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${activeTeamId}` : ''

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
      showToast({ title: 'Fields refreshed', message: 'Development form fields are up to date.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not load the form fields for this club.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!canManageFormFields(user)) {
    return <Navigate to="/coach" replace />
  }

  const defaultFields = fields.filter((field) => field.isDefault)
  const customFields = fields.filter((field) => !field.isDefault)
  const visibleFields = fieldGroup === 'default' ? defaultFields : customFields
  const paginatedFields = getPaginatedItems(visibleFields, fieldPage, FIELD_PAGE_SIZE)
  const canUseCustomFields = canUseUiFeature(user, CAPABILITIES.customDevelopmentFields)
  const enabledFieldsCount = fields.filter((field) => field.isEnabled).length

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
        nextForm.includeInProgressChart = false
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
        nextDraft.includeInProgressChart = false
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
    const normalizedFields = buildReorderedFormFields({ customFields, defaultFields, fieldGroup, nextGroupFields })
    const previousFields = fields
    const previousDrafts = fieldDrafts

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')
    syncFields(normalizedFields)

    try {
      await reorderFormFields(normalizedFields, user)
      setSuccessMessage('Field order updated.')
      showToast({ title: 'Field order saved', message: 'Development form field order has been updated.' })
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
        throw new Error(createUiFeatureUnavailableMessage(user, CAPABILITIES.customDevelopmentFields))
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

  const handleToggleProgressionChart = async (field, nextIncludeInProgressChart) => {
    if (!isScoreType(field.type)) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const updatedField = await updateFormField(
        field.id,
        {
          includeInProgressChart: nextIncludeInProgressChart,
        },
        user,
      )

      const nextFields = fields.map((item) => (item.id === field.id ? updatedField : item))
      syncFields(nextFields)
      setSuccessMessage('Progression chart setting saved.')
      showToast({
        title: 'Chart setting saved',
        message: `${updatedField.label} ${nextIncludeInProgressChart ? 'will' : 'will not'} feed the progression chart.`,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not update the progression chart setting.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveField = async (field) => {
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
          includeInProgressChart: isScoreType(draft.type) ? draft.includeInProgressChart : false,
          orderIndex: field.orderIndex,
          isDefault: field.isDefault,
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
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-stretch">
          <div>
            <p className={eyebrowClass}>Development form</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-4xl">
              Build the football record coaches will actually complete.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">
              Choose the fields that matter for player development, parent updates, and squad decisions. Keep the form short enough to use after training.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {developmentFormRules.map((rule) => (
                <div key={rule.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 shadow-sm shadow-[#047857]/10">
                  <p className="text-sm font-black text-[#101828]">{rule.label}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{rule.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid content-between rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-5 shadow-inner shadow-[#047857]/10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#4b5f55]">Form state</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">{enabledFieldsCount} fields live for coaches</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                {defaultFields.length} default fields and {customFields.length} custom fields are configured for {activeTeamName || 'this team'}.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <FormMetric label="Default" value={defaultFields.length} />
              <FormMetric label="Custom" value={customFields.length} />
              <FormMetric label="Enabled" value={enabledFieldsCount} />
              <FormMetric label="Total" value={fields.length} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#4b5f55]">
              {canUseCustomFields ? 'Custom development fields are available for this team.' : createUiFeatureUnavailableMessage(user, CAPABILITIES.customDevelopmentFields)}
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Development form action failed" message={errorMessage} /> : null}
      {successMessage ? <NoticeBanner title="Development form updated" message={successMessage} tone="info" /> : null}

      <DefaultFormSection
        defaultTemplateFields={defaultTemplateFields}
        fieldsCount={fields.length}
        isSaving={isSaving}
        onRefreshFields={() => void refreshFields()}
      />

      <AddFieldSection
        canUseCustomFields={canUseCustomFields}
        featureUnavailableMessage={createUiFeatureUnavailableMessage(user, CAPABILITIES.customDevelopmentFields)}
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
        onToggleProgressionChart={handleToggleProgressionChart}
        onToggleEnabled={handleToggleEnabled}
        paginatedFields={paginatedFields}
        visibleFields={visibleFields}
      />

      <ConfirmModal
        isOpen={Boolean(fieldDeleteTarget)}
        isBusy={isSaving}
        title="Delete form field"
        message="This removes the custom field from the club form. Existing saved development records keep their historic responses."
        items={[
          `Field: ${fieldDeleteTarget?.label || 'Selected field'}`,
          `Type: ${fieldDeleteTarget ? getFieldTypeLabel(fieldDeleteTarget.type) : 'Unknown type'}`,
        ]}
        confirmLabel="Delete field"
        onCancel={() => setFieldDeleteTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmDeleteField(password)}
      />
    </div>
  )
}

function FormMetric({ label, value }) {
  return (
    <div className={metricCardClass}>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{value}</p>
    </div>
  )
}
