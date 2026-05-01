export function getPaginatedItems(items, currentPage, pageSize) {
  const safeItems = Array.isArray(items) ? items : []
  const safePageSize = Math.max(1, Number(pageSize) || 1)
  const totalPages = Math.max(1, Math.ceil(safeItems.length / safePageSize))
  const safePage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages)
  const startIndex = (safePage - 1) * safePageSize

  return {
    items: safeItems.slice(startIndex, startIndex + safePageSize),
    totalPages,
    currentPage: safePage,
    startItem: safeItems.length === 0 ? 0 : startIndex + 1,
    endItem: Math.min(startIndex + safePageSize, safeItems.length),
    totalItems: safeItems.length,
  }
}

export function Pagination({ currentPage, onPageChange, pageSize = 10, totalItems }) {
  const totalPages = Math.max(1, Math.ceil((Number(totalItems) || 0) / Math.max(1, Number(pageSize) || 1)))

  if (!totalItems || totalPages <= 1) {
    return null
  }

  const safePage = Math.min(Math.max(1, Number(currentPage) || 1), totalPages)
  const startItem = (safePage - 1) * pageSize + 1
  const endItem = Math.min(safePage * pageSize, totalItems)

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing {startItem} to {endItem} of {totalItems}
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
        >
          Previous
        </button>
        <span className="rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-3 text-center font-semibold text-[var(--text-primary)] sm:px-4">
          {safePage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-3 py-2 font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
        >
          Next
        </button>
      </div>
    </div>
  )
}
