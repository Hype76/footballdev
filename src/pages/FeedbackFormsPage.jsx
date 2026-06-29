import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageFeedbackForms, useAuth } from '../lib/auth.js'
import {
  archiveFeedbackForm,
  createFeedbackForm,
  duplicateFeedbackForm,
  FEEDBACK_FORM_FIELD_TYPES,
  getFeedbackForms,
  isGraphableFeedbackFormFieldType,
  normalizeFeedbackFormField,
  updateFeedbackForm,
  validateFeedbackFormDraft,
} from '../lib/supabase.js'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'

function createEmptyField() {
  return normalizeFeedbackFormField({
    label: '',
    type: 'score_1_10',
    required: false,
    options: [],
    includeInProgressChart: true,
  })
}

function reindexFields(fields = []) {
  return fields.map((field, index) => ({
    ...field,
    orderIndex: index + 1,
  }))
}

function stopTextInputSpacePropagation(event) {
  if (event.key === ' ') {
    event.stopPropagation()
  }
}

function createEditorState(form = null) {
  return {
    id: form?.id || '',
    name: form?.name || '',
    fields: form?.fields?.length ? form.fields.map(normalizeFeedbackFormField) : [createEmptyField()],
  }
}

function getFieldTypeLabel(type) {
  return FEEDBACK_FORM_FIELD_TYPES.find((fieldType) => fieldType.value === type)?.label || type
}

function FormList({ forms, isSaving, onArchive, onDuplicate, onEdit }) {
  if (forms.length === 0) {
    return (
      <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-6 text-sm font-semibold leading-6 text-[#4b5f55] shadow-sm shadow-[#047857]/10">
        No feedback forms yet. A Team Admin or Manager can create reusable forms for coaches to complete.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {forms.map((form) => (
        <article key={form.id} className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-lg font-black text-[#101828]">{form.name}</p>
              <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                {form.isArchived ? 'Archived' : 'Active'} | {form.fields.length} field{form.fields.length === 1 ? '' : 's'} | Version {form.version}
              </p>
              <p className="mt-1 text-xs font-semibold text-[#66756c]">
                Last updated {form.updatedAt ? new Date(form.updatedAt).toLocaleString('en-GB') : 'Unknown'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {!form.isArchived ? (
                <button type="button" onClick={() => onEdit(form)} disabled={isSaving} className={secondaryButtonClass}>
                  Edit
                </button>
              ) : null}
              <button type="button" onClick={() => onDuplicate(form)} disabled={isSaving} className={secondaryButtonClass}>
                Duplicate
              </button>
              {!form.isArchived ? (
                <button type="button" onClick={() => onArchive(form)} disabled={isSaving} className={dangerButtonClass}>
                  Archive
                </button>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

export function FeedbackFormsPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [forms, setForms] = useState([])
  const [editor, setEditor] = useState(() => createEditorState())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const activeForms = useMemo(() => forms.filter((form) => !form.isArchived), [forms])
  const archivedForms = useMemo(() => forms.filter((form) => form.isArchived), [forms])

  useEffect(() => {
    let isMounted = true

    const loadForms = async () => {
      if (!user) {
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      try {
        const nextForms = await getFeedbackForms({ user })

        if (isMounted) {
          setForms(nextForms)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Could not load feedback forms.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadForms()

    return () => {
      isMounted = false
    }
  }, [user])

  if (!canManageFeedbackForms(user)) {
    return <Navigate to="/coach" replace />
  }

  const refreshForms = async () => {
    const nextForms = await getFeedbackForms({ user })
    setForms(nextForms)
  }

  const updateField = (fieldId, nextValues) => {
    setEditor((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === fieldId
          ? normalizeFeedbackFormField({
              ...field,
              ...nextValues,
            })
          : field,
      ),
    }))
  }

  const addFieldAtTop = () => {
    setEditor((current) => ({
      ...current,
      fields: reindexFields([createEmptyField(), ...current.fields]),
    }))
  }

  const moveField = (fieldId, direction) => {
    setEditor((current) => {
      const currentIndex = current.fields.findIndex((field) => field.id === fieldId)
      const nextIndex = currentIndex + direction

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.fields.length) {
        return current
      }

      const fields = [...current.fields]
      const [movedField] = fields.splice(currentIndex, 1)
      fields.splice(nextIndex, 0, movedField)

      return {
        ...current,
        fields: reindexFields(fields),
      }
    })
  }

  const removeField = (fieldId) => {
    setEditor((current) => ({
      ...current,
      fields: reindexFields(current.fields.filter((field) => field.id !== fieldId)),
    }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const draft = validateFeedbackFormDraft(editor)
      const savedForm = editor.id
        ? await updateFeedbackForm({ formId: editor.id, user, ...draft })
        : await createFeedbackForm({ user, ...draft })

      await refreshForms()
      setEditor(createEditorState())
      setSuccessMessage(`${savedForm.name} saved.`)
      showToast({ title: 'Feedback form saved', message: `${savedForm.name} is ready for coaches.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not save this feedback form.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDuplicate = async (form) => {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const duplicatedForm = await duplicateFeedbackForm({ formId: form.id, user })
      await refreshForms()
      setEditor(createEditorState(duplicatedForm))
      setSuccessMessage(`${duplicatedForm.name} duplicated.`)
      showToast({ title: 'Feedback form duplicated', message: `${duplicatedForm.name} is ready to edit.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not duplicate this feedback form.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleArchive = async (form) => {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const archivedForm = await archiveFeedbackForm({ formId: form.id, user })
      await refreshForms()
      if (editor.id === form.id) {
        setEditor(createEditorState())
      }
      setSuccessMessage(`${archivedForm.name} archived. Historical responses stay readable.`)
      showToast({ title: 'Feedback form archived', message: 'It will not appear for new submissions.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not archive this feedback form.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Feedback forms"
        title="Create reusable team feedback forms."
        description="Save practical form templates by name so coaches can select the right structure when adding a player development record."
      />

      {errorMessage ? <NoticeBanner title="Feedback form action failed" message={errorMessage} /> : null}
      {successMessage ? <NoticeBanner title="Feedback form updated" message={successMessage} tone="info" /> : null}

      <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
        <form className="space-y-4" onSubmit={handleSave}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <label className="block lg:max-w-xl lg:flex-1">
              <span className="mb-2 block text-sm font-black text-[#101828]">Form name</span>
              <input
                value={editor.name}
                onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
                onKeyDown={stopTextInputSpacePropagation}
                className={fieldClass}
                placeholder="Example: Match day feedback"
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={addFieldAtTop}
                className={secondaryButtonClass}
              >
                Add field
              </button>
              <button type="submit" disabled={isSaving} className={primaryButtonClass}>
                {editor.id ? 'Save changes' : 'Create form'}
              </button>
              {editor.id ? (
                <button type="button" onClick={() => setEditor(createEditorState())} className={secondaryButtonClass}>
                  Clear editor
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            {editor.fields.map((field, index) => (
              <div key={field.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_8rem_8rem_auto] lg:items-end">
                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Field label</span>
                    <input
                      value={field.label}
                      onChange={(event) => updateField(field.id, { label: event.target.value })}
                      onKeyDown={stopTextInputSpacePropagation}
                      className={fieldClass}
                      placeholder="Example: Overall feedback"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Type</span>
                    <select
                      value={field.type}
                      onChange={(event) => updateField(field.id, { type: event.target.value, options: [] })}
                      className={fieldClass}
                    >
                      {FEEDBACK_FORM_FIELD_TYPES.map((fieldType) => (
                        <option key={fieldType.value} value={fieldType.value}>
                          {fieldType.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828]">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => updateField(field.id, { required: event.target.checked })}
                      className="h-4 w-4 accent-[#047857]"
                    />
                    Required
                  </label>
                  {isGraphableFeedbackFormFieldType(field.type) ? (
                    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828]">
                      <input
                        type="checkbox"
                        checked={Boolean(field.includeInProgressChart)}
                        onChange={(event) => updateField(field.id, { includeInProgressChart: event.target.checked })}
                        className="h-4 w-4 accent-[#047857]"
                      />
                      Graph
                    </label>
                  ) : null}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => moveField(field.id, -1)} disabled={index === 0} className={secondaryButtonClass}>
                      Up
                    </button>
                    <button type="button" onClick={() => moveField(field.id, 1)} disabled={index === editor.fields.length - 1} className={secondaryButtonClass}>
                      Down
                    </button>
                    <button type="button" onClick={() => removeField(field.id)} className={secondaryButtonClass}>
                      Remove
                    </button>
                  </div>
                </div>
                {field.type === 'select' ? (
                  <label className="mt-3 block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Dropdown options</span>
                    <input
                      value={field.options.join(', ')}
                      onChange={(event) => updateField(field.id, { options: event.target.value })}
                      onKeyDown={stopTextInputSpacePropagation}
                      className={fieldClass}
                      placeholder="Good, Average, Needs work"
                    />
                  </label>
                ) : (
                  <p className="mt-3 text-xs font-semibold text-[#66756c]">
                    Type: {getFieldTypeLabel(field.type)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Active forms</p>
            <h2 className="mt-2 text-2xl font-black text-[#101828]">{activeForms.length} active</h2>
          </div>
          {isLoading ? <p className="text-sm font-bold text-[#4b5f55]">Loading forms...</p> : null}
        </div>
        <FormList
          forms={activeForms}
          isSaving={isSaving}
          onArchive={handleArchive}
          onDuplicate={handleDuplicate}
          onEdit={(form) => setEditor(createEditorState(form))}
        />
      </section>

      {archivedForms.length > 0 ? (
        <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Archived forms</p>
          <h2 className="mt-2 text-2xl font-black text-[#101828]">{archivedForms.length} archived</h2>
          <div className="mt-4">
            <FormList
              forms={archivedForms}
              isSaving={isSaving}
              onArchive={handleArchive}
              onDuplicate={handleDuplicate}
              onEdit={(form) => setEditor(createEditorState(form))}
            />
          </div>
        </section>
      ) : null}
    </div>
  )
}
