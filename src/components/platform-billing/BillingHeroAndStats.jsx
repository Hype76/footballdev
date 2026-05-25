export function BillingHeroAndStats({ billingStats, isLoading }) {
  return (
    <>
      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-6 shadow-sm  sm:p-8">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Billing control centre</p>
            <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Manage public promotions, tester access, and checkout discounts.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-700 sm:text-base">
              Keep paid plans clean while giving testers temporary access without asking for a payment card.
            </p>
          </div>
          <div className="rounded-md border border-emerald-200 bg-white p-5 shadow-sm ">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-md bg-emerald-600" />
              <p className="text-sm font-bold text-slate-950">
                {isLoading ? 'Refreshing billing data' : 'Billing data loaded'}
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Stripe coupons and tester access codes are managed from this page.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {billingStats.map((item) => (
          <div
            key={item.label}
            className="rounded-md border border-slate-200 bg-white p-5 shadow-sm  transition hover:border-emerald-300"
          >
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-4xl font-black tracking-tight text-slate-950">{item.value}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{item.caption}</p>
          </div>
        ))}
      </div>
    </>
  )
}
