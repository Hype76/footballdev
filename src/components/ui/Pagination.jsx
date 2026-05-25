export function Pagination({ currentPage, onPageChange, pageSize = 10, totalItems }) {
  const totalPages = Math.max(1, Math.ceil((Number(totalItems) || 0) / Math.max(1, Number(pageSize) || 1)))

  if (!totalItems || totalPages <= 1) {
    return null
  }

  const safePage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages)
  const startItem = (safePage - 1) * pageSize + 1
  const endItem = Math.min(safePage * pageSize, totalItems)
  const handlePageChange = (nextPage) => {
    onPageChange(nextPage)

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing {startItem} to {endItem} of {totalItems}
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
        <button
          type="button"
          onClick={() => handlePageChange(safePage - 1)}
          disabled={safePage <= 1}
          title={safePage <= 1 ? 'You are already on the first page.' : undefined}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 font-black text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
        >
          Previous
        </button>
        <span className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center font-black text-slate-950 sm:px-4">
          {safePage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => handlePageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          title={safePage >= totalPages ? 'You are already on the last page.' : undefined}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 font-black text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
        >
          Next
        </button>
      </div>
    </div>
  )
}
