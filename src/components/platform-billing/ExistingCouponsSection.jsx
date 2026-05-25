import { formatDate, formatDiscount, formatExpiry } from '../../lib/platform-billing-utils.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function ExistingCouponsSection({
  deletingCouponId,
  isLoading,
  livePromotionId,
  onDeleteCoupon,
  onSetLivePromotion,
  sortedCoupons,
}) {
  return (
    <SectionCard
      title="Existing coupons"
      description="Use these promotion codes when applying discounts during checkout."
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
          Loading coupons...
        </div>
      ) : sortedCoupons.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
          No coupons have been created yet.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedCoupons.map((coupon) => (
            <div key={coupon.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/80">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">{coupon.name || coupon.id}</p>
                  <p className="mt-1 text-sm text-slate-600">{formatDiscount(coupon)}</p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-emerald-800">
                  {coupon.liveOnWebsite ? 'Live' : coupon.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="mt-4 text-sm font-black text-slate-950">{coupon.code || 'No code'}</p>
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                {coupon.duration}{coupon.durationInMonths ? ` | ${coupon.durationInMonths} months` : ''} | {formatDate(coupon.createdAt)}
              </p>
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                {formatExpiry(coupon)}
              </p>
              {coupon.firstTimeOnly ? (
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  First purchase only
                </p>
              ) : null}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!coupon.promotionCodeId || livePromotionId === coupon.promotionCodeId}
                  title={
                    !coupon.promotionCodeId
                      ? 'This coupon cannot be shown on the website because it has no promotion code.'
                      : livePromotionId === coupon.promotionCodeId
                        ? 'Please wait while the website promotion is being updated.'
                        : undefined
                  }
                  onClick={() => onSetLivePromotion(coupon)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {livePromotionId === coupon.promotionCodeId ? 'Saving...' : coupon.liveOnWebsite ? 'Hide From Website' : 'Show Live'}
                </button>
                <button
                  type="button"
                  disabled={deletingCouponId === coupon.id}
                  title={deletingCouponId === coupon.id ? 'Please wait while this coupon is being deleted.' : undefined}
                  onClick={() => onDeleteCoupon(coupon)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingCouponId === coupon.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
