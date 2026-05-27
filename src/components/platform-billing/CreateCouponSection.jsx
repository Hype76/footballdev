import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'

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
          <span className={labelClass}>Coupon name</span>
          <input
            required
            value={couponForm.name}
            onChange={(event) => onCouponChange('name', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Promotion code</span>
          <input
            required
            value={couponForm.code}
            onChange={(event) => onCouponChange('code', event.target.value)}
            className={`${fieldClass} uppercase`}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Percent off</span>
          <input
            type="number"
            min="0"
            max="100"
            value={couponForm.percentOff}
            onChange={(event) => onCouponChange('percentOff', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Fixed amount off</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={couponForm.amountOff}
            onChange={(event) => onCouponChange('amountOff', event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Duration</span>
          <select
            value={couponForm.duration}
            onChange={(event) => onCouponChange('duration', event.target.value)}
            className={fieldClass}
          >
            <option value="once">Once</option>
            <option value="repeating">Repeating</option>
            <option value="forever">Forever</option>
          </select>
        </label>
        {couponForm.duration === 'repeating' ? (
          <label className="block">
            <span className={labelClass}>Months</span>
            <input
              type="number"
              min="1"
              value={couponForm.durationInMonths}
              onChange={(event) => onCouponChange('durationInMonths', event.target.value)}
              className={fieldClass}
            />
          </label>
        ) : null}
        <label className="block">
          <span className={labelClass}>End date</span>
          <input
            type="date"
            value={couponForm.expiresAt}
            onChange={(event) => onCouponChange('expiresAt', event.target.value)}
            className={fieldClass}
          />
          <span className="mt-2 block text-xs font-semibold text-[#4b5f55]">
            Optional. This stops new redemptions after the selected date.
          </span>
        </label>
        <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 shadow-sm shadow-[#047857]/10 xl:self-end">
          <input
            type="checkbox"
            checked={couponForm.firstTimeOnly}
            onChange={(event) => onCouponChange('firstTimeOnly', event.target.checked)}
            className="h-4 w-4 accent-[#047857]"
          />
          <span className="text-sm font-black text-[#101828]">First purchase only</span>
        </label>
        <div className="xl:col-span-4">
          <button
            type="submit"
            disabled={isSaving}
            title={isSaving ? 'Please wait while this coupon is being created.' : undefined}
            className={primaryButtonClass}
          >
            {isSaving ? 'Creating...' : 'Create coupon'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}
