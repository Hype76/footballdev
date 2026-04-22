import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageFormFields, useAuth } from '../lib/auth.js'
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

const FIELD_TYPE_OPTIONS = [
  { value: 'score_1_5', label: 'Score 1 to 5' },
  { value: 'score_1_10', label: 'Score 1 to 10' },
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'select', label: 'Select' },
]

const initialFieldForm = {
  label: '',
  type: 'score_1_5',
  required: false,
  options: '1, 2, 3, 4, 5',
}

function normalizeOptions(optionsText) {
  return optionsText
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
}

function isScoreType(type) {
  return type === 'score_1_5' || type === 'score_1_10'
}

function createScoreOptions(type) {
  const maxValue = type === 'score_1_10' ? 10 : 5
  return Array.from({ length: maxValue }, (_, index) => String(index + 1))
}

function getOptionsForType(type, optionsText) {
  if (isScoreType(type)) {
    return createScoreOptions(type)
  }

  if (type === 'select') {
    return normalizeOptions(optionsText)
  }

  return []
}

function getFieldTypeLabel(type) {
  return FIELD_TYPE_OPTIONS.find((option) => option.value === type)?.label || type
}

function createDraftFromField(field) {
  return {
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options.join(', '),
    isEnabled: field.isEnabled,
  }
}

function createDraftMap(fields) {
  return Object.fromEntries(fields.map((field) => [field.id, createDraftFromField(field)]))
}

export function FormBuilderPage() {
  const { user } = useAuth()
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
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not load the form fields for this club.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!canManageFormFields(user)) {
    return <Navigate to="/dashboard" replace />
  }

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

  const handleAddField = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
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

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await deleteFormField(fieldId)
      const nextFields = fields
        .filter((field) => field.id !== fieldId)
        .map((field, index) => ({
          ...field,
          orderIndex: index + 1,
        }))

      await reorderFormFields(nextFields, user)
      syncFields(nextFields)
      setSuccessMessage('Field deleted successfully.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete this field.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMoveField = async (fieldId, direction) => {
    const currentIndex = fields.findIndex((field) => field.id === fieldId)
    const nextIndex = currentIndex + direction

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= fields.length) {
      return
    }

    const nextFields = [...fields]
    const [movedField] = nextFields.splice(currentIndex, 1)
    nextFields.splice(nextIndex, 0, movedField)

    const normalizedFields = nextFields.map((field, index) => ({
      ...field,
      orderIndex: index + 1,
    }))

    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await reorderFormFields(normalizedFields, user)
      syncFields(normalizedFields)
      setSuccessMessage('Field order updated.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not reorder the fields.')
    } finally {
      setIsSaving(false)
    }
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
        eyebrow="Form Builder"
        title="Configure evaluation fields"
        description="Default fields can be enabled or disabled. Custom fields can also be edited, reordered, or removed."
      />

      {errorMessage ? <NoticeBanner title="Form builder action failed" message={errorMessage} /> : null}
      {successMessage ? <NoticeBanner title="Form builder updated" message={successMessage} tone="info" /> : null}

      <SectionCard
        title="Default form"
        description="Every club starts from this template. These fields become your editable default form once loaded."
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {defaultTemplateFields.map((field) => (
              <div key={field.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{field.label}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">{getFieldTypeLabel(field.type)}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--text-muted)]">
              {fields.length === 0
                ? 'No fields are configured for this club yet. Load the default form to start.'
                : 'Default fields are already available below and can be enabled, disabled, and reordered.'}
            </p>
            <button
              type="button"
              onClick={() => void refreshFields()}
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Loading...' : 'Load default form'}
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Add field"
        description="Create fast-scoring dropdowns, text fields, or custom select fields for your club form."
      >
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleAddField}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Label</span>
            <input
              type="text"
              name="label"
              value={fieldForm.label}
              onChange={handleFormChange}
              required
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Type</span>
            <select
              name="type"
              value={fieldForm.type}
              onChange={handleFormChange}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              {FIELD_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {fieldForm.type === 'select' ? (
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Options</span>
              <input
                type="text"
                name="options"
                value={fieldForm.options}
                onChange={handleFormChange}
                placeholder="Option A, Option B, Option C"
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          ) : null}

          {isScoreType(fieldForm.type) ? (
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 md:col-span-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Score options</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">{createScoreOptions(fieldForm.type).join(', ')}</p>
            </div>
          ) : null}

          <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
            <input
              type="checkbox"
              name="required"
              checked={fieldForm.required}
              onChange={handleFormChange}
              className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--panel-bg)]"
            />
            <span>Required field</span>
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? 'Saving...' : 'Add field'}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Current fields"
        description="Default fields stay in place and can only be enabled or disabled. Custom fields can also be edited or deleted."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading fields...
          </div>
        ) : fields.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No fields found for this club.
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => {
              const draft = fieldDrafts[field.id] ?? createDraftFromField(field)

              return (
                <div
                  key={field.id}
                  className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="grid gap-4 md:grid-cols-2">
                      {field.isDefault ? (
                        <>
                          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Label</p>
                            <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{field.label}</p>
                          </div>
                          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Type</p>
                            <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{getFieldTypeLabel(field.type)}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Label</span>
                            <input
                              type="text"
                              value={draft.label}
                              onChange={(event) => handleDraftChange(field.id, 'label', event.target.value)}
                              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Type</span>
                            <select
                              value={draft.type}
                              onChange={(event) => handleDraftChange(field.id, 'type', event.target.value)}
                              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                            >
                              {FIELD_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          {draft.type === 'select' ? (
                            <label className="block md:col-span-2">
                              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Options</span>
                              <input
                                type="text"
                                value={draft.options}
                                onChange={(event) => handleDraftChange(field.id, 'options', event.target.value)}
                                placeholder="Option A, Option B, Option C"
                                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                              />
                            </label>
                          ) : null}

                          {isScoreType(draft.type) ? (
                            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 md:col-span-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Score options</p>
                              <p className="mt-2 text-sm text-[var(--text-muted)]">{createScoreOptions(draft.type).join(', ')}</p>
                            </div>
                          ) : null}

                          <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
                            <input
                              type="checkbox"
                              checked={draft.required}
                              onChange={(event) => handleDraftChange(field.id, 'required', event.target.checked)}
                              className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--panel-bg)]"
                            />
                            <span>Required field</span>
                          </label>
                        </>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                      <button
                        type="button"
                        disabled={isSaving || index === 0}
                        onClick={() => handleMoveField(field.id, -1)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        disabled={isSaving || index === fields.length - 1}
                        onClick={() => handleMoveField(field.id, 1)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleToggleEnabled(field)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {draft.isEnabled ? 'Disable' : 'Enable'}
                      </button>
                      {field.isDefault ? (
                        <div className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-muted)]">
                          Default field
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleSaveField(field)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleDeleteField(field.id)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                    <span>{field.isDefault ? 'Default' : 'Custom'}</span>
                    <span>{draft.isEnabled ? 'Enabled' : 'Disabled'}</span>
                    <span>{draft.required ? 'Required' : 'Optional'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
