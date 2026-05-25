import { SectionCard } from '../ui/SectionCard.jsx'

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
          <span className="mb-2 block text-sm font-bold text-slate-950">Club name</span>
          <input
            required
            value={form.name}
            onChange={(event) => onChange('name', event.target.value)}
            className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-950">Contact email</span>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(event) => onChange('contactEmail', event.target.value)}
            className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-slate-950">Contact phone</span>
          <input
            value={form.contactPhone}
            onChange={(event) => onChange('contactPhone', event.target.value)}
            className="min-h-11 w-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while the club is being added.' : undefined}
          className="inline-flex min-h-11 items-center justify-center bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Adding...' : 'Add Club'}
        </button>
      </form>
    </SectionCard>
  )
}
