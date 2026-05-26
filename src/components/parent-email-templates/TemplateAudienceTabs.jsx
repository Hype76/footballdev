import { EMAIL_TEMPLATE_AUDIENCES } from '../../lib/email-templates.js'

export function TemplateAudienceTabs({ audience, onAudienceChange }) {
  return (
    <div className="rounded-lg border border-[#cfeedd] bg-white p-2 shadow-sm shadow-[#d7eadf]/70">
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
                ? 'border-[#067a46] bg-[#067a46] text-white shadow-sm shadow-[#067a46]/20'
                : 'border-[#cfeedd] bg-white text-[#101828] hover:border-[#20a464] hover:bg-[#f0fdf6]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
