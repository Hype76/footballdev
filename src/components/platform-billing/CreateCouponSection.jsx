import { SectionCard } from '../ui/SectionCard.jsx'

export function CreateCouponSection({
  couponForm,
  isSaving,
  onCouponChange,
  onCreateCoupon,
}) {
  return (
    <SectionCard
      title="Create discount coupon"
      description="Create a billing discount and promotion code that can be used during checkout."
    >
      <form onSubmit={onCreateCoupon} className="grid gap-4 xl:grid-cols-4">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Coupon name</span>
          <input
            required
            value={couponForm.name}
            onChange={(event) => onCouponChange('name', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Promotion code</span>
          <input
            required
            value={couponForm.code}
            onChange={(event) => onCouponChange('code', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm uppercase text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Percent off</span>
          <input
            type="number"
            min="0"
            max="100"
            value={couponForm.percentOff}
            onChange={(event) => onCouponChange('percentOff', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Fixed amount off</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={couponForm.amountOff}
            onChange={(event) => onCouponChange('amountOff', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Duration</span>
          <select
            value={couponForm.duration}
            onChange={(event) => onCouponChange('duration', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          >
            <option value="once">Once</option>
            <option value="repeating">Repeating</option>
            <option value="forever">Forever</option>
          </select>
        </label>
        {couponForm.duration === 'repeating' ? (
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Months</span>
            <input
              type="number"
              min="1"
              value={couponForm.durationInMonths}
              onChange={(event) => onCouponChange('durationInMonths', event.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>
        ) : null}
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">End date</span>
          <input
            type="date"
            value={couponForm.expiresAt}
            onChange={(event) => onCouponChange('expiresAt', event.target.value)}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
          <span className="mt-2 block text-xs text-[var(--text-muted)]">
            Optional. This stops new redemptions after the selected date.
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 xl:self-end">
          <input
            type="checkbox"
            checked={couponForm.firstTimeOnly}
            onChange={(event) => onCouponChange('firstTimeOnly', event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span className="text-sm font-semibold text-[var(--text-primary)]">First purchase only</span>
        </label>
        <div className="xl:col-span-4">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Creating...' : 'Create Coupon'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
