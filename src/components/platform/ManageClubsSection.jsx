import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#067a46]/20 transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60'

export function ManageClubsSection({
  form,
  isSaving,
  onChange,
  onSubmit,
}) {
  return (
    <SectionCard
      title="Manage clubs"
      description="Create clubs, suspend access, reactivate access, or delete unused club workspaces."
    >
      <form onSubmit={onSubmit} className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
        <label className="block">
          <span className={labelClass}>Club name</span>
          <input
            required
            value={form.name}
            onChange={(event) => onChange('name', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Contact email</span>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(event) => onChange('contactEmail', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Contact phone</span>
          <input
            value={form.contactPhone}
            onChange={(event) => onChange('contactPhone', event.target.value)}
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while the club is being added.' : undefined}
          className={primaryButtonClass}
        >
          {isSaving ? 'Adding...' : 'Add club'}
        </button>
      </form>
    </SectionCard>
  )
}
