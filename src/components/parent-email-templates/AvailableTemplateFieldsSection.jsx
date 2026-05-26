import { EMAIL_TEMPLATE_FIELDS } from '../../lib/email-templates.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function AvailableTemplateFieldsSection() {
  return (
    <SectionCard
      title="Available fields"
      description="Only these approved fields can be used inside a subject or body."
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {EMAIL_TEMPLATE_FIELDS.map((field) => (
          <div key={field.key} className="rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 shadow-sm shadow-slate-200/60">
            <p className="text-sm font-black text-[#101828]">{field.label}</p>
            <p className="mt-1 font-mono text-xs font-black text-[#067a46]">{`{${field.key}}`}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
