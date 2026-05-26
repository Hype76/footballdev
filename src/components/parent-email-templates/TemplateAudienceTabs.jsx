import { EMAIL_TEMPLATE_AUDIENCES } from '../../lib/email-templates.js'

export function TemplateAudienceTabs({ audience, onAudienceChange }) {
  return (
    <div className="rounded-lg border border-[#cbd5e1] bg-white p-2 shadow-sm shadow-[#2563eb]/10">
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { key: EMAIL_TEMPLATE_AUDIENCES.parent, label: 'Parent templates' },
          { key: EMAIL_TEMPLATE_AUDIENCES.player, label: 'Player templates' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onAudienceChange(item.key)}
            className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-3 text-sm font-black transition ${
              audience === item.key
                ? 'border-[#2563eb] bg-[#2563eb] text-white shadow-sm shadow-[#2563eb]/20'
                : 'border-[#cbd5e1] bg-white text-[#0f172a] hover:border-[#2563eb] hover:bg-[#eff6ff]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
