import { useEffect, useRef } from 'react'
import { EMAIL_TEMPLATE_FIELDS, EMAIL_TEMPLATE_SECTIONS } from '../../lib/email-templates.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const textareaClass = 'w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-5 py-3 text-sm font-black text-[#b42318] transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'

export function TemplateEditorSection({
  audience,
  deletingKey,
  focusTemplateKey,
  isLoading,
  onAddCustomTemplate,
  onDeleteTemplate,
  onFieldInsert,
  onResetTemplate,
  onSaveTemplate,
  onSectionToggle,
  onTemplateFocused,
  onTemplateChange,
  savingKey,
  templates,
}) {
  const bodyRefs = useRef(new Map())
  const cardRefs = useRef(new Map())
  const nameInputRefs = useRef(new Map())

  useEffect(() => {
    if (!focusTemplateKey) {
      return
    }

    window.requestAnimationFrame(() => {
      const card = cardRefs.current.get(focusTemplateKey)
      const nameInput = nameInputRefs.current.get(focusTemplateKey)

      card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      nameInput?.focus()
      nameInput?.select()
      onTemplateFocused()
    })
  }, [focusTemplateKey, onTemplateFocused])

  const setBodyRef = (templateKey, node) => {
    if (node) {
      bodyRefs.current.set(templateKey, node)
      return
    }

    bodyRefs.current.delete(templateKey)
  }

  const setCardRef = (templateKey, node) => {
    if (node) {
      cardRefs.current.set(templateKey, node)
      return
    }

    cardRefs.current.delete(templateKey)
  }

  const setNameInputRef = (templateKey, node) => {
    if (node) {
      nameInputRefs.current.set(templateKey, node)
      return
    }

    nameInputRefs.current.delete(templateKey)
  }

  const insertFieldAtCursor = (template, fieldKey) => {
    const textarea = bodyRefs.current.get(template.key)
    const body = String(template.body ?? '')
    const start = typeof textarea?.selectionStart === 'number' ? textarea.selectionStart : body.length
    const end = typeof textarea?.selectionEnd === 'number' ? textarea.selectionEnd : start
    const nextPosition = start + fieldKey.length + 2

    onFieldInsert(template.key, fieldKey, { start, end })

    window.requestAnimationFrame(() => {
      const updatedTextarea = bodyRefs.current.get(template.key)

      if (!updatedTextarea) {
        return
      }

      updatedTextarea.focus()
      updatedTextarea.setSelectionRange(nextPosition, nextPosition)
    })
  }

  if (isLoading) {
    return (
      <SectionCard title="Templates" description="Loading club templates.">
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm font-semibold text-[#4b5f55]">
          Loading templates...
        </div>
      </SectionCard>
    )
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAddCustomTemplate}
          className={primaryButtonClass}
        >
          Add Custom Template
        </button>
      </div>

      {templates.map((template, templateIndex) => (
        <div
          key={template.key}
          ref={(node) => setCardRef(template.key, node)}
          className="scroll-mt-24"
          data-tour-id={templateIndex === 0 ? 'email-template-editor-section' : undefined}
        >
          <SectionCard
            title={template.label}
            description={
              template.id
                ? `This saved club template is available when sending ${audience} emails.`
                : template.isCustom
                  ? `Save this custom template before it can be used for ${audience} emails.`
                  : `Save this default before it can be used for ${audience} emails.`
            }
          >
            <div className="space-y-4 rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828]">
                <input
                  type="checkbox"
                  checked={template.isEnabled !== false}
                  onChange={(event) => onTemplateChange(template.key, 'isEnabled', event.target.checked)}
                  className="h-4 w-4 rounded border-[#d7e5dc] accent-[#047857]"
                />
                <span>Available for this club</span>
              </label>

            {template.isCustom ? (
              <label className="block">
                <span className={labelClass}>Template name</span>
                <input
                  ref={(node) => setNameInputRef(template.key, node)}
                  type="text"
                  value={template.label}
                  onChange={(event) => onTemplateChange(template.key, 'label', event.target.value)}
                  className={inputClass}
                />
              </label>
            ) : null}

            <div className={panelClass}>
              <p className="text-sm font-black text-[#101828]">Available for sections</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {EMAIL_TEMPLATE_SECTIONS.map((section) => {
                  const selectedSections = Array.isArray(template.sectionAvailability)
                    ? template.sectionAvailability
                    : [...EMAIL_TEMPLATE_SECTIONS]

                  return (
                    <label
                      key={section}
                      className="flex min-h-10 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSections.includes(section)}
                        onChange={(event) => onSectionToggle(template.key, section, event.target.checked)}
                        className="h-4 w-4 rounded border-[#d7e5dc] accent-[#047857]"
                      />
                      <span>{section}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <label className="block">
              <span className={labelClass}>Subject</span>
              <input
                type="text"
                value={template.subject}
                onChange={(event) => onTemplateChange(template.key, 'subject', event.target.value)}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Body</span>
              <textarea
                ref={(node) => setBodyRef(template.key, node)}
                value={template.body}
                onChange={(event) => onTemplateChange(template.key, 'body', event.target.value)}
                rows={12}
                className={textareaClass}
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {EMAIL_TEMPLATE_FIELDS.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertFieldAtCursor(template, field.key)}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
                >
                  {`Add {${field.key}}`}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void onSaveTemplate(template)}
                disabled={savingKey === template.key}
                title={savingKey === template.key ? 'Please wait while this template is being saved.' : undefined}
                className={`${primaryButtonClass} w-full sm:w-auto`}
              >
                {savingKey === template.key ? 'Saving...' : 'Save template'}
              </button>
              {!template.isCustom ? (
                <button
                  type="button"
                  onClick={() => onResetTemplate(template.key)}
                  className={`${secondaryButtonClass} w-full sm:w-auto`}
                >
                  Use default
                </button>
              ) : null}
              {template.isCustom ? (
                <button
                  type="button"
                  onClick={() => void onDeleteTemplate(template)}
                  disabled={deletingKey === template.key}
                  title={deletingKey === template.key ? 'Please wait while this template is being deleted.' : undefined}
                  className={`${dangerButtonClass} w-full sm:w-auto`}
                >
                  {deletingKey === template.key ? 'Deleting...' : 'Delete template'}
                </button>
              ) : null}
            </div>
            </div>
          </SectionCard>
        </div>
      ))}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAddCustomTemplate}
          className={primaryButtonClass}
        >
          Add custom template
        </button>
      </div>
    </div>
  )
}
