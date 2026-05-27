import { EMAIL_TEMPLATE_AUDIENCES } from '../../lib/email-templates.js'

export function TemplateAudienceTabs({ audience, onAudienceChange }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white p-2 shadow-sm shadow-[#047857]/10">
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
                ? 'border-[#047857] bg-[#047857] text-white shadow-sm shadow-[#047857]/20'
                : 'border-[#d7e5dc] bg-white text-[#101828] hover:border-[#047857] hover:bg-[#ecfdf5]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
