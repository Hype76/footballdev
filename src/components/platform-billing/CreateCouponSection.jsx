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
          <span className="mb-2 block text-sm font-semibold text-slate-950">Coupon name</span>
          <input
            required
            value={couponForm.name}
            onChange={(event) => onCouponChange('name', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Promotion code</span>
          <input
            required
            value={couponForm.code}
            onChange={(event) => onCouponChange('code', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm uppercase text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Percent off</span>
          <input
            type="number"
            min="0"
            max="100"
            value={couponForm.percentOff}
            onChange={(event) => onCouponChange('percentOff', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Fixed amount off</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={couponForm.amountOff}
            onChange={(event) => onCouponChange('amountOff', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Duration</span>
          <select
            value={couponForm.duration}
            onChange={(event) => onCouponChange('duration', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            <option value="once">Once</option>
            <option value="repeating">Repeating</option>
            <option value="forever">Forever</option>
          </select>
        </label>
        {couponForm.duration === 'repeating' ? (
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-950">Months</span>
            <input
              type="number"
              min="1"
              value={couponForm.durationInMonths}
              onChange={(event) => onCouponChange('durationInMonths', event.target.value)}
              className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
        ) : null}
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">End date</span>
          <input
            type="date"
            value={couponForm.expiresAt}
            onChange={(event) => onCouponChange('expiresAt', event.target.value)}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
          <span className="mt-2 block text-xs text-slate-600">
            Optional. This stops new redemptions after the selected date.
          </span>
        </label>
        <label className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 xl:self-end">
          <input
            type="checkbox"
            checked={couponForm.firstTimeOnly}
            onChange={(event) => onCouponChange('firstTimeOnly', event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span className="text-sm font-semibold text-slate-950">First purchase only</span>
        </label>
        <div className="xl:col-span-4">
          <button
            type="submit"
            disabled={isSaving}
            title={isSaving ? 'Please wait while this coupon is being created.' : undefined}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? 'Creating...' : 'Create Coupon'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
