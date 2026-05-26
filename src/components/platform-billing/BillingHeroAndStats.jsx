export function BillingHeroAndStats({ billingStats, isLoading }) {
  return (
    <>
      <section className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-6 shadow-sm shadow-[#2563eb]/10 sm:p-8">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]">Billing control centre</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-[#0f172a] sm:text-4xl">
              Manage public promotions, tester access, and checkout discounts.
            </h2>
            <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[#475569] sm:text-base">
              Keep paid plans clean while giving testers temporary access without asking for a payment card.
            </p>
          </div>
          <div className="rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-lg bg-[#2563eb]" />
              <p className="text-sm font-black text-[#0f172a]">
                {isLoading ? 'Refreshing billing data' : 'Billing data loaded'}
              </p>
            </div>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#475569]">
              Stripe coupons and tester access codes are managed from this page.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {billingStats.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10 transition hover:border-[#2563eb] hover:bg-[#f8fafc]"
          >
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#475569]">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-[#0f172a]">{item.value}</p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[#475569]">{item.caption}</p>
          </div>
        ))}
      </div>
    </>
  )
}
