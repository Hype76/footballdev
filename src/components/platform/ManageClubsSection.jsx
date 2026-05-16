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
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club name</span>
          <input
            required
            value={form.name}
            onChange={(event) => onChange('name', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact email</span>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(event) => onChange('contactEmail', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact phone</span>
          <input
            value={form.contactPhone}
            onChange={(event) => onChange('contactPhone', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={isSaving}
          title={isSaving ? 'Please wait while the club is being added.' : undefined}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Adding...' : 'Add Club'}
        </button>
      </form>
    </SectionCard>
  )
}
