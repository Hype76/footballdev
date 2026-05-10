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
