import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageFormFields, useAuth } from '../lib/auth.js'
import {
  addFormField,
  deleteFormField,
  getConfiguredFormFields,
  reorderFormFields,
  updateFormField,
} from '../lib/supabase.js'

const initialFieldForm = {
  label: '',
  type: 'text',
  required: false,
  options: '',
}

function normalizeOptions(optionsText) {
  return optionsText
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean)
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
  const [fields, setFields] = useState([])
  const [fieldDrafts, setFieldDrafts] = useState({})
  const [fieldForm, setFieldForm] = useState(initialFieldForm)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadFields = async () => {
      setIsLoading(true)

      try {
        const nextFields = await getConfiguredFormFields({ user })

        if (!isMounted) {
          return
        }

        setFields(nextFields)
        setFieldDrafts(createDraftMap(nextFields))
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setFields([])
          setFieldDrafts({})
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
  }, [user])

  if (!canManageFormFields(user)) {
    return <Navigate to="/dashboard" replace />
  }

  const handleFormChange = (event) => {
    const { name, value, type, checked } = event.target
    setFieldForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const handleDraftChange = (fieldId, name, value) => {
    setFieldDrafts((current) => ({
      ...current,
      [fieldId]: {
        ...current[fieldId],
        [name]: value,
      },
    }))
  }

  const syncFields = (nextFields) => {
    setFields(nextFields)
    setFieldDrafts(createDraftMap(nextFields))
  }

  const handleAddField = async (event) => {
    event.preventDefault()
    setIsSaving(true)

    try {
      const createdField = await addFormField({
        user,
        field: {
          ...fieldForm,
          options: fieldForm.type === 'select' ? normalizeOptions(fieldForm.options) : [],
          orderIndex: fields.length + 1,
          isDefault: false,
          isEnabled: true,
        },
      })

      const nextFields = [...fields, createdField].sort((left, right) => left.orderIndex - right.orderIndex)
      syncFields(nextFields)
      setFieldForm(initialFieldForm)
    } catch (error) {
      console.error(error)
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
    } catch (error) {
      console.error(error)
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

    try {
      await reorderFormFields(normalizedFields, user)
      syncFields(normalizedFields)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleEnabled = async (field) => {
    const draft = fieldDrafts[field.id] ?? createDraftFromField(field)
    const nextEnabled = !draft.isEnabled

    setIsSaving(true)

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
    } catch (error) {
      console.error(error)
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

    try {
      const updatedField = await updateFormField(
        field.id,
        {
          label: draft.label,
          type: draft.type,
          required: draft.required,
          options: draft.type === 'select' ? normalizeOptions(draft.options) : [],
          isEnabled: draft.isEnabled,
          orderIndex: field.orderIndex,
          isDefault: false,
        },
        user,
      )

      const nextFields = fields.map((item) => (item.id === field.id ? updatedField : item))
      syncFields(nextFields)
    } catch (error) {
      console.error(error)
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

      <SectionCard
        title="Add field"
        description="Create text, textarea, number, or select fields for your club form."
      >
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleAddField}>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Label</span>
            <input
              type="text"
              name="label"
              value={fieldForm.label}
              onChange={handleFormChange}
              required
              className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Type</span>
            <select
              name="type"
              value={fieldForm.type}
              onChange={handleFormChange}
              className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            >
              <option value="text">Text</option>
              <option value="textarea">Textarea</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
            </select>
          </label>

          {fieldForm.type === 'select' ? (
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-semibold text-slate-700">Options</span>
              <input
                type="text"
                name="options"
                value={fieldForm.options}
                onChange={handleFormChange}
                placeholder="Option A, Option B, Option C"
                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
              />
            </label>
          ) : null}

          <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[#dbe3d6] bg-[#fcfdfb] px-4 py-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              name="required"
              checked={fieldForm.required}
              onChange={handleFormChange}
              className="h-4 w-4 rounded border-[#bfcab8] text-slate-900"
            />
            <span>Required field</span>
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500 sm:w-auto"
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
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#f8faf7] px-4 py-4 text-sm text-slate-600">
            Loading fields...
          </div>
        ) : fields.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[#cfd8c9] bg-[#f7faf5] px-4 py-6 text-sm text-slate-600">
            No fields found for this club.
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => {
              const draft = fieldDrafts[field.id] ?? createDraftFromField(field)

              return (
                <div
                  key={field.id}
                  className="rounded-[20px] border border-[#dbe3d6] bg-[#fcfdfb] p-4"
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="grid gap-4 md:grid-cols-2">
                      {field.isDefault ? (
                        <>
                          <div className="rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">Label</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{field.label}</p>
                          </div>
                          <div className="rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5a6b5b]">Type</p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{field.type}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">Label</span>
                            <input
                              type="text"
                              value={draft.label}
                              onChange={(event) => handleDraftChange(field.id, 'label', event.target.value)}
                              className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-2 block text-sm font-semibold text-slate-700">Type</span>
                            <select
                              value={draft.type}
                              onChange={(event) => handleDraftChange(field.id, 'type', event.target.value)}
                              className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                            >
                              <option value="text">Text</option>
                              <option value="textarea">Textarea</option>
                              <option value="number">Number</option>
                              <option value="select">Select</option>
                            </select>
                          </label>

                          {draft.type === 'select' ? (
                            <label className="block md:col-span-2">
                              <span className="mb-2 block text-sm font-semibold text-slate-700">Options</span>
                              <input
                                type="text"
                                value={draft.options}
                                onChange={(event) => handleDraftChange(field.id, 'options', event.target.value)}
                                placeholder="Option A, Option B, Option C"
                                className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                              />
                            </label>
                          ) : null}

                          <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[#dbe3d6] bg-[#fcfdfb] px-4 py-3 text-sm font-medium text-slate-700">
                            <input
                              type="checkbox"
                              checked={draft.required}
                              onChange={(event) => handleDraftChange(field.id, 'required', event.target.checked)}
                              className="h-4 w-4 rounded border-[#bfcab8] text-slate-900"
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
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        disabled={isSaving || index === fields.length - 1}
                        onClick={() => handleMoveField(field.id, 1)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleToggleEnabled(field)}
                        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100"
                      >
                        {draft.isEnabled ? 'Disable' : 'Enable'}
                      </button>
                      {field.isDefault ? (
                        <div className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-400">
                          Default field
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleSaveField(field)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleDeleteField(field.id)}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#d7ddd3] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:bg-slate-100"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#5a6b5b]">
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
