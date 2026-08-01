import { useEffect, useMemo, useRef, useState } from 'react'
import { EMAIL_TEMPLATE_FIELDS, EMAIL_TEMPLATE_SECTIONS, renderParentEmailTemplate } from '../../lib/email-templates.js'
import { EmailPreview } from '../ui/EmailPreview.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const textareaClass = 'w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold leading-6 text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const panelClass = 'rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-5 py-3 text-sm font-black text-[#b42318] transition hover:border-[#fda29b] hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60'

const editorViews = [
  { key: 'content', label: 'Content' },
  { key: 'settings', label: 'Settings' },
  { key: 'preview', label: 'Preview' },
]

export function TemplateEditorSection({
  audience,
  deletingKey,
  focusTemplateKey,
  hasExplicitSelection,
  hasUnsavedChanges,
  isLoading,
  onAddCustomTemplate,
  onBackToList,
  onDeleteTemplate,
  onFieldInsert,
  onResetTemplate,
  onSaveTemplate,
  onSectionToggle,
  onSelectTemplate,
  onTemplateFocused,
  onTemplateChange,
  savingKey,
  selectedTemplateKey,
  templates,
  user,
}) {
  const [editorView, setEditorView] = useState('content')
  const bodyRef = useRef(null)
  const nameInputRef = useRef(null)
  const selectedTemplate = templates.find((template) => template.key === selectedTemplateKey) || templates[0] || null

  useEffect(() => {
    if (!focusTemplateKey || focusTemplateKey !== selectedTemplate?.key) {
      return
    }

    window.requestAnimationFrame(() => {
      setEditorView('settings')
      window.requestAnimationFrame(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
        onTemplateFocused()
      })
    })
  }, [focusTemplateKey, onTemplateFocused, selectedTemplate?.key])

  const insertFieldAtCursor = (fieldKey) => {
    if (!selectedTemplate) {
      return
    }

    const body = String(selectedTemplate.body ?? '')
    const start = typeof bodyRef.current?.selectionStart === 'number' ? bodyRef.current.selectionStart : body.length
    const end = typeof bodyRef.current?.selectionEnd === 'number' ? bodyRef.current.selectionEnd : start
    const nextPosition = start + fieldKey.length + 2

    onFieldInsert(selectedTemplate.key, fieldKey, { start, end })

    window.requestAnimationFrame(() => {
      if (!bodyRef.current) {
        return
      }

      bodyRef.current.focus()
      bodyRef.current.setSelectionRange(nextPosition, nextPosition)
    })
  }

  const renderedPreview = useMemo(
    () => renderParentEmailTemplate(selectedTemplate, {
      clubName: user?.clubName || 'Your club',
      coachName: user?.displayName || user?.name || 'Coaching Team',
      inviteDate: '2026-08-15',
      parentName: 'Alex Parent',
      playerFirstName: 'Jordan',
      playerLastName: 'Player',
      playerName: 'Jordan Player',
      recipientName: audience === 'player' ? 'Jordan Player' : 'Alex Parent',
      session: '2026-08-08',
      summary: 'A focused update from the latest development session.',
      teamName: user?.activeTeamName || 'Current team',
    }),
    [audience, selectedTemplate, user?.activeTeamName, user?.clubName, user?.displayName, user?.name],
  )

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
    <div className="grid min-w-0 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start">
      <aside
        className={`${hasExplicitSelection ? 'hidden lg:block' : 'block'} min-w-0 overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10`}
        data-testid="email-template-list"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#d7e5dc] bg-[#f7faf8] px-4 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Choose a template</p>
            <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{templates.length} for this audience</p>
          </div>
          <button type="button" onClick={onAddCustomTemplate} className={`${primaryButtonClass} min-h-10 px-3 py-2`}>
            Add
          </button>
        </div>

        <div className="grid gap-2 p-3 lg:max-h-[calc(100dvh-13rem)] lg:overflow-y-auto">
          {templates.map((template, templateIndex) => {
            const isSelected = template.key === selectedTemplate?.key

            return (
              <button
                key={template.key}
                type="button"
                onClick={() => {
                  setEditorView('content')
                  onSelectTemplate(template)
                }}
                aria-current={isSelected ? 'true' : undefined}
                className={`min-w-0 rounded-lg border px-4 py-3 text-left transition ${
                  isSelected
                    ? 'border-[#047857] bg-[#ecfdf5] shadow-sm shadow-[#047857]/10'
                    : 'border-[#d7e5dc] bg-white hover:border-[#047857] hover:bg-[#f7faf8]'
                }`}
                data-tour-id={templateIndex === 0 ? 'email-template-editor-section' : undefined}
              >
                <span className="block truncate text-sm font-black text-[#101828]">{template.label}</span>
                <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold text-[#4b5f55]">
                  <span>{template.isEnabled === false ? 'Disabled' : 'Enabled'}</span>
                  <span>{template.isCustom ? 'Custom' : template.id ? 'Club saved' : 'Default'}</span>
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      <section
        className={`${hasExplicitSelection ? 'block' : 'hidden lg:block'} min-w-0 overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10`}
        data-testid="email-template-editor"
      >
        {selectedTemplate ? (
          <>
            <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 sm:px-5">
              <button type="button" onClick={onBackToList} className={`${secondaryButtonClass} mb-3 min-h-10 px-3 py-2 lg:hidden`}>
                Back to templates
              </button>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Focused editor</p>
                  <h2 className="mt-1 truncate text-2xl font-black tracking-tight text-[#101828]">{selectedTemplate.label}</h2>
                  <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                    {selectedTemplate.id ? 'Saved for this team' : 'Not saved for this team yet'}
                    {hasUnsavedChanges ? ' | Unsaved changes' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onSaveTemplate(selectedTemplate)}
                  disabled={savingKey === selectedTemplate.key}
                  title={savingKey === selectedTemplate.key ? 'Please wait while this template is being saved.' : undefined}
                  className={`${primaryButtonClass} w-full sm:w-auto`}
                >
                  {savingKey === selectedTemplate.key ? 'Saving...' : 'Save template'}
                </button>
              </div>
            </div>

            <div className="border-b border-[#d7e5dc] bg-white p-2">
              <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Template editor views">
                {editorViews.map((view) => (
                  <button
                    key={view.key}
                    type="button"
                    role="tab"
                    aria-selected={editorView === view.key}
                    onClick={() => setEditorView(view.key)}
                    className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-black transition ${
                      editorView === view.key
                        ? 'border-[#047857] bg-[#047857] text-white'
                        : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857] hover:bg-[#ecfdf5]'
                    }`}
                  >
                    {view.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 sm:p-5">
              {editorView === 'content' ? (
                <div className="space-y-4" role="tabpanel">
                  <label className="block">
                    <span className={labelClass}>Subject</span>
                    <input
                      type="text"
                      value={selectedTemplate.subject}
                      onChange={(event) => onTemplateChange(selectedTemplate.key, 'subject', event.target.value)}
                      className={inputClass}
                    />
                  </label>

                  <label className="block">
                    <span className={labelClass}>Body</span>
                    <textarea
                      ref={bodyRef}
                      value={selectedTemplate.body}
                      onChange={(event) => onTemplateChange(selectedTemplate.key, 'body', event.target.value)}
                      rows={9}
                      className={textareaClass}
                    />
                  </label>

                  <details className={panelClass}>
                    <summary className="cursor-pointer text-sm font-black text-[#101828]">Insert an approved field</summary>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">The field is inserted at the current body cursor position.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {EMAIL_TEMPLATE_FIELDS.map((field) => (
                        <button
                          key={field.key}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertFieldAtCursor(field.key)}
                          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-xs font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
                        >
                          {field.label} {`{${field.key}}`}
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
              ) : null}

              {editorView === 'settings' ? (
                <div className="space-y-4" role="tabpanel">
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-black text-[#101828]">
                    <input
                      type="checkbox"
                      checked={selectedTemplate.isEnabled !== false}
                      onChange={(event) => onTemplateChange(selectedTemplate.key, 'isEnabled', event.target.checked)}
                      className="h-4 w-4 rounded border-[#d7e5dc] accent-[#047857]"
                    />
                    <span>Available for this club</span>
                  </label>

                  {selectedTemplate.isCustom ? (
                    <label className="block">
                      <span className={labelClass}>Template name</span>
                      <input
                        ref={nameInputRef}
                        type="text"
                        value={selectedTemplate.label}
                        onChange={(event) => onTemplateChange(selectedTemplate.key, 'label', event.target.value)}
                        className={inputClass}
                      />
                    </label>
                  ) : null}

                  <div className={panelClass}>
                    <p className="text-sm font-black text-[#101828]">Available for sections</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {EMAIL_TEMPLATE_SECTIONS.map((section) => {
                        const selectedSections = Array.isArray(selectedTemplate.sectionAvailability)
                          ? selectedTemplate.sectionAvailability
                          : [...EMAIL_TEMPLATE_SECTIONS]

                        return (
                          <label key={section} className="flex min-h-11 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828]">
                            <input
                              type="checkbox"
                              checked={selectedSections.includes(section)}
                              onChange={(event) => onSectionToggle(selectedTemplate.key, section, event.target.checked)}
                              className="h-4 w-4 rounded border-[#d7e5dc] accent-[#047857]"
                            />
                            <span>{section}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    {!selectedTemplate.isCustom ? (
                      <button type="button" onClick={() => onResetTemplate(selectedTemplate.key)} className={`${secondaryButtonClass} w-full sm:w-auto`}>
                        Use default
                      </button>
                    ) : null}
                    {selectedTemplate.isCustom ? (
                      <button
                        type="button"
                        onClick={() => void onDeleteTemplate(selectedTemplate)}
                        disabled={deletingKey === selectedTemplate.key}
                        title={deletingKey === selectedTemplate.key ? 'Please wait while this template is being deleted.' : undefined}
                        className={`${dangerButtonClass} w-full sm:w-auto`}
                      >
                        {deletingKey === selectedTemplate.key ? 'Deleting...' : 'Delete template'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {editorView === 'preview' ? (
                <div role="tabpanel" className="max-h-[62dvh] overflow-y-auto rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-2 sm:p-4">
                  <EmailPreview
                    clubName={user?.clubName || 'Your club'}
                    logoUrl={user?.clubLogoUrl || ''}
                    playerName="Jordan Player"
                    team={user?.activeTeamName || 'Current team'}
                    section="Template preview"
                    session="2026-08-08"
                    emailSubject={renderedPreview.subject}
                    emailBody={renderedPreview.body}
                    recipientNames={audience === 'player' ? 'Jordan Player' : 'Alex Parent'}
                    mode="email"
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="p-5 text-sm font-semibold text-[#4b5f55]">Add or select a template to begin.</div>
        )}
      </section>
    </div>
  )
}
