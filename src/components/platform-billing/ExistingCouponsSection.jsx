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
        <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
          Loading coupons...
        </div>
      ) : sortedCoupons.length === 0 ? (
        <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-5 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
          No coupons have been created yet.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedCoupons.map((coupon) => (
            <div key={coupon.id} className="rounded-lg border border-[#bddcca] bg-white p-4 shadow-sm shadow-[#067a46]/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-[#10231a]">{coupon.name || coupon.id}</p>
                  <p className="mt-1 text-sm font-semibold text-[#456653]">{formatDiscount(coupon)}</p>
                </div>
                <span className="rounded-lg border border-[#abefc6] bg-[#ecfdf3] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[#067647]">
                  {coupon.liveOnWebsite ? 'Live' : coupon.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="mt-4 text-sm font-black text-[#10231a]">{coupon.code || 'No code'}</p>
              <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#456653]">
                {coupon.duration}{coupon.durationInMonths ? ` | ${coupon.durationInMonths} months` : ''} | {formatDate(coupon.createdAt)}
              </p>
              <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#456653]">
                {formatExpiry(coupon)}
              </p>
              {coupon.firstTimeOnly ? (
                <p className="mt-2 text-xs font-black uppercase tracking-[0.14em] text-[#456653]">
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
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#bddcca] bg-white px-4 py-3 text-sm font-black text-[#10231a] shadow-sm shadow-[#067a46]/10 transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {livePromotionId === coupon.promotionCodeId ? 'Saving...' : coupon.liveOnWebsite ? 'Hide From Website' : 'Show Live'}
                </button>
                <button
                  type="button"
                  disabled={deletingCouponId === coupon.id}
                  title={deletingCouponId === coupon.id ? 'Please wait while this coupon is being deleted.' : undefined}
                  onClick={() => onDeleteCoupon(coupon)}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60"
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
