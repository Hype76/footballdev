export function BillingHeroAndStats({ billingStats, isLoading }) {
  return (
    <>
      <section className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-6 shadow-sm shadow-[#047857]/10 sm:p-8">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Billing control centre</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">
              Manage public promotions, tester access, and checkout discounts.
            </h2>
            <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[#4b5f55] sm:text-base">
              Keep paid plans clean while giving testers temporary access without asking for a payment card.
            </p>
          </div>
          <div className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-lg bg-[#047857]" />
              <p className="text-sm font-black text-[#101828]">
                {isLoading ? 'Refreshing billing data' : 'Billing data loaded'}
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
              Stripe coupons and tester access codes are managed from this page.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {billingStats.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#f7faf8]"
          >
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{item.value}</p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{item.caption}</p>
          </div>
        ))}
      </div>
    </>
  )
}
